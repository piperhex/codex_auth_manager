use std::{
    collections::HashSet,
    fs,
    sync::{Mutex, MutexGuard, OnceLock},
    time::Duration,
};

use base64::{
    engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::Utc;
use reqwest::{
    blocking::{multipart, Client},
    Method, StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, Runtime};
use uuid::Uuid;

use crate::{
    auth::{account_fields, canonicalize_chatgpt_auth, validate_auth},
    models::{
        AccountFieldModifiedAt, AppSettings, CloudAccountPayload, CloudAuthState, CloudSyncResult,
        ProviderProfile, ProviderSyncPayload,
    },
    storage::{
        auto_switch_priority_path, expiration_path, load_auto_switch_priority, load_expiration,
        load_note, load_or_init_account_field_modified_at, load_or_init_last_modified, load_usage,
        managed_auth_path, note_path, parse_last_modified, read_app_settings, read_json,
        read_state, resolve_paths, save_account_field_modified_at, save_auto_switch_priority,
        save_expiration, save_note, save_usage, usage_path, write_app_settings, write_json_atomic,
        write_json_if_changed, write_managed_auth_if_changed, write_state,
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

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedCloudLogin {
    email: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAuthenticationResult {
    state: CloudAuthState,
    password_saved: bool,
    credential_storage_updated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudAccountsResponse {
    accounts: Vec<CloudAccountPayload>,
    #[serde(default)]
    deleted_account_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudProvidersResponse {
    providers: Vec<ProviderSyncPayload>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAnnouncement {
    content: String,
    #[serde(default)]
    content_zh: String,
    #[serde(default)]
    content_en: String,
    #[serde(default)]
    link: String,
    enabled: bool,
    text_color: String,
    background_color: String,
    #[serde(default = "default_announcement_scroll_duration_seconds")]
    scroll_duration_seconds: u16,
    updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudNotification {
    id: String,
    title_zh: String,
    title_en: String,
    content_zh: String,
    content_en: String,
    #[serde(default)]
    link: String,
    #[serde(default)]
    link_label_zh: String,
    #[serde(default)]
    link_label_en: String,
    enabled: bool,
    published_at: String,
    updated_at: String,
}

fn default_announcement_scroll_duration_seconds() -> u16 {
    22
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackImageInput {
    file_name: String,
    mime_type: String,
    data_base64: String,
}

#[derive(Debug)]
struct FeedbackImage {
    file_name: String,
    mime_type: String,
    data: Vec<u8>,
}

const MAX_FEEDBACK_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_FEEDBACK_IMAGES: usize = 4;
const FEEDBACK_IMAGE_MIME_TYPES: [&str; 3] = ["image/jpeg", "image/png", "image/webp"];
const CLOUD_LOGIN_KEYRING_USER: &str = "default";
const CLOUD_SESSION_EXPIRED_EVENT: &str = "cloud-session-expired";

// Refresh tokens are rotated by the backend. All cloud operations that read or
// write cloud-auth.json must therefore share one critical section: otherwise a
// slower request can overwrite a newly rotated token with the revoked one it
// read before the refresh completed.
static CLOUD_CREDENTIALS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn lock_cloud_credentials() -> Result<MutexGuard<'static, ()>, String> {
    CLOUD_CREDENTIALS_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Cloud credentials lock is unavailable".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallationState {
    device_id: String,
    platform: String,
    #[serde(default)]
    reported_at: Option<String>,
    #[serde(default)]
    reported_version: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudCredentials {
    access_token: Option<String>,
    refresh_token: Option<String>,
    #[serde(default)]
    device_id: Option<String>,
}

pub(crate) struct RemoteControlConfig {
    pub(crate) websocket_url: String,
    pub(crate) access_token: String,
    pub(crate) device_id: String,
    pub(crate) device_name: String,
    pub(crate) platform: String,
    pub(crate) app_version: String,
    pub(crate) active_account_id: Option<String>,
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
    let mut credentials: CloudCredentials = cloud_credentials_path(app)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if credentials.device_id.is_none() {
        credentials.device_id = read_or_create_installation_state(app)
            .ok()
            .map(|installation| installation.device_id);
    }
    credentials
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
    crate::system_proxy::apply(Client::builder())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Failed to create cloud HTTP client: {error}"))
}

fn feedback_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("Failed to create feedback HTTP client: {error}"))
}

fn decode_feedback_images(inputs: Vec<FeedbackImageInput>) -> Result<Vec<FeedbackImage>, String> {
    if inputs.len() > MAX_FEEDBACK_IMAGES {
        return Err(format!(
            "At most {MAX_FEEDBACK_IMAGES} feedback images are allowed"
        ));
    }
    inputs
        .into_iter()
        .map(|input| {
            let maximum_base64_length = MAX_FEEDBACK_IMAGE_BYTES.div_ceil(3) * 4 + 4;
            if input.data_base64.len() > maximum_base64_length {
                return Err("Each feedback image must not exceed 5 MB".to_string());
            }
            let data = BASE64_STANDARD
                .decode(&input.data_base64)
                .map_err(|_| "Feedback image data is invalid".to_string())?;
            Ok(FeedbackImage {
                file_name: input.file_name,
                mime_type: input.mime_type,
                data,
            })
        })
        .collect()
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
        session_expired: settings.cloud_session_expired,
    }
}

fn clear_cloud_profile(settings: &mut AppSettings) {
    settings.cloud_user_email = None;
    settings.cloud_user_id = None;
    settings.cloud_last_sync_at = None;
}

fn saved_cloud_login_service(settings: &AppSettings) -> Result<String, String> {
    let base_url = base_url(settings)?;
    let digest = Sha256::digest(base_url.as_bytes());
    Ok(format!("codex-switch-cloud-login-{digest:x}"))
}

fn saved_cloud_login_entry(settings: &AppSettings) -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        &saved_cloud_login_service(settings)?,
        CLOUD_LOGIN_KEYRING_USER,
    )
    .map_err(|error| format!("Could not access the system credential store: {error}"))
}

fn read_saved_cloud_login(settings: &AppSettings) -> Result<Option<SavedCloudLogin>, String> {
    let entry = saved_cloud_login_entry(settings)?;
    let value = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not read the saved cloud login from the system credential store: {error}"
            ))
        }
    };
    serde_json::from_str(&value)
        .map(Some)
        .map_err(|error| format!("The saved cloud login is invalid: {error}"))
}

