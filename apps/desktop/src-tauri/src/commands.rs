use std::{
    fs,
    path::Path,
    process::{Command, Output},
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use chrono::{NaiveDate, Utc};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Runtime};
use tauri_plugin_opener::OpenerExt;

use crate::{
    auth::{account_fields, validate_auth},
    codex_api::{
        consume_reset_credit_request, parse_reset_credits, parse_usage, refresh_tokens,
        reset_credits_request, token_expiring, usage_request,
    },
    models::{AccountSummary, AppInfo, ManagerStateFile, ResetCreditsSummary, UsageSummary},
    storage::{
        account_dir, expiration_path, import_value, load_expiration, load_note, load_usage,
        managed_auth_path, note_path, read_json, read_state, resolve_paths, save_expiration,
        save_note, save_usage, sync_current_into_store, touch_account_modified, usage_path,
        write_json_atomic, write_json_if_changed, write_managed_auth_if_changed, write_state,
        Paths,
    },
};

const CHATGPT_COMMAND: &str = "chatgpt";
#[cfg(unix)]
const LEGACY_CODEX_COMMAND: &str = "codex";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static ACCOUNT_AUTO_SWITCH_STATE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn account_auto_switch_state_lock() -> &'static Mutex<()> {
    ACCOUNT_AUTO_SWITCH_STATE_LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(target_os = "windows")]
enum ChatGptLaunchTarget {
    ShellApp(String),
    Executable(String),
}

#[cfg(not(target_os = "windows"))]
type ChatGptLaunchTarget = String;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ManagedFolder {
    CodexHome,
    AccountStore,
}

