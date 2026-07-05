use std::{collections::HashSet, fs, time::Duration};

use chrono::Utc;
use reqwest::{blocking::Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, Runtime};

use crate::{
    auth::{account_fields, should_replace_auth_by_refresh_time, validate_auth},
    models::{AppSettings, CloudAccountPayload, CloudAuthState, CloudSyncResult, ManagerStateFile},
    storage::{
        expiration_path, load_expiration, load_note, load_usage, managed_auth_path, note_path,
        read_app_settings, read_json, read_state, resolve_paths, save_expiration, save_note,
        save_usage, sync_current_into_store, usage_path, write_app_settings, write_json_atomic,
        write_json_if_changed, write_state,
    },
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudUserResponse {
    id: String,
    email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudTokenResponse {
    access_token: String,
    refresh_token: String,
    user: Option<CloudUserResponse>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudAccountsResponse {
    accounts: Vec<CloudAccountPayload>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudCredentials {
    access_token: Option<String>,
    refresh_token: Option<String>,
}

fn cloud_credentials_path<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data directory: {error}"))?
        .join("cloud-auth.json"))
}

fn read_cloud_credentials<R: Runtime>(app: &tauri::AppHandle<R>) -> CloudCredentials {
    cloud_credentials_path(app)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_cloud_credentials<R: Runtime>(
    app: &tauri::AppHandle<R>,
    credentials: &CloudCredentials,
) -> Result<(), String> {
    let value = serde_json::to_value(credentials).map_err(|error| error.to_string())?;
    write_json_atomic(&cloud_credentials_path(app)?, &value)
}

fn clear_cloud_credentials<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let path = cloud_credentials_path(app)?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Failed to clear cloud credentials: {error}"))?;
    }
    Ok(())
}

fn api_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Failed to create cloud HTTP client: {error}"))
}

fn normalize_base_url(value: &str) -> Result<Option<String>, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(None);
    }
    let url =
        url::Url::parse(trimmed).map_err(|error| format!("Cloud base URL is invalid: {error}"))?;
    match url.scheme() {
        "http" | "https" => Ok(Some(trimmed.to_string())),
        _ => Err("Cloud base URL must start with http:// or https://".to_string()),
    }
}

fn cloud_state(settings: &AppSettings, credentials: &CloudCredentials) -> CloudAuthState {
    let enabled = settings
        .cloud_base_url
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    CloudAuthState {
        enabled,
        base_url: settings.cloud_base_url.clone(),
        authenticated: enabled
            && credentials.access_token.is_some()
            && credentials.refresh_token.is_some(),
        user_email: settings.cloud_user_email.clone(),
        user_id: settings.cloud_user_id.clone(),
        last_sync_at: settings.cloud_last_sync_at.clone(),
    }
}

fn clear_cloud_profile(settings: &mut AppSettings) {
    settings.cloud_user_email = None;
    settings.cloud_user_id = None;
    settings.cloud_last_sync_at = None;
}

fn base_url(settings: &AppSettings) -> Result<&str, String> {
    settings
        .cloud_base_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "Cloud login is disabled. Configure a server base URL in Settings first.".to_string()
        })
}

fn endpoint(settings: &AppSettings, path: &str) -> Result<String, String> {
    Ok(format!("{}{}", base_url(settings)?, path))
}

fn response_error(action: &str, response: reqwest::blocking::Response) -> String {
    let status = response.status();
    let detail = response.text().unwrap_or_default();
    if detail.trim().is_empty() {
        format!("{action} failed with HTTP {status}")
    } else {
        format!("{action} failed with HTTP {status}: {detail}")
    }
}

fn refresh_cloud_token(
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<(), String> {
    let refresh_token = credentials
        .refresh_token
        .clone()
        .ok_or_else(|| "Cloud refresh token is missing. Please log in again.".to_string())?;
    let response = client
        .post(endpoint(settings, "/auth/refresh")?)
        .json(&json!({ "refreshToken": refresh_token }))
        .send()
        .map_err(|error| format!("Cloud token refresh failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Cloud token refresh", response));
    }
    let tokens: CloudTokenResponse = response
        .json()
        .map_err(|error| format!("Cloud token refresh response is invalid: {error}"))?;
    credentials.access_token = Some(tokens.access_token);
    credentials.refresh_token = Some(tokens.refresh_token);
    if let Some(user) = tokens.user {
        settings.cloud_user_id = Some(user.id);
        settings.cloud_user_email = Some(user.email);
    }
    Ok(())
}