fn update_saved_cloud_login(
    settings: &AppSettings,
    saved_login: Option<&SavedCloudLogin>,
) -> Result<(), String> {
    let entry = saved_cloud_login_entry(settings)?;
    if let Some(saved_login) = saved_login {
        let value = serde_json::to_string(saved_login)
            .map_err(|error| format!("Could not encode the saved cloud login: {error}"))?;
        return entry.set_password(&value).map_err(|error| {
            format!("Could not save the cloud login in the system credential store: {error}")
        });
    }
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Could not remove the saved cloud login from the system credential store: {error}"
        )),
    }
}

fn expire_cloud_session<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &mut AppSettings,
) -> Result<(), String> {
    clear_cloud_profile(settings);
    settings.cloud_session_expired = true;
    let clear_result = clear_cloud_credentials(app);
    let settings_result = write_app_settings(app, settings);
    let emit_result = app
        .emit(CLOUD_SESSION_EXPIRED_EVENT, ())
        .map_err(|error| format!("Could not notify the app that cloud login expired: {error}"));
    clear_result?;
    settings_result?;
    emit_result
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

fn persist_cloud_token_response<WriteCredentials, WriteSettings>(
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    tokens: CloudTokenResponse,
    write_credentials: WriteCredentials,
    write_settings: WriteSettings,
) -> Result<(), String>
where
    WriteCredentials: FnOnce(&CloudCredentials) -> Result<(), String>,
    WriteSettings: FnOnce(&AppSettings) -> Result<(), String>,
{
    credentials.access_token = Some(tokens.access_token);
    credentials.refresh_token = Some(tokens.refresh_token);
    if let Some(user) = tokens.user {
        settings.cloud_user_id = Some(user.id);
        settings.cloud_user_email = Some(user.email);
    }

    // The backend has already revoked the old refresh token. Store its
    // replacement before any ancillary settings write or business retry.
    write_credentials(credentials)?;
    write_settings(settings)?;
    Ok(())
}

fn refresh_rejection_expires_cloud_session(status: StatusCode) -> bool {
    matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
}

fn refresh_cloud_token<R: Runtime>(
    app: &tauri::AppHandle<R>,
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
        if refresh_rejection_expires_cloud_session(response.status()) {
            let server_error = response_error("Cloud token refresh", response);
            if let Err(error) = expire_cloud_session(app, settings) {
                return Err(format!(
                    "Cloud login expired and local sign-out failed: {error}. Server response: {server_error}"
                ));
            }
            return Err(
                "Cloud login expired. Please sign in again to continue cloud synchronization."
                    .to_string(),
            );
        }
        return Err(response_error("Cloud token refresh", response));
    }
    let tokens: CloudTokenResponse = response
        .json()
        .map_err(|error| format!("Cloud token refresh response is invalid: {error}"))?;
    persist_cloud_token_response(
        settings,
        credentials,
        tokens,
        |credentials| write_cloud_credentials(app, credentials),
        |settings| write_app_settings(app, settings),
    )
}

fn access_token_expires_soon(access_token: &str) -> bool {
    let Some(payload) = access_token.split('.').nth(1) else {
        return true;
    };
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload));
    let Ok(decoded) = decoded else {
        return true;
    };
    let Ok(payload) = serde_json::from_slice::<Value>(&decoded) else {
        return true;
    };
    payload
        .get("exp")
        .and_then(Value::as_i64)
        .is_none_or(|expires_at| expires_at <= Utc::now().timestamp() + 60)
}

pub(crate) fn remote_control_config<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Option<RemoteControlConfig>, String> {
    let _credentials_guard = lock_cloud_credentials()?;
    let mut settings = read_app_settings(app)?;
    let mut credentials = read_cloud_credentials(app);
    let Some(mut access_token) = credentials.access_token.clone() else {
        return Ok(None);
    };
    if credentials.refresh_token.is_none() || settings.cloud_user_id.is_none() {
        return Ok(None);
    }
    if access_token_expires_soon(&access_token) {
        let client = api_client()?;
        refresh_cloud_token(app, &client, &mut settings, &mut credentials)?;
        access_token = credentials
            .access_token
            .clone()
            .ok_or_else(|| "Cloud access token is missing after refresh".to_string())?;
        write_app_settings(app, &settings)?;
        write_cloud_credentials(app, &credentials)?;
    }

    let mut url = url::Url::parse(base_url(&settings)?)
        .map_err(|error| format!("Cloud base URL is invalid: {error}"))?;
    let websocket_scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        _ => return Err("Cloud base URL must use HTTP or HTTPS".to_string()),
    };
    url.set_scheme(websocket_scheme)
        .map_err(|_| "Could not build the remote control WebSocket URL".to_string())?;
    let base_path = url.path().trim_end_matches('/');
    url.set_path(&format!("{base_path}/device-switch"));
    url.set_query(None);
    url.set_fragment(None);

    let installation = read_or_create_installation_state(app)?;
    let active_account_id = read_state(&resolve_paths(app)?).active_account_id;
    Ok(Some(RemoteControlConfig {
        websocket_url: url.to_string(),
        access_token,
        device_id: installation.device_id,
        device_name: sysinfo::System::host_name().unwrap_or_else(|| "Codex Switch".to_string()),
        platform: installation.platform,
        app_version: app.package_info().version.to_string(),
        active_account_id,
    }))
}