#[tauri::command]
pub(crate) fn get_app_info<R: Runtime>(app: tauri::AppHandle<R>) -> Result<AppInfo, String> {
    let paths = resolve_paths(&app)?;
    Ok(AppInfo {
        codex_home: paths.codex_home.display().to_string(),
        auth_path: paths.current_auth.display().to_string(),
        config_path: paths.current_config.display().to_string(),
        account_store: paths.accounts.display().to_string(),
        provider_store: paths.providers.display().to_string(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub(crate) fn open_managed_folder<R: Runtime>(
    app: tauri::AppHandle<R>,
    target: ManagedFolder,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let path = match target {
        ManagedFolder::CodexHome => paths.codex_home,
        ManagedFolder::AccountStore => paths.accounts,
    };
    fs::create_dir_all(&path)
        .map_err(|error| format!("Failed to create {}: {error}", path.display()))?;
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))
}

#[tauri::command]
pub(crate) fn list_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<AccountSummary>, String> {
    // 非 ChatGPT 模式或损坏的当前 auth.json 不应阻止管理器打开。
    let _ = sync_current_into_store(&app);
    let paths = resolve_paths(&app)?;
    fs::create_dir_all(&paths.accounts).map_err(|error| format!("创建账户目录失败：{error}"))?;
    let state = read_state(&paths);
    let active_id = state.active_account_id.clone();
    let mut accounts = Vec::new();
    for entry in
        fs::read_dir(&paths.accounts).map_err(|error| format!("读取账户目录失败：{error}"))?
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
        let (email, plan, account_id, id) = account_fields(&auth)?;
        let auto_switch_enabled = !state.disabled_account_ids.contains(&id);
        accounts.push(AccountSummary {
            active: active_id.as_deref() == Some(&id),
            usage: load_usage(&usage_path(&paths, &id)),
            note: load_note(&note_path(&paths, &id)),
            expires_at: load_expiration(&expiration_path(&paths, &id)),
            id,
            email,
            plan,
            account_id,
            auto_switch_enabled,
        });
    }
    accounts.sort_by(|left, right| left.email.cmp(&right.email));
    Ok(accounts)
}

#[tauri::command]
pub(crate) fn import_auth_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<String, String> {
    let auth = read_json(Path::new(&path))?;
    let id = import_value(&app, auth, false)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    Ok(id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompatibleJsonImportResult {
    pub(crate) imported_ids: Vec<String>,
}

#[derive(Default)]
struct CompatibleJsonAuthTokens {
    id_token: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
}

impl CompatibleJsonAuthTokens {
    fn has_any(&self) -> bool {
        self.id_token.is_some() || self.access_token.is_some() || self.refresh_token.is_some()
    }
}

/// Imports the common Codex token layouts used by account managers and session exports.
/// The stored result is always reduced to this app's canonical auth.json shape before validation.
#[tauri::command]
pub(crate) fn import_compatible_json_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<CompatibleJsonImportResult, String> {
    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取 {} 失败：{error}", path))?;
    let auth_values = parse_compatible_json_auth_values(&content)?;
    let mut imported_ids = Vec::new();

    for (index, value) in auth_values.iter().enumerate() {
        let auth = normalize_compatible_json_auth(value)
            .map_err(|error| format!("第 {} 个账号无法导入：{error}", index + 1))?;
        let id = import_value(&app, auth, false)?;
        if !imported_ids.contains(&id) {
            imported_ids.push(id);
        }
    }

    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    Ok(CompatibleJsonImportResult { imported_ids })
}

fn parse_compatible_json_auth_values(content: &str) -> Result<Vec<Value>, String> {
    let content = content.trim_start_matches('\u{feff}').trim();
    if content.is_empty() {
        return Err("导入文件为空".to_string());
    }

    match serde_json::from_str::<Value>(content) {
        Ok(Value::Array(items)) if !items.is_empty() => Ok(items),
        Ok(Value::Array(_)) => Err("导入文件中没有账号".to_string()),
        Ok(Value::Object(object)) => {
            if let Some(accounts) = object.get("accounts").and_then(Value::as_array) {
                if accounts.is_empty() {
                    return Err("导入文件中没有账号".to_string());
                }
                return Ok(accounts.clone());
            }
            Ok(vec![Value::Object(object)])
        }
        Ok(_) => Err("导入文件顶层必须是 JSON 对象或数组".to_string()),
        Err(parse_error) => parse_line_delimited_compatible_json(content)
            .map_err(|line_error| format!("JSON 格式无效：{parse_error}；{line_error}")),
    }
}

fn parse_line_delimited_compatible_json(content: &str) -> Result<Vec<Value>, String> {
    let lines: Vec<(usize, &str)> = content
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let trimmed = line.trim();
            (!trimmed.is_empty()).then_some((index + 1, trimmed))
        })
        .collect();
    if lines.len() <= 1 {
        return Err("请提供完整 JSON，或每行一个 JSON 对象".to_string());
    }

    lines
        .into_iter()
        .map(|(line_number, line)| {
            let value = serde_json::from_str::<Value>(line)
                .map_err(|error| format!("第 {line_number} 行不是有效 JSON：{error}"))?;
            if value.is_object() {
                Ok(value)
            } else {
                Err(format!("第 {line_number} 行必须是 JSON 对象"))
            }
        })
        .collect()
}

fn normalize_compatible_json_auth(value: &Value) -> Result<Value, String> {
    let tokens = extract_compatible_json_tokens(value, 0).ok_or_else(|| {
        "未找到可用的 Codex token；支持 access_token/accessToken、完整 tokens、session/session_json 或 refresh_token"
            .to_string()
    })?;

    let mut token_object = serde_json::Map::new();
    if let Some(access_token) = tokens.access_token {
        token_object.insert("access_token".to_string(), Value::String(access_token));
    }
    if let Some(id_token) = tokens
        .id_token
        .filter(|token| crate::auth::decode_jwt(token).is_ok())
    {
        token_object.insert("id_token".to_string(), Value::String(id_token));
    }
    if let Some(refresh_token) = tokens.refresh_token {
        token_object.insert("refresh_token".to_string(), Value::String(refresh_token));
    }

    let mut auth_object = serde_json::Map::new();
    auth_object.insert("tokens".to_string(), Value::Object(token_object));
    let mut auth = Value::Object(auth_object);

    if crate::auth::token_string(&auth, "access_token").is_none() {
        let client = api_client()?;
        refresh_tokens(&client, &mut auth)?;
    }

    validate_auth(&auth)?;
    Ok(auth)
}

fn extract_compatible_json_tokens(value: &Value, depth: usize) -> Option<CompatibleJsonAuthTokens> {
    if depth > 4 {
        return None;
    }

    let tokens = CompatibleJsonAuthTokens {
        id_token: first_compatible_json_string(
            value,
            &[
                &["id_token"],
                &["idToken"],
                &["tokens", "id_token"],
                &["tokens", "idToken"],
                &["credentials", "id_token"],
                &["credentials", "idToken"],
            ],
        ),
        access_token: first_compatible_json_string(
            value,
            &[
                &["access_token"],
                &["accessToken"],
                &["tokens", "access_token"],
                &["tokens", "accessToken"],
                &["credentials", "access_token"],
                &["credentials", "accessToken"],
            ],
        ),
        refresh_token: first_compatible_json_string(
            value,
            &[
                &["refresh_token"],
                &["refreshToken"],
                &["tokens", "refresh_token"],
                &["tokens", "refreshToken"],
                &["credentials", "refresh_token"],
                &["credentials", "refreshToken"],
            ],
        ),
    };
    if tokens.has_any() {
        return Some(tokens);
    }

    let object = value.as_object()?;
    for key in [
        "auth",
        "auth_json",
        "authJson",
        "session",
        "session_json",
        "sessionJson",
    ] {
        let Some(nested) = object.get(key) else {
            continue;
        };
        match nested {
            Value::Object(_) => {
                if let Some(tokens) = extract_compatible_json_tokens(nested, depth + 1) {
                    return Some(tokens);
                }
            }
            Value::String(raw) => {
                let parsed = serde_json::from_str::<Value>(raw).ok()?;
                if let Some(tokens) = extract_compatible_json_tokens(&parsed, depth + 1) {
                    return Some(tokens);
                }
            }
            _ => {}
        }
    }
    None
}

fn first_compatible_json_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| {
        let mut current = value;
        for key in *path {
            current = current.get(*key)?;
        }
        current
            .as_str()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToOwned::to_owned)
    })
}