fn cloud_request(
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<reqwest::blocking::Response, String> {
    for attempt in 0..2 {
        let access_token = credentials
            .access_token
            .clone()
            .ok_or_else(|| "Cloud access token is missing. Please log in again.".to_string())?;
        let mut request = client
            .request(method.clone(), endpoint(settings, path)?)
            .bearer_auth(access_token)
            .header("Accept", "application/json");
        if let Some(payload) = body.as_ref() {
            request = request.json(payload);
        }
        let response = request
            .send()
            .map_err(|error| format!("Cloud request failed: {error}"))?;
        if response.status() != StatusCode::UNAUTHORIZED || attempt == 1 {
            return Ok(response);
        }
        refresh_cloud_token(client, settings, credentials)?;
    }
    unreachable!("cloud_request returns inside the retry loop")
}

fn collect_local_accounts<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<CloudAccountPayload>, String> {
    let _ = sync_current_into_store(app);
    let paths = resolve_paths(app)?;
    fs::create_dir_all(&paths.accounts)
        .map_err(|error| format!("Failed to create account store: {error}"))?;
    let active_id = read_state(&paths).active_account_id;
    let mut accounts = Vec::new();
    for entry in fs::read_dir(&paths.accounts)
        .map_err(|error| format!("Failed to read account store: {error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let auth_path = entry.path().join("auth.json");
        if !auth_path.exists() {
            continue;
        }
        let auth = read_json(&auth_path)?;
        validate_auth(&auth)?;
        let (email, plan, account_id, id) = account_fields(&auth)?;
        accounts.push(CloudAccountPayload {
            active: active_id.as_deref() == Some(&id),
            usage: load_usage(&usage_path(&paths, &id)),
            note: load_note(&note_path(&paths, &id)),
            expires_at: load_expiration(&expiration_path(&paths, &id)),
            id,
            email,
            plan,
            account_id,
            auth,
        });
    }
    accounts.sort_by(|left, right| left.email.cmp(&right.email));
    Ok(accounts)
}

fn collect_local_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<CloudAccountPayload, String> {
    collect_local_accounts(app)?
        .into_iter()
        .find(|account| account.id == id)
        .ok_or_else(|| format!("Local account {id} does not exist"))
}

fn apply_remote_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    account: &CloudAccountPayload,
) -> Result<(), String> {
    validate_auth(&account.auth)?;
    let (_, _, _, computed_id) = account_fields(&account.auth)?;
    if computed_id != account.id {
        return Err(format!(
            "Cloud account {} does not match its auth.json identity",
            account.email
        ));
    }
    let paths = resolve_paths(app)?;
    let auth_path = managed_auth_path(&paths, &account.id);
    let local_auth = read_json(&auth_path).ok();
    let account_auth =
        if should_replace_auth_by_refresh_time(&account.id, local_auth.as_ref(), &account.auth) {
            write_json_if_changed(&auth_path, &account.auth)?;
            account.auth.clone()
        } else {
            local_auth.unwrap_or_else(|| account.auth.clone())
        };
    save_note(&note_path(&paths, &account.id), &account.note)?;
    save_expiration(&expiration_path(&paths, &account.id), &account.expires_at)?;
    save_usage(&usage_path(&paths, &account.id), &account.usage)?;

    let active_account_id = read_state(&paths).active_account_id;
    if active_account_id.as_deref() == Some(&account.id) {
        write_json_if_changed(&paths.current_auth, &account_auth)?;
    } else if account.active && active_account_id.is_none() {
        write_json_if_changed(&paths.current_auth, &account_auth)?;
        write_state(
            &paths,
            &ManagerStateFile {
                active_account_id: Some(account.id.clone()),
            },
        )?;
    }
    Ok(())
}

fn get_remote_accounts(
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<Vec<CloudAccountPayload>, String> {
    let response = cloud_request(
        client,
        settings,
        credentials,
        Method::GET,
        "/sync/accounts",
        None,
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud account download", response));
    }
    let payload: CloudAccountsResponse = response
        .json()
        .map_err(|error| format!("Cloud account download response is invalid: {error}"))?;
    Ok(payload.accounts)
}

fn put_remote_accounts<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<usize, String> {
    let accounts = collect_local_accounts(app)?;
    let response = cloud_request(
        client,
        settings,
        credentials,
        Method::PUT,
        "/sync/accounts",
        Some(json!({ "accounts": accounts })),
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud account upload", response));
    }
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(accounts.len())
}

fn put_remote_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<(), String> {
    let account = collect_local_account(app, id)?;
    let response = cloud_request(
        client,
        settings,
        credentials,
        Method::PUT,
        &format!("/sync/accounts/{id}"),
        Some(serde_json::to_value(account).map_err(|error| error.to_string())?),
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud account upload", response));
    }
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(())
}

fn delete_remote_account(
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<(), String> {
    let response = cloud_request(
        client,
        settings,
        credentials,
        Method::DELETE,
        &format!("/sync/accounts/{id}"),
        None,
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud account delete", response));
    }
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(())
}

#[tauri::command]
pub(crate) fn get_cloud_auth_state<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudAuthState, String> {
    let settings = read_app_settings(&app)?;
    let credentials = read_cloud_credentials(&app);
    Ok(cloud_state(&settings, &credentials))
}

#[tauri::command]
pub(crate) fn set_cloud_base_url<R: Runtime>(
    app: tauri::AppHandle<R>,
    base_url: String,
) -> Result<CloudAuthState, String> {
    let mut settings = read_app_settings(&app)?;
    let normalized = normalize_base_url(&base_url)?;
    if settings.cloud_base_url != normalized {
        clear_cloud_profile(&mut settings);
        clear_cloud_credentials(&app)?;
    }
    settings.cloud_base_url = normalized;
    if settings.cloud_base_url.is_none() {
        clear_cloud_profile(&mut settings);
        clear_cloud_credentials(&app)?;
    }
    write_app_settings(&app, &settings)?;
    let credentials = read_cloud_credentials(&app);
    Ok(cloud_state(&settings, &credentials))
}

#[tauri::command]
pub(crate) async fn cloud_login<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
    password: String,
) -> Result<CloudAuthState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let response = client
            .post(endpoint(&settings, "/auth/login")?)
            .json(&json!({ "email": email, "password": password }))
            .send()
            .map_err(|error| format!("Cloud login failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error("Cloud login", response));
        }
        let tokens: CloudTokenResponse = response
            .json()
            .map_err(|error| format!("Cloud login response is invalid: {error}"))?;
        let mut credentials = CloudCredentials {
            access_token: Some(tokens.access_token),
            refresh_token: Some(tokens.refresh_token),
        };
        if let Some(user) = tokens.user {
            settings.cloud_user_id = Some(user.id);
            settings.cloud_user_email = Some(user.email);
        }
        let _ = put_remote_accounts(&app, &client, &mut settings, &mut credentials)?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        Ok(cloud_state(&settings, &credentials))
    })
    .await
    .map_err(|error| format!("Cloud login task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_logout<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudAuthState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let credentials = read_cloud_credentials(&app);
        if credentials.refresh_token.is_some() && settings.cloud_base_url.is_some() {
            let _ = client
                .post(endpoint(&settings, "/auth/logout")?)
                .json(&json!({ "refreshToken": credentials.refresh_token.clone() }))
                .send();
        }
        clear_cloud_profile(&mut settings);
        clear_cloud_credentials(&app)?;
        write_app_settings(&app, &settings)?;
        Ok(cloud_state(&settings, &CloudCredentials::default()))
    })
    .await
    .map_err(|error| format!("Cloud logout task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_push_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        let uploaded = put_remote_accounts(&app, &client, &mut settings, &mut credentials)?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        Ok(CloudSyncResult {
            uploaded,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud upload task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_push_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        put_remote_account(&app, &client, &mut settings, &mut credentials, &id)?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        Ok(CloudSyncResult {
            uploaded: 1,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud account upload task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_delete_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        delete_remote_account(&client, &mut settings, &mut credentials, &id)?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        Ok(CloudSyncResult {
            uploaded: 0,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud account delete task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_sync_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        let local_ids = collect_local_accounts(&app)?
            .into_iter()
            .map(|account| account.id)
            .collect::<HashSet<_>>();
        let mut downloaded = 0;
        for account in get_remote_accounts(&client, &mut settings, &mut credentials)? {
            let is_new = !local_ids.contains(&account.id);
            apply_remote_account(&app, &account)?;
            if is_new {
                downloaded += 1;
            }
        }
        let uploaded = put_remote_accounts(&app, &client, &mut settings, &mut credentials)?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        if downloaded > 0 {
            app.emit("accounts-changed", ())
                .map_err(|error| error.to_string())?;
            crate::system_tray::refresh_menu(&app);
        }
        Ok(CloudSyncResult {
            uploaded,
            downloaded,
        })
    })
    .await
    .map_err(|error| format!("Cloud sync task failed: {error}"))?
}