fn cloud_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
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
        if let Some(device_id) = credentials.device_id.as_deref() {
            request = request.header("X-Device-ID", device_id);
        }
        if let Some(payload) = body.as_ref() {
            request = request.json(payload);
        }
        let response = request
            .send()
            .map_err(|error| format!("Cloud request failed: {error}"))?;
        if response.status() != StatusCode::UNAUTHORIZED || attempt == 1 {
            return Ok(response);
        }
        refresh_cloud_token(app, client, settings, credentials)?;
    }
    unreachable!("cloud_request returns inside the retry loop")
}

fn collect_local_accounts<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<CloudAccountPayload>, String> {
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
        let mut auth = read_json(&auth_path)?;
        let repaired = canonicalize_chatgpt_auth(&mut auth)?;
        validate_auth(&auth)?;
        let (email, plan, account_id, id) = account_fields(&auth)?;
        if repaired {
            write_managed_auth_if_changed(&paths, &id, &auth)?;
        }
        let field_modified_at = load_or_init_account_field_modified_at(&paths, &id)?;
        let last_modified_at = load_or_init_last_modified(&paths, &id)?.to_rfc3339();
        accounts.push(CloudAccountPayload {
            active: active_id.as_deref() == Some(&id),
            auto_switch_priority: load_auto_switch_priority(&auto_switch_priority_path(
                &paths, &id,
            )),
            usage: load_usage(&usage_path(&paths, &id)),
            note: load_note(&note_path(&paths, &id)),
            expires_at: load_expiration(&expiration_path(&paths, &id)),
            last_modified_at,
            field_modified_at,
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

fn collect_local_providers<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<ProviderSyncPayload>, String> {
    let paths = resolve_paths(app)?;
    let mut providers = crate::providers::list_provider_profiles(&paths)?
        .into_iter()
        .map(|provider| {
            let last_modified_at =
                crate::providers::provider_modified_at(&paths, &provider.id)?.to_rfc3339();
            Ok(provider_payload_from_profile(provider, last_modified_at))
        })
        .collect::<Result<Vec<_>, String>>()?;
    providers.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(providers)
}

fn collect_local_provider<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<ProviderSyncPayload, String> {
    collect_local_providers(app)?
        .into_iter()
        .find(|provider| provider.id == id)
        .ok_or_else(|| format!("Local provider {id} does not exist"))
}

fn normalize_account_field_modified_at(
    mut values: AccountFieldModifiedAt,
    fallback: &str,
) -> AccountFieldModifiedAt {
    for value in [
        &mut values.auth,
        &mut values.note,
        &mut values.expires_at,
        &mut values.usage,
        &mut values.active,
        &mut values.auto_switch_priority,
    ] {
        if value.trim().is_empty() {
            *value = fallback.to_string();
        }
    }
    values
}

fn remote_field_is_newer(local: &str, remote: &str) -> bool {
    match (parse_last_modified(local), parse_last_modified(remote)) {
        (Some(local), Some(remote)) => remote > local,
        (None, Some(_)) => true,
        _ => false,
    }
}

fn apply_remote_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    account: &CloudAccountPayload,
) -> Result<bool, String> {
    let mut remote_auth = account.auth.clone();
    canonicalize_chatgpt_auth(&mut remote_auth)?;
    validate_auth(&remote_auth)?;
    let (_, _, _, computed_id) = account_fields(&remote_auth)?;
    if computed_id != account.id {
        return Err(format!(
            "Cloud account {} does not match its auth.json identity",
            account.email
        ));
    }
    let paths = resolve_paths(app)?;
    let auth_path = managed_auth_path(&paths, &account.id);
    let local_auth = read_json(&auth_path).ok();
    let local_usable = local_auth.as_ref().is_some_and(|auth| {
        validate_auth(auth).is_ok()
            && matches!(account_fields(auth), Ok((_, _, _, local_id)) if local_id == account.id)
    });
    let mut local_field_modified_at = load_or_init_account_field_modified_at(&paths, &account.id)?;
    let remote_field_modified_at = normalize_account_field_modified_at(
        account.field_modified_at.clone(),
        &account.last_modified_at,
    );
    let apply_auth = !local_usable
        || remote_field_is_newer(
            &local_field_modified_at.auth,
            &remote_field_modified_at.auth,
        );
    let apply_note = remote_field_is_newer(
        &local_field_modified_at.note,
        &remote_field_modified_at.note,
    );
    let apply_expires_at = remote_field_is_newer(
        &local_field_modified_at.expires_at,
        &remote_field_modified_at.expires_at,
    );
    let apply_usage = remote_field_is_newer(
        &local_field_modified_at.usage,
        &remote_field_modified_at.usage,
    );
    let apply_active = remote_field_is_newer(
        &local_field_modified_at.active,
        &remote_field_modified_at.active,
    );
    let apply_auto_switch_priority = remote_field_is_newer(
        &local_field_modified_at.auto_switch_priority,
        &remote_field_modified_at.auto_switch_priority,
    );

    let account_auth = if apply_auth {
        write_json_if_changed(&auth_path, &remote_auth)?;
        local_field_modified_at.auth = remote_field_modified_at.auth.clone();
        remote_auth.clone()
    } else {
        local_auth.unwrap_or(remote_auth)
    };

    if apply_note {
        save_note(&note_path(&paths, &account.id), &account.note)?;
        local_field_modified_at.note = remote_field_modified_at.note.clone();
    }
    if apply_expires_at {
        save_expiration(&expiration_path(&paths, &account.id), &account.expires_at)?;
        local_field_modified_at.expires_at = remote_field_modified_at.expires_at.clone();
    }
    if apply_usage {
        save_usage(&usage_path(&paths, &account.id), &account.usage)?;
        local_field_modified_at.usage = remote_field_modified_at.usage.clone();
    }
    if apply_active {
        local_field_modified_at.active = remote_field_modified_at.active.clone();
    }
    if apply_auto_switch_priority {
        save_auto_switch_priority(
            &auto_switch_priority_path(&paths, &account.id),
            account.auto_switch_priority,
        )?;
        local_field_modified_at.auto_switch_priority =
            remote_field_modified_at.auto_switch_priority.clone();
    }
    if apply_auth
        || apply_note
        || apply_expires_at
        || apply_usage
        || apply_active
        || apply_auto_switch_priority
    {
        save_account_field_modified_at(&paths, &account.id, &local_field_modified_at)?;
    }

    let active_account_id = read_state(&paths).active_account_id;
    if apply_auth && active_account_id.as_deref() == Some(&account.id) {
        crate::commands::sync_current_auth_if_client_stopped(&paths, &account_auth)?;
    } else if apply_active && account.active && active_account_id.is_none() {
        let proxy_running = crate::local_proxy::is_running();
        let can_activate = if proxy_running {
            !crate::auth::is_agent_identity_auth(&account_auth)
        } else {
            crate::commands::sync_current_auth_if_client_stopped(&paths, &account_auth)?
        };
        if can_activate {
            let mut state = read_state(&paths);
            state.active_account_id = Some(account.id.clone());
            write_state(&paths, &state)?;
            if crate::local_proxy::is_running() {
                crate::providers::apply_local_proxy_config_for_paths(&paths)?;
            }
        }
    }
    Ok(apply_auth
        || apply_note
        || apply_expires_at
        || apply_usage
        || apply_active
        || apply_auto_switch_priority)
}

fn apply_remote_provider<R: Runtime>(
    app: &tauri::AppHandle<R>,
    provider: &ProviderSyncPayload,
) -> Result<bool, String> {
    let paths = resolve_paths(app)?;
    let profile = provider_payload_to_profile(provider);
    let local_profile = crate::providers::read_provider(&paths, &provider.id).ok();
    let local_modified_at = local_profile
        .as_ref()
        .and_then(|_| crate::providers::provider_modified_at(&paths, &provider.id).ok());
    let remote_modified_at = parse_last_modified(&provider.last_modified_at);
    let should_apply_remote = local_profile.is_none()
        || match (local_modified_at.as_ref(), remote_modified_at.as_ref()) {
            (Some(local), Some(remote)) => remote > local,
            (None, _) => true,
            (Some(_), None) => false,
        };

    if should_apply_remote {
        crate::providers::write_synced_provider(&paths, profile)?;
    }
    Ok(should_apply_remote)
}

fn provider_payload_from_profile(
    provider: ProviderProfile,
    last_modified_at: String,
) -> ProviderSyncPayload {
    ProviderSyncPayload {
        id: provider.id,
        name: provider.name,
        base_url: provider.base_url,
        api_key: provider.api_key,
        model: provider.model,
        models: provider.models,
        model_selection_controlled_by_codex: provider.model_selection_controlled_by_codex,
        api_format: provider.api_format,
        last_modified_at,
    }
}

fn provider_payload_to_profile(provider: &ProviderSyncPayload) -> ProviderProfile {
    ProviderProfile {
        id: provider.id.clone(),
        name: provider.name.clone(),
        base_url: provider.base_url.clone(),
        api_key: provider.api_key.clone(),
        model: provider.model.clone(),
        models: provider.models.clone(),
        model_selection_controlled_by_codex: provider.model_selection_controlled_by_codex,
        api_format: provider.api_format,
    }
}

fn get_remote_accounts<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<CloudAccountsResponse, String> {
    let response = cloud_request(
        app,
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
    Ok(payload)
}

fn apply_remote_account_deletion<R: Runtime>(
    app: &tauri::AppHandle<R>,
    account_id: &str,
) -> Result<bool, String> {
    let paths = resolve_paths(app)?;
    let target = crate::storage::account_dir(&paths, account_id);
    let existed = target.exists();
    if existed {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("Failed to remove cloud-deleted account: {error}"))?;
    }
    let mut state = read_state(&paths);
    let was_active = state.active_account_id.as_deref() == Some(account_id);
    let disabled_count = state.disabled_account_ids.len();
    if was_active {
        state.active_account_id = None;
    }
    state.disabled_account_ids.retain(|id| id != account_id);
    let state_changed = was_active || state.disabled_account_ids.len() != disabled_count;
    if state_changed {
        write_state(&paths, &state)?;
    }
    Ok(existed || state_changed)
}

fn get_remote_providers<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<Vec<ProviderSyncPayload>, String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::GET,
        "/sync/providers",
        None,
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud provider download", response));
    }
    let payload: CloudProvidersResponse = response
        .json()
        .map_err(|error| format!("Cloud provider download response is invalid: {error}"))?;
    Ok(payload.providers)
}