#[tauri::command]
pub(crate) fn switch_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    // 尽力保存 Codex 在上次切换后自行刷新的 token。
    let _ = sync_current_into_store(&app);
    let paths = resolve_paths(&app)?;
    let selected = read_json(&managed_auth_path(&paths, &id))?;
    validate_auth(&selected)?;
    write_json_atomic(&paths.current_auth, &selected)?;
    let mut state = read_state(&paths);
    state.active_account_id = Some(id.clone());
    write_state(&paths, &state)?;
    if crate::local_proxy::is_running() {
        crate::providers::apply_local_proxy_config_for_paths(&paths)?;
    }
    touch_account_modified(&paths, &id)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn set_account_auto_switch_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if !managed_auth_path(&paths, &id).exists() {
        return Err("Account does not exist".to_string());
    }

    set_account_auto_switch_enabled_for_paths(&paths, &id, enabled)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn update_disabled_account_ids(state: &mut ManagerStateFile, id: &str, enabled: bool) -> bool {
    let was_disabled = state
        .disabled_account_ids
        .iter()
        .any(|account_id| account_id == id);
    let should_be_disabled = !enabled;
    if enabled {
        state
            .disabled_account_ids
            .retain(|account_id| account_id != id);
    } else if !was_disabled {
        state.disabled_account_ids.push(id.to_string());
        state.disabled_account_ids.sort();
    }
    was_disabled != should_be_disabled
}

fn set_account_auto_switch_enabled_for_paths(
    paths: &Paths,
    id: &str,
    enabled: bool,
) -> Result<bool, String> {
    let _guard = account_auto_switch_state_lock()
        .lock()
        .map_err(|_| "Account auto-switch state lock is poisoned".to_string())?;
    let mut state = read_state(&paths);
    let changed = update_disabled_account_ids(&mut state, id, enabled);
    if changed {
        write_state(paths, &state)?;
    }
    Ok(changed)
}

#[tauri::command]
pub(crate) fn delete_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if read_state(&paths).active_account_id.as_deref() == Some(&id) {
        return Err("不能删除当前正在使用的账户，请先切换到其他账户".to_string());
    }
    let target = account_dir(&paths, &id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| format!("删除账户失败：{error}"))?;
    }
    set_account_auto_switch_enabled_for_paths(&paths, &id, true)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn restart_chatgpt() -> Result<(), String> {
    let launch_target = chatgpt_launch_target();
    stop_chatgpt_processes()?;
    thread::sleep(Duration::from_millis(450));
    start_chatgpt(launch_target.as_ref())
}

fn api_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建网络客户端失败：{error}"))
}

fn refresh_auth_if_needed(
    client: &Client,
    auth: &mut Value,
    paths: &Paths,
    id: &str,
) -> Result<(), String> {
    if token_expiring(auth) {
        refresh_tokens(client, auth)?;
        persist_request_auth(paths, id, auth)?;
    }
    Ok(())
}

fn is_active_account(paths: &Paths, id: &str) -> bool {
    read_state(paths).active_account_id.as_deref() == Some(id)
}

fn mark_active_account(paths: &Paths, id: &str) -> Result<bool, String> {
    let mut state = read_state(paths);
    if state.active_account_id.as_deref() == Some(id) {
        return Ok(false);
    }
    state.active_account_id = Some(id.to_string());
    write_state(paths, &state)?;
    Ok(true)
}

fn load_auth_for_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &Paths,
    id: &str,
) -> Result<Value, String> {
    let managed_path = managed_auth_path(paths, id);
    let state_says_active = is_active_account(paths, id);
    let current_auth = read_json(&paths.current_auth).and_then(|auth| {
        validate_auth(&auth)?;
        let (_, _, _, current_id) = account_fields(&auth)?;
        Ok((auth, current_id))
    });

    match current_auth {
        Ok((auth, current_id)) if current_id == id => {
            write_managed_auth_if_changed(paths, id, &auth)?;
            let active_changed = mark_active_account(paths, id)?;
            if active_changed {
                touch_account_modified(paths, id)?;
                app.emit("accounts-changed", ())
                    .map_err(|error| error.to_string())?;
                crate::system_tray::refresh_menu(app);
            }
            return Ok(auth);
        }
        Ok((auth, current_id)) if state_says_active => {
            write_managed_auth_if_changed(paths, &current_id, &auth)?;
            if mark_active_account(paths, &current_id)? {
                touch_account_modified(paths, &current_id)?;
            }
            app.emit("accounts-changed", ())
                .map_err(|error| error.to_string())?;
            crate::system_tray::refresh_menu(app);
            return Err(
                "当前 Codex auth.json 已切换到其他账户，已同步到账户列表，请重新选择后刷新"
                    .to_string(),
            );
        }
        Ok(_) => {}
        Err(error) if state_says_active => {
            return Err(format!("当前 Codex auth.json 不可用：{error}"));
        }
        Err(_) => {}
    }

    read_json(&managed_path)
}

fn persist_request_auth(paths: &Paths, id: &str, auth: &Value) -> Result<(), String> {
    write_managed_auth_if_changed(paths, id, auth)?;
    sync_active_auth(paths, id, auth)
}

#[tauri::command]
pub(crate) async fn refresh_usage<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<UsageSummary, String> {
    tauri::async_runtime::spawn_blocking(move || refresh_usage_blocking(app, id))
        .await
        .map_err(|error| format!("刷新用量任务失败：{error}"))?
}

#[tauri::command]
pub(crate) fn update_account_note<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    note: String,
    expires_at: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if !managed_auth_path(&paths, &id).exists() {
        return Err("Account does not exist".to_string());
    }
    if !expires_at.is_empty() {
        NaiveDate::parse_from_str(&expires_at, "%Y-%m-%d")
            .map_err(|_| "Expiration date must use YYYY-MM-DD format".to_string())?;
    }
    save_note(&note_path(&paths, &id), &note)?;
    save_expiration(&expiration_path(&paths, &id), &expires_at)?;
    touch_account_modified(&paths, &id)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn refresh_usage_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<UsageSummary, String> {
    match try_refresh_usage_blocking(&app, &id) {
        Ok(usage) => Ok(usage),
        Err(error) => {
            if let Ok(paths) = resolve_paths(&app) {
                let cached = UsageSummary {
                    error: Some(error.clone()),
                    fetched_at: Some(Utc::now().to_rfc3339()),
                    ..load_usage(&usage_path(&paths, &id))
                };
                if save_usage(&usage_path(&paths, &id), &cached).is_ok() {
                    let _ = touch_account_modified(&paths, &id);
                }
                let disable_error =
                    set_account_auto_switch_enabled_for_paths(&paths, &id, false).err();
                let _ = app.emit("accounts-changed", ());
                crate::system_tray::refresh_menu(&app);
                if let Some(disable_error) = disable_error {
                    return Err(format!("{error}；自动禁用账号失败：{disable_error}"));
                }
            }
            Err(error)
        }
    }
}