fn put_remote_accounts<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<usize, String> {
    let accounts = collect_local_accounts(app)?;
    for account in &accounts {
        upsert_remote_account_payload(app, client, settings, credentials, account)?;
    }
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(accounts.len())
}

fn put_remote_providers<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<usize, String> {
    let providers = collect_local_providers(app)?;
    for provider in &providers {
        upsert_remote_provider_payload(app, client, settings, credentials, provider)?;
    }
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(providers.len())
}

fn upsert_remote_account_payload<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    account: &CloudAccountPayload,
) -> Result<(), String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::PUT,
        &format!("/sync/accounts/{}", account.id),
        Some(serde_json::to_value(account).map_err(|error| error.to_string())?),
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud account upload", response));
    }
    Ok(())
}

fn upsert_remote_provider_payload<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    provider: &ProviderSyncPayload,
) -> Result<(), String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::PUT,
        &format!("/sync/providers/{}", provider.id),
        Some(serde_json::to_value(provider).map_err(|error| error.to_string())?),
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud provider upload", response));
    }
    Ok(())
}

fn put_remote_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<(), String> {
    let account = collect_local_account(app, id)?;
    upsert_remote_account_payload(app, client, settings, credentials, &account)?;
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(())
}

fn put_remote_provider<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<(), String> {
    let provider = collect_local_provider(app, id)?;
    upsert_remote_provider_payload(app, client, settings, credentials, &provider)?;
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(())
}