fn try_refresh_usage_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<UsageSummary, String> {
    let paths = resolve_paths(app)?;
    let mut auth = load_auth_for_request(app, &paths, id)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, id)?;

    let mut response = usage_request(&client, &auth)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        refresh_tokens(&client, &mut auth)?;
        persist_request_auth(&paths, id, &auth)?;
        response = usage_request(&client, &auth)?;
    }

    if !response.status().is_success() {
        return Err(format!("Codex 用量接口返回 HTTP {}", response.status()));
    }

    let payload: Value = response
        .json()
        .map_err(|error| format!("解析用量响应失败：{error}"))?;
    let usage = parse_usage(&payload);
    save_usage(&usage_path(&paths, id), &usage)?;
    touch_account_modified(&paths, id)?;
    persist_request_auth(&paths, id, &auth)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(app);
    Ok(usage)
}

#[tauri::command]
pub(crate) async fn fetch_reset_credits<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<ResetCreditsSummary, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_reset_credits_blocking(app, id))
        .await
        .map_err(|error| format!("刷新重置卡任务失败：{error}"))?
}

fn fetch_reset_credits_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<ResetCreditsSummary, String> {
    let paths = resolve_paths(&app)?;
    let mut auth = load_auth_for_request(&app, &paths, &id)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, &id)?;

    fetch_reset_credits_with_retry(&client, &mut auth, &paths, &id)
}

fn fetch_reset_credits_with_retry(
    client: &Client,
    auth: &mut Value,
    paths: &Paths,
    id: &str,
) -> Result<ResetCreditsSummary, String> {
    let mut response = reset_credits_request(client, auth)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        refresh_tokens(client, auth)?;
        persist_request_auth(paths, id, auth)?;
        response = reset_credits_request(client, auth)?;
    }
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("凭证已失效，或请求未正确携带 Authorization，请重新登录".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("Codex 重置卡接口返回 HTTP {}", response.status()));
    }

    let payload: Value = response
        .json()
        .map_err(|error| format!("解析重置卡响应失败：{error}"))?;
    persist_request_auth(paths, id, auth)?;
    parse_reset_credits(&payload)
}

#[tauri::command]
pub(crate) async fn consume_reset_credit<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || consume_reset_credit_blocking(app, id))
        .await
        .map_err(|error| format!("使用重置卡任务失败：{error}"))?
}

fn consume_reset_credit_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let mut auth = load_auth_for_request(&app, &paths, &id)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, &id)?;

    let credits = fetch_reset_credits_with_retry(&client, &mut auth, &paths, &id)?;
    if credits.credits.is_empty() {
        return Err("当前账号没有可用重置卡".to_string());
    }

    let redeem_request_id = format!(
        "codex-switch-{}-{}",
        Utc::now().timestamp_millis(),
        rand::random::<u64>()
    );
    let mut response = consume_reset_credit_request(&client, &auth, &redeem_request_id)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        refresh_tokens(&client, &mut auth)?;
        persist_request_auth(&paths, &id, &auth)?;
        response = consume_reset_credit_request(&client, &auth, &redeem_request_id)?;
    }
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("凭证已失效，或请求未正确携带 Authorization，请重新登录".to_string());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Codex 重置卡使用接口返回 HTTP {}",
            response.status()
        ));
    }

    let payload: Value = response
        .json()
        .map_err(|error| format!("解析重置卡使用响应失败：{error}"))?;
    match payload.get("code").and_then(Value::as_str) {
        Some("reset") | Some("already_redeemed") => {
            persist_request_auth(&paths, &id, &auth)?;
            Ok(())
        }
        Some("no_credit") => Err("当前账号没有可用重置卡".to_string()),
        Some("nothing_to_reset") => Err("当前账号当前没有需要重置的用量窗口".to_string()),
        Some(code) => Err(format!("Codex 重置卡使用接口返回未知状态：{code}")),
        None => Err("Codex 重置卡使用接口响应缺少 code".to_string()),
    }
}

fn sync_active_auth(paths: &Paths, id: &str, auth: &Value) -> Result<(), String> {
    if is_active_account(paths, id) {
        write_json_if_changed(&paths.current_auth, auth)?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn chatgpt_launch_target() -> Option<ChatGptLaunchTarget> {
    windows_powershell_line(
        "$app = Get-StartApps | Where-Object { $_.Name -eq 'ChatGPT' -and $_.AppID -like 'OpenAI.Codex_*' } | Select-Object -First 1; if ($app) { $app.AppID }",
    )
    .map(ChatGptLaunchTarget::ShellApp)
    .or_else(|| {
        windows_powershell_line(
            "$app = Get-StartApps | Where-Object { $_.AppID -like 'OpenAI.Codex_*' -or $_.AppID -eq 'com.openai.codex' } | Select-Object -First 1; if ($app) { $app.AppID }",
        )
        .map(ChatGptLaunchTarget::ShellApp)
    })
    .or_else(|| {
        windows_powershell_line(
            "(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)",
        )
        .and_then(|path| normalize_windows_chatgpt_target(&path))
        .map(ChatGptLaunchTarget::Executable)
    })
    .or_else(|| {
        windows_powershell_line(
            "(Get-Process -Name codex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)",
        )
        .and_then(|path| normalize_windows_chatgpt_target(&path))
        .map(ChatGptLaunchTarget::Executable)
    })
    .or_else(|| {
        windows_powershell_line(
            "(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty InstallLocation)",
        )
        .and_then(|path| {
            let target = Path::new(&path).join("app").join("ChatGPT.exe");
            if target.exists() {
                Some(target.as_os_str().to_string_lossy().into_owned())
            } else {
                None
            }
        })
        .map(ChatGptLaunchTarget::Executable)
    })
}

#[cfg(not(target_os = "windows"))]
fn chatgpt_launch_target() -> Option<ChatGptLaunchTarget> {
    None
}

#[cfg(target_os = "windows")]
fn stop_chatgpt_processes() -> Result<(), String> {
    let output = windows_hidden_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "$processes = Get-Process -Name ChatGPT,codex -ErrorAction SilentlyContinue; if ($processes) { $processes | Stop-Process -Force -ErrorAction Stop }",
        ])
        .output()
        .map_err(|error| format!("停止 ChatGPT 失败：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_output_error("停止 ChatGPT 失败", &output))
    }
}

#[cfg(unix)]
fn stop_chatgpt_processes() -> Result<(), String> {
    stop_unix_process(CHATGPT_COMMAND)?;
    stop_unix_process(LEGACY_CODEX_COMMAND)?;
    #[cfg(target_os = "macos")]
    {
        stop_unix_process("ChatGPT")?;
        stop_unix_process("Codex")?;
    }
    Ok(())
}

#[cfg(unix)]
fn stop_unix_process(name: &str) -> Result<(), String> {
    let status = Command::new("pkill")
        .args(["-x", name])
        .status()
        .map_err(|error| format!("停止 ChatGPT 失败：{error}"))?;
    if status.success() || status.code() == Some(1) {
        Ok(())
    } else {
        Err(status_error("停止 ChatGPT 失败", status))
    }
}

#[cfg(target_os = "windows")]
fn start_chatgpt(target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    match target {
        Some(ChatGptLaunchTarget::ShellApp(app_id)) => {
            let app_uri = format!("shell:AppsFolder\\{app_id}");
            windows_hidden_command("explorer.exe")
                .arg(app_uri)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("启动 ChatGPT 失败：{error}"))
        }
        Some(ChatGptLaunchTarget::Executable(target)) => start_windows_executable(target),
        None => start_windows_executable(CHATGPT_COMMAND),
    }
}

#[cfg(target_os = "windows")]
fn start_windows_executable(target: &str) -> Result<(), String> {
    let mut command = windows_hidden_command(target);
    if let Some(parent) = Path::new(target)
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        command.current_dir(parent);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动 ChatGPT 失败：{error}"))
}