fn delete_remote_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<(), String> {
    let response = cloud_request(
        app,
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

fn delete_remote_provider<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<(), String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::DELETE,
        &format!("/sync/providers/{id}"),
        None,
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud provider delete", response));
    }
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(())
}

#[tauri::command]
pub(crate) fn get_cloud_auth_state<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudAuthState, String> {
    let _credentials_guard = lock_cloud_credentials()?;
    let settings = read_app_settings(&app)?;
    let credentials = read_cloud_credentials(&app);
    Ok(cloud_state(&settings, &credentials))
}

#[tauri::command]
pub(crate) async fn get_saved_cloud_login<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<SavedCloudLogin>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let settings = read_app_settings(&app)?;
        read_saved_cloud_login(&settings)
    })
    .await
    .map_err(|error| format!("Saved cloud login task failed: {error}"))?
}

#[tauri::command]
pub(crate) fn set_cloud_base_url<R: Runtime>(
    app: tauri::AppHandle<R>,
    base_url: String,
) -> Result<CloudAuthState, String> {
    let _credentials_guard = lock_cloud_credentials()?;
    let mut settings = read_app_settings(&app)?;
    let normalized = normalize_base_url(&base_url)?;
    if settings.cloud_base_url != normalized {
        clear_cloud_profile(&mut settings);
        settings.cloud_session_expired = false;
        clear_cloud_credentials(&app)?;
    }
    settings.cloud_base_url = normalized;
    if settings.cloud_base_url.is_none() {
        clear_cloud_profile(&mut settings);
        settings.cloud_session_expired = false;
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
    remember_password: bool,
) -> Result<CloudAuthenticationResult, String> {
    cloud_authenticate(
        app,
        email,
        password,
        None,
        remember_password,
        "/auth/login",
        "Cloud login",
    )
    .await
}

fn feedback_form(
    content: &str,
    version: &str,
    platform: &str,
    contact_email: Option<&str>,
    images: &[FeedbackImage],
) -> Result<multipart::Form, String> {
    let mut form = multipart::Form::new()
        .text("content", content.to_string())
        .text("version", version.to_string())
        .text("platform", platform.to_string());
    if let Some(contact_email) = contact_email {
        form = form.text("email", contact_email.to_string());
    }
    for image in images {
        let part = multipart::Part::bytes(image.data.clone())
            .file_name(image.file_name.clone())
            .mime_str(&image.mime_type)
            .map_err(|error| format!("Feedback image type is invalid: {error}"))?;
        form = form.part("images", part);
    }
    Ok(form)
}

fn validate_feedback(
    content: &str,
    version: &str,
    platform: &str,
    contact_email: Option<&str>,
    images: &[FeedbackImage],
) -> Result<(), String> {
    if content.trim().is_empty() || content.chars().count() > 5_000 {
        return Err("Feedback must contain between 1 and 5000 characters".to_string());
    }
    if version.trim().is_empty() || version.chars().count() > 40 {
        return Err("Feedback version is invalid".to_string());
    }
    if platform.trim().is_empty() || platform.chars().count() > 500 {
        return Err("Feedback platform information is invalid".to_string());
    }
    if let Some(contact_email) = contact_email {
        if contact_email.len() > 160 || !contact_email.contains('@') {
            return Err("Feedback contact email is invalid".to_string());
        }
    }
    if images.len() > MAX_FEEDBACK_IMAGES {
        return Err(format!(
            "At most {MAX_FEEDBACK_IMAGES} feedback images are allowed"
        ));
    }
    for image in images {
        if !FEEDBACK_IMAGE_MIME_TYPES.contains(&image.mime_type.as_str()) {
            return Err("Only JPEG, PNG and WebP feedback images are supported".to_string());
        }
        if image.data.len() > MAX_FEEDBACK_IMAGE_BYTES {
            return Err("Each feedback image must not exceed 5 MB".to_string());
        }
    }
    Ok(())
}

fn installation_state_path<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data directory: {error}"))?
        .join("installation.json"))
}