#[cfg(target_os = "windows")]
fn windows_hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(target_os = "windows")]
fn windows_powershell_line(script: &str) -> Option<String> {
    let output = windows_hidden_command("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

#[cfg(target_os = "windows")]
fn normalize_windows_chatgpt_target(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let target = Path::new(trimmed);
    if is_chatgpt_exe(target) {
        return Some(trimmed.to_string());
    }

    if is_codex_exe(target) {
        if let Some(resources) = target
            .parent()
            .filter(|parent| is_dir_named(parent, "resources"))
        {
            if let Some(app_dir) = resources.parent() {
                let app_target = app_dir.join("ChatGPT.exe");
                if app_target.exists() {
                    return Some(app_target.as_os_str().to_string_lossy().into_owned());
                }
            }
        }
    }

    Some(trimmed.to_string())
}

#[cfg(target_os = "windows")]
fn is_chatgpt_exe(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("ChatGPT.exe"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_codex_exe(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("codex.exe"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_dir_named(path: &Path, expected: &str) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn start_chatgpt(_target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    if matches!(Command::new("open").args(["-a", "ChatGPT"]).status(), Ok(status) if status.success())
    {
        return Ok(());
    }
    if matches!(Command::new("open").args(["-a", "Codex"]).status(), Ok(status) if status.success())
    {
        return Ok(());
    }

    let status = Command::new("osascript")
        .args([
            "-e",
            "tell application \"Terminal\" to activate",
            "-e",
            "tell application \"Terminal\" to do script \"chatgpt || codex\"",
        ])
        .status()
        .map_err(|error| format!("启动 ChatGPT 失败：{error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(status_error("启动 ChatGPT 失败", status))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn start_chatgpt(_target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    let terminals: &[(&str, &[&str])] = &[
        (
            "x-terminal-emulator",
            &["-e", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        (
            "gnome-terminal",
            &["--", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        (
            "konsole",
            &["-e", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        (
            "xfce4-terminal",
            &["-e", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        ("xterm", &["-e", "sh", "-lc", "exec chatgpt || exec codex"]),
    ];

    for (program, args) in terminals {
        match Command::new(program).args(*args).spawn() {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("启动 ChatGPT 失败：{error}")),
        }
    }

    Command::new(CHATGPT_COMMAND)
        .spawn()
        .or_else(|_| Command::new(LEGACY_CODEX_COMMAND).spawn())
        .map(|_| ())
        .map_err(|error| format!("启动 ChatGPT 失败：{error}"))
}

fn command_output_error(action: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    if detail.is_empty() {
        status_error(action, output.status)
    } else {
        format!("{action}：{detail}")
    }
}

fn status_error(action: &str, status: std::process::ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("{action}（退出码：{code}）"),
        None => format!("{action}（进程被信号终止）"),
    }
}

#[cfg(test)]
mod compatible_json_import_tests {
    use super::{
        normalize_compatible_json_auth, parse_compatible_json_auth_values,
        update_disabled_account_ids,
    };
    use crate::models::ManagerStateFile;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde_json::{json, Value};

    fn jwt(payload: Value) -> String {
        format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).expect("serialize JWT payload"))
        )
    }

    fn access_token() -> String {
        jwt(json!({
            "email": "compatible@example.com",
            "sub": "compatible-user",
            "https://api.openai.com/auth": {
                "chatgpt_plan_type": "plus",
                "chatgpt_account_id": "compatible-account"
            }
        }))
    }

    #[test]
    fn accepts_cockpit_style_account_arrays() {
        let token = access_token();
        let input = json!([{
            "email": "compatible@example.com",
            "tokens": {
                "idToken": token,
                "accessToken": token,
                "refreshToken": "refresh-token"
            }
        }])
        .to_string();

        let values = parse_compatible_json_auth_values(&input).expect("parse compatible array");
        assert_eq!(values.len(), 1);
        let auth = normalize_compatible_json_auth(&values[0]).expect("normalize account");

        assert_eq!(
            auth.pointer("/tokens/access_token").and_then(Value::as_str),
            Some(token.as_str())
        );
        assert_eq!(
            auth.pointer("/tokens/refresh_token")
                .and_then(Value::as_str),
            Some("refresh-token")
        );
    }

    #[test]
    fn unwraps_json_encoded_session_values() {
        let token = access_token();
        let session = json!({
            "idToken": token,
            "accessToken": token,
        });
        let input = json!({ "session_json": session.to_string() }).to_string();

        let values = parse_compatible_json_auth_values(&input).expect("parse session wrapper");
        let auth = normalize_compatible_json_auth(&values[0]).expect("normalize session");

        assert_eq!(
            auth.pointer("/tokens/access_token").and_then(Value::as_str),
            Some(token.as_str())
        );
    }

    #[test]
    fn updates_disabled_account_ids_without_duplicates() {
        let mut state = ManagerStateFile::default();

        assert!(update_disabled_account_ids(&mut state, "account-b", false));
        assert!(update_disabled_account_ids(&mut state, "account-a", false));
        assert!(!update_disabled_account_ids(&mut state, "account-a", false));
        assert_eq!(state.disabled_account_ids, ["account-a", "account-b"]);

        assert!(update_disabled_account_ids(&mut state, "account-a", true));
        assert!(!update_disabled_account_ids(&mut state, "account-a", true));
        assert_eq!(state.disabled_account_ids, ["account-b"]);
    }
}