fn read_or_create_installation_state<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<InstallationState, String> {
    let path = installation_state_path(app)?;
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(state) = serde_json::from_slice::<InstallationState>(&bytes) {
            if Uuid::parse_str(&state.device_id).is_ok() {
                return Ok(state);
            }
        }
    }
    let state = InstallationState {
        device_id: Uuid::new_v4().to_string(),
        platform: std::env::consts::OS.to_string(),
        reported_at: None,
        reported_version: None,
    };
    let value = serde_json::to_value(&state).map_err(|error| error.to_string())?;
    write_json_atomic(&path, &value)?;
    Ok(state)
}

fn post_device_event<R: Runtime>(
    app: &tauri::AppHandle<R>,
    installation: &InstallationState,
    event_type: &str,
) -> Result<(), String> {
    let client = api_client()?;
    let settings = read_app_settings(app)?;
    let app_version = app.package_info().version.to_string();
    let response = client
        .post(endpoint(&settings, "/telemetry/installations")?)
        .header("Accept", "application/json")
        .json(&json!({
            "deviceId": installation.device_id,
            "platform": installation.platform,
            "appVersion": app_version,
            "eventType": event_type,
        }))
        .send()
        .map_err(|error| format!("Device event report failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Device event report", response));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn fetch_cloud_announcement<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudAnnouncement, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let settings = read_app_settings(&app)?;
        let response = client
            .get(endpoint(&settings, "/announcements/current")?)
            .header("Accept", "application/json")
            .send()
            .map_err(|error| format!("Announcement request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error("Announcement request", response));
        }
        response
            .json()
            .map_err(|error| format!("Announcement response is invalid: {error}"))
    })
    .await
    .map_err(|error| format!("Announcement request task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn fetch_cloud_notifications<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<CloudNotification>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let settings = read_app_settings(&app)?;
        let response = client
            .get(endpoint(&settings, "/notifications/recent")?)
            .header("Accept", "application/json")
            .send()
            .map_err(|error| format!("Notification request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error("Notification request", response));
        }
        response
            .json()
            .map_err(|error| format!("Notification response is invalid: {error}"))
    })
    .await
    .map_err(|error| format!("Notification request task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn report_announcement_click<R: Runtime>(
    app: tauri::AppHandle<R>,
    link: String,
    announcement_updated_at: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let installation = read_or_create_installation_state(&app)?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        let authenticated =
            credentials.access_token.is_some() && credentials.refresh_token.is_some();
        let path = if authenticated {
            "/announcements/clicks/authenticated"
        } else {
            "/announcements/clicks"
        };
        let payload = json!({
            "deviceId": installation.device_id,
            "platform": installation.platform,
            "link": link,
            "announcementUpdatedAt": announcement_updated_at,
        });

        let response = if authenticated {
            let response = cloud_request(
                &app,
                &client,
                &mut settings,
                &mut credentials,
                Method::POST,
                path,
                Some(payload),
            )?;
            write_app_settings(&app, &settings)?;
            write_cloud_credentials(&app, &credentials)?;
            response
        } else {
            client
                .post(endpoint(&settings, path)?)
                .header("Accept", "application/json")
                .json(&payload)
                .send()
                .map_err(|error| format!("Announcement click report failed: {error}"))?
        };
        if !response.status().is_success() {
            return Err(response_error("Announcement click report", response));
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Announcement click report task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn submit_feedback<R: Runtime>(
    app: tauri::AppHandle<R>,
    content: String,
    version: String,
    platform: String,
    contact_email: Option<String>,
    images: Vec<FeedbackImageInput>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let images = decode_feedback_images(images)?;
        let contact_email = contact_email
            .as_deref()
            .map(str::trim)
            .filter(|email| !email.is_empty());
        validate_feedback(&content, &version, &platform, contact_email, &images)?;
        let client = feedback_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        let authenticated =
            credentials.access_token.is_some() && credentials.refresh_token.is_some();
        let path = if authenticated {
            "/feedback/authenticated"
        } else {
            "/feedback"
        };
        let mut final_response = None;

        for attempt in 0..if authenticated { 2 } else { 1 } {
            let mut request = client
                .post(endpoint(&settings, path)?)
                .header("Accept", "application/json")
                .multipart(feedback_form(
                    &content,
                    &version,
                    &platform,
                    contact_email,
                    &images,
                )?);
            if let Some(access_token) = credentials.access_token.as_ref().filter(|_| authenticated)
            {
                request = request.bearer_auth(access_token);
            }
            let response = request
                .send()
                .map_err(|error| format!("Feedback submission failed: {error}"))?;
            if !authenticated || response.status() != StatusCode::UNAUTHORIZED || attempt == 1 {
                final_response = Some(response);
                break;
            }
            refresh_cloud_token(&app, &client, &mut settings, &mut credentials)?;
        }

        if authenticated {
            write_app_settings(&app, &settings)?;
            write_cloud_credentials(&app, &credentials)?;
        }
        let response = final_response.ok_or_else(|| "Feedback submission failed".to_string())?;
        if !response.status().is_success() {
            return Err(response_error("Feedback submission", response));
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Feedback submission task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn report_first_installation<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut installation = read_or_create_installation_state(&app)?;
        let app_version = app.package_info().version.to_string();
        if installation.reported_at.is_some()
            && installation.reported_version.as_deref() == Some(app_version.as_str())
        {
            return Ok(false);
        }

        post_device_event(&app, &installation, "installation")?;

        if installation.reported_at.is_none() {
            installation.reported_at = Some(Utc::now().to_rfc3339());
        }
        installation.reported_version = Some(app_version);
        let value = serde_json::to_value(&installation).map_err(|error| error.to_string())?;
        write_json_atomic(&installation_state_path(&app)?, &value)?;
        Ok(true)
    })
    .await
    .map_err(|error| format!("Installation report task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn report_base_url_change<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let installation = read_or_create_installation_state(&app)?;
        post_device_event(&app, &installation, "base_url_changed")
    })
    .await
    .map_err(|error| format!("Base URL change report task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_register<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
    password: String,
    verification_code: String,
    remember_password: bool,
) -> Result<CloudAuthenticationResult, String> {
    cloud_authenticate(
        app,
        email,
        password,
        Some(verification_code),
        remember_password,
        "/auth/register",
        "Cloud registration",
    )
    .await
}

#[tauri::command]
pub(crate) async fn cloud_change_password<R: Runtime>(
    app: tauri::AppHandle<R>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        let remembered_new_password = new_password.clone();
        let response = cloud_request(
            &app,
            &client,
            &mut settings,
            &mut credentials,
            Method::PATCH,
            "/admin/api/profile/password",
            Some(json!({
                "currentPassword": current_password,
                "newPassword": new_password,
            })),
        )?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        if !response.status().is_success() {
            return Err(response_error("Cloud password change", response));
        }
        if let Ok(Some(mut saved_login)) = read_saved_cloud_login(&settings) {
            if settings.cloud_user_email.as_deref() == Some(saved_login.email.as_str()) {
                saved_login.password = remembered_new_password;
                if let Err(error) = update_saved_cloud_login(&settings, Some(&saved_login)) {
                    eprintln!("could not update saved cloud login after password change: {error}");
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Cloud password change task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_request_registration_code<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let settings = read_app_settings(&app)?;
        let response = client
            .post(endpoint(&settings, "/auth/register/code")?)
            .json(&json!({ "email": email }))
            .send()
            .map_err(|error| format!("Verification code request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error("Verification code request", response));
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Verification code request task failed: {error}"))?
}

async fn cloud_authenticate<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
    password: String,
    verification_code: Option<String>,
    remember_password: bool,
    path: &'static str,
    action: &'static str,
) -> Result<CloudAuthenticationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let saved_login = SavedCloudLogin {
            email: email.trim().to_string(),
            password: password.clone(),
        };
        let mut payload = json!({ "email": email, "password": password });
        if let Some(code) = verification_code {
            payload["verificationCode"] = Value::String(code);
        }
        let response = client
            .post(endpoint(&settings, path)?)
            .json(&payload)
            .send()
            .map_err(|error| format!("{action} failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error(action, response));
        }
        let tokens: CloudTokenResponse = response
            .json()
            .map_err(|error| format!("{action} response is invalid: {error}"))?;
        let mut credentials = CloudCredentials {
            access_token: Some(tokens.access_token),
            refresh_token: Some(tokens.refresh_token),
            device_id: Some(read_or_create_installation_state(&app)?.device_id),
        };
        if let Some(user) = tokens.user {
            settings.cloud_user_id = Some(user.id);
            settings.cloud_user_email = Some(user.email);
        }
        settings.cloud_session_expired = false;
        // A returning device may hold an older local copy. Merge the cloud state first so a
        // login cannot immediately publish that stale copy over newer cloud fields.
        let remote_accounts = get_remote_accounts(&app, &client, &mut settings, &mut credentials)?;
        for account_id in &remote_accounts.deleted_account_ids {
            apply_remote_account_deletion(&app, account_id)?;
        }
        for account in remote_accounts.accounts {
            apply_remote_account(&app, &account)?;
        }
        for provider in get_remote_providers(&app, &client, &mut settings, &mut credentials)? {
            apply_remote_provider(&app, &provider)?;
        }
        let _ = put_remote_accounts(&app, &client, &mut settings, &mut credentials)?;
        let _ = put_remote_providers(&app, &client, &mut settings, &mut credentials)?;
        let (password_saved, credential_storage_updated) = if remember_password {
            match update_saved_cloud_login(&settings, Some(&saved_login)) {
                Ok(()) => (true, true),
                Err(error) => {
                    eprintln!("could not save cloud login: {error}");
                    (false, false)
                }
            }
        } else {
            match update_saved_cloud_login(&settings, None) {
                Ok(()) => (false, true),
                Err(error) => {
                    eprintln!("could not remove saved cloud login: {error}");
                    (false, false)
                }
            }
        };
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        Ok(CloudAuthenticationResult {
            state: cloud_state(&settings, &credentials),
            password_saved,
            credential_storage_updated,
        })
    })
    .await
    .map_err(|error| format!("{action} task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_logout<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudAuthState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
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
        settings.cloud_session_expired = false;
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
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        let uploaded = put_remote_accounts(&app, &client, &mut settings, &mut credentials)?
            + put_remote_providers(&app, &client, &mut settings, &mut credentials)?;
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
        let _credentials_guard = lock_cloud_credentials()?;
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
pub(crate) async fn cloud_push_providers<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        let uploaded = put_remote_providers(&app, &client, &mut settings, &mut credentials)?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        Ok(CloudSyncResult {
            uploaded,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud provider upload task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_push_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        put_remote_provider(&app, &client, &mut settings, &mut credentials, &id)?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        Ok(CloudSyncResult {
            uploaded: 1,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud provider upload task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_delete_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        delete_remote_account(&app, &client, &mut settings, &mut credentials, &id)?;
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
pub(crate) async fn cloud_delete_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        delete_remote_provider(&app, &client, &mut settings, &mut credentials, &id)?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        Ok(CloudSyncResult {
            uploaded: 0,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud provider delete task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_sync_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        let local_ids = collect_local_accounts(&app)?
            .into_iter()
            .map(|account| account.id)
            .collect::<HashSet<_>>();
        let local_provider_ids = collect_local_providers(&app)?
            .into_iter()
            .map(|provider| provider.id)
            .collect::<HashSet<_>>();
        let remote_accounts = get_remote_accounts(&app, &client, &mut settings, &mut credentials)?;
        let mut downloaded = 0;
        for account_id in &remote_accounts.deleted_account_ids {
            if apply_remote_account_deletion(&app, account_id)? {
                downloaded += 1;
            }
        }
        for account in remote_accounts.accounts {
            let is_new = !local_ids.contains(&account.id);
            let applied = apply_remote_account(&app, &account)?;
            if is_new || applied {
                downloaded += 1;
            }
        }
        let mut providers_downloaded = 0;
        for provider in get_remote_providers(&app, &client, &mut settings, &mut credentials)? {
            let is_new = !local_provider_ids.contains(&provider.id);
            let applied = apply_remote_provider(&app, &provider)?;
            if is_new || applied {
                providers_downloaded += 1;
            }
        }
        downloaded += providers_downloaded;
        let uploaded = put_remote_accounts(&app, &client, &mut settings, &mut credentials)?
            + put_remote_providers(&app, &client, &mut settings, &mut credentials)?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        if downloaded > 0 {
            app.emit("accounts-changed", ())
                .map_err(|error| error.to_string())?;
            crate::system_tray::refresh_menu(&app);
        }
        if providers_downloaded > 0 {
            app.emit("providers-changed", ())
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

#[cfg(test)]
mod tests {
    use super::{
        cloud_state, persist_cloud_token_response, refresh_rejection_expires_cloud_session,
        saved_cloud_login_service, CloudAccountsResponse, CloudCredentials, CloudTokenResponse,
        CloudUserResponse,
    };
    use crate::models::AppSettings;
    use reqwest::StatusCode;

    #[test]
    fn cloud_account_response_accepts_soft_delete_tombstones() {
        let response: CloudAccountsResponse =
            serde_json::from_str(r#"{"accounts":[],"deletedAccountIds":["account-1"]}"#).unwrap();

        assert!(response.accounts.is_empty());
        assert_eq!(response.deleted_account_ids, ["account-1"]);
    }

    #[test]
    fn refreshed_credentials_are_persisted_before_followup_work() {
        let mut settings = AppSettings::default();
        let mut credentials = CloudCredentials {
            access_token: Some("old-access".to_string()),
            refresh_token: Some("old-refresh".to_string()),
            device_id: Some("device-1".to_string()),
        };
        let mut persisted_credentials = None;

        persist_cloud_token_response(
            &mut settings,
            &mut credentials,
            CloudTokenResponse {
                access_token: "new-access".to_string(),
                refresh_token: "new-refresh".to_string(),
                user: Some(CloudUserResponse {
                    id: "user-1".to_string(),
                    email: "user@example.com".to_string(),
                }),
            },
            |credentials| {
                persisted_credentials = Some(credentials.clone());
                Ok(())
            },
            |_| Ok(()),
        )
        .unwrap();

        let followup_result: Result<(), String> = Err("sync failed".to_string());
        assert!(followup_result.is_err());
        assert_eq!(
            persisted_credentials.unwrap().refresh_token.as_deref(),
            Some("new-refresh")
        );
    }

    #[test]
    fn credential_rotation_is_saved_before_profile_settings() {
        let mut settings = AppSettings::default();
        let mut credentials = CloudCredentials::default();
        let mut credential_write_completed = false;

        let result = persist_cloud_token_response(
            &mut settings,
            &mut credentials,
            CloudTokenResponse {
                access_token: "new-access".to_string(),
                refresh_token: "new-refresh".to_string(),
                user: None,
            },
            |_| {
                credential_write_completed = true;
                Ok(())
            },
            |_| Err("settings write failed".to_string()),
        );

        assert_eq!(result.unwrap_err(), "settings write failed");
        assert!(credential_write_completed);
    }

    #[test]
    fn saved_logins_are_isolated_by_cloud_server() {
        let mut first = AppSettings::default();
        first.cloud_base_url = Some("https://cloud-one.example".to_string());
        let mut second = AppSettings::default();
        second.cloud_base_url = Some("https://cloud-two.example".to_string());

        let first_service = saved_cloud_login_service(&first).unwrap();
        let second_service = saved_cloud_login_service(&second).unwrap();

        assert_ne!(first_service, second_service);
        assert!(first_service.starts_with("codex-switch-cloud-login-"));
        assert!(!first_service.contains("cloud-one.example"));
    }

    #[test]
    fn rejected_refresh_marks_the_cloud_state_for_reauthentication() {
        assert!(refresh_rejection_expires_cloud_session(
            StatusCode::UNAUTHORIZED
        ));
        assert!(refresh_rejection_expires_cloud_session(
            StatusCode::FORBIDDEN
        ));
        assert!(!refresh_rejection_expires_cloud_session(
            StatusCode::SERVICE_UNAVAILABLE
        ));

        let mut settings = AppSettings::default();
        settings.cloud_session_expired = true;
        let state = cloud_state(&settings, &CloudCredentials::default());
        assert!(state.session_expired);
        assert!(!state.authenticated);
    }
}
