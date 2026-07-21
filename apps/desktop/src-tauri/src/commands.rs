use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use chrono::{NaiveDate, Utc};
use reqwest::blocking::Client;
use rusqlite::{params, Connection};
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
        save_note, save_usage, sync_current_into_store, touch_account_field, usage_path,
        write_json_atomic, write_json_if_changed, write_managed_auth_if_changed, write_state,
        AccountSyncField, Paths,
    },
};

#[cfg(unix)]
const CHATGPT_COMMAND: &str = "chatgpt";
const OFFICIAL_CONVERSATION_PROVIDER: &str = "openai";
const LOCAL_PROXY_CONVERSATION_PROVIDER: &str = "codex-switch-local";
#[cfg(unix)]
const LEGACY_CODEX_COMMAND: &str = "codex";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static ACCOUNT_AUTO_SWITCH_STATE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static ACCOUNT_SWITCH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn account_auto_switch_state_lock() -> &'static Mutex<()> {
    ACCOUNT_AUTO_SWITCH_STATE_LOCK.get_or_init(|| Mutex::new(()))
}

fn account_switch_lock() -> &'static Mutex<()> {
    ACCOUNT_SWITCH_LOCK.get_or_init(|| Mutex::new(()))
}

/// Import the externally managed credential only once, when Codex Switch starts.
/// Later operations deliberately use the managed account store instead.
pub(crate) fn initialize_local_state<R: Runtime>(app: &tauri::AppHandle<R>) {
    let _ = sync_current_into_store(app);
    refresh_local_codex_path(app);
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
pub(crate) enum ChatGptLaunchTarget {
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
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    refresh_local_codex_path(&app);
    switch_account_unlocked(&app, &id)
}

/// Switch an official account without ever exposing a running ChatGPT/Codex
/// process to the replacement credential.  The local proxy owns the active
/// credential while it is running, so proxy switches intentionally remain
/// hot and do not restart ChatGPT.
#[tauri::command]
pub(crate) fn switch_account_and_restart_chatgpt<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;

    // Refresh the launch hint for every account switch, including hot proxy
    // switches where no restart is needed.
    refresh_local_codex_path(&app);
    if crate::local_proxy::is_running() {
        return switch_account_unlocked(&app, &id);
    }

    // Validate the target before stopping ChatGPT so a malformed managed
    // credential cannot leave the user with a closed application.
    let paths = resolve_paths(&app)?;
    let selected = read_json(&managed_auth_path(&paths, &id))?;
    validate_auth(&selected)?;

    let launch_target = refresh_and_get_chatgpt_launch_target(&app);
    if chatgpt_or_codex_is_running()? {
        stop_chatgpt_processes()?;
        wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    // When no client is running, write the replacement credential immediately.
    // When one is running, the preceding shutdown gives the same guarantee.
    switch_account_unlocked(&app, &id)?;
    if crate::dream_skin::restart_active_session()? {
        return Ok(());
    }

    start_chatgpt(launch_target.as_ref()).map_err(|error| {
        format!(
            "账户已切换，但无法自动启动 ChatGPT/Codex（{error}）。请手动启动 ChatGPT 或 Codex。"
        )
    })
}

fn switch_account_unlocked<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) -> Result<(), String> {
    let proxy_running = crate::local_proxy::is_running();
    let paths = resolve_paths(app)?;
    let selected = read_json(&managed_auth_path(&paths, id))?;
    validate_auth(&selected)?;
    if !proxy_running {
        // The local proxy reads the selected managed credential.  Avoid modifying the
        // authentication file watched by the already-running Codex application.
        write_json_atomic(&paths.current_auth, &selected)?;
    }
    let mut state = read_state(&paths);
    let was_using_provider = state.active_provider_id.take().is_some();
    if was_using_provider {
        if proxy_running {
            crate::providers::write_official_local_proxy_config(&paths)?;
        } else {
            crate::providers::restore_official_config(&paths)?;
        }
    }
    state.active_account_id = Some(id.to_string());
    write_state(&paths, &state)?;
    touch_account_field(&paths, id, AccountSyncField::Active)?;
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
pub(crate) fn restart_chatgpt<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    // Keep a manual account switch and a restart as one operation.  In proxy mode the
    // switch deliberately leaves auth.json alone while Codex is running, so the
    // restarted process must receive the selected credential before it starts.
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    let launch_target = refresh_and_get_chatgpt_launch_target(&app);
    stop_chatgpt_processes()?;
    wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    sync_active_proxy_auth_for_restart(&app)?;
    if crate::dream_skin::restart_active_session()? {
        Ok(())
    } else {
        start_chatgpt(launch_target.as_ref())
    }
}

fn sync_active_proxy_auth_for_restart<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if !crate::local_proxy::is_running() {
        return Ok(());
    }

    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    // Third-party Provider mode does not use the selected official account.  Only
    // synchronize the official-account proxy mode, where a stale auth.json can make
    // a freshly restarted ChatGPT/Codex session fail during its bootstrap.
    if state.active_provider_id.is_some() {
        return Ok(());
    }
    let Some(account_id) = state.active_account_id else {
        return Ok(());
    };

    let auth = read_json(&managed_auth_path(&paths, &account_id))?;
    validate_auth(&auth)?;
    write_json_atomic(&paths.current_auth, &auth)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectConversationSyncResult {
    conversations_updated: usize,
    rollout_files_updated: usize,
}

#[tauri::command]
pub(crate) async fn sync_direct_conversations<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<DirectConversationSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || sync_direct_conversations_blocking(app))
        .await
        .map_err(|error| format!("同步直连对话任务失败：{error}"))?
}

fn sync_direct_conversations_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<DirectConversationSyncResult, String> {
    if !crate::local_proxy::is_running() {
        return Err("请先启动本地代理，再同步直连对话".to_string());
    }

    let paths = resolve_paths(&app)?;
    let launch_target = refresh_and_get_chatgpt_launch_target(&app);
    stop_chatgpt_processes()?;
    thread::sleep(Duration::from_millis(650));

    let sync_result = sync_conversation_metadata(&paths.codex_home);
    let start_result = start_chatgpt(launch_target.as_ref());

    match (sync_result, start_result) {
        (Ok(result), Ok(())) => Ok(result),
        (Err(sync_error), Ok(())) => Err(sync_error),
        (Ok(_), Err(start_error)) => Err(format!(
            "直连对话已同步，但重新启动 ChatGPT 失败：{start_error}"
        )),
        (Err(sync_error), Err(start_error)) => Err(format!(
            "同步直连对话失败：{sync_error}；重新启动 ChatGPT 也失败：{start_error}"
        )),
    }
}

fn sync_conversation_metadata(codex_home: &Path) -> Result<DirectConversationSyncResult, String> {
    let state_database = latest_codex_state_database(codex_home)?;
    let mut connection = open_conversation_database(&state_database)?;
    if !sqlite_table_has_column(&connection, "threads", "model_provider")? {
        return Err(format!(
            "{} 中没有可识别的 Codex 对话表",
            state_database.display()
        ));
    }

    let conversation_rollouts = openai_conversation_rollouts(&connection, &state_database)?;
    let mut rollout_files_updated = 0;
    let mut unique_rollout_paths = HashSet::new();
    for rollout_path in conversation_rollouts {
        if unique_rollout_paths.insert(rollout_path.clone())
            && update_rollout_provider(&rollout_path)?
        {
            rollout_files_updated += 1;
        }
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始更新 {}：{error}", state_database.display()))?;
    let conversations_updated = transaction
        .execute(
            "UPDATE threads SET model_provider = ?1 WHERE model_provider = ?2",
            params![
                LOCAL_PROXY_CONVERSATION_PROVIDER,
                OFFICIAL_CONVERSATION_PROVIDER
            ],
        )
        .map_err(|error| format!("更新 {} 失败：{error}", state_database.display()))?;
    transaction
        .commit()
        .map_err(|error| format!("提交 {} 失败：{error}", state_database.display()))?;

    update_desktop_thread_catalogs(codex_home)?;

    Ok(DirectConversationSyncResult {
        conversations_updated,
        rollout_files_updated,
    })
}

fn latest_codex_state_database(codex_home: &Path) -> Result<PathBuf, String> {
    let entries = fs::read_dir(codex_home)
        .map_err(|error| format!("无法读取 Codex Home {}：{error}", codex_home.display()))?;
    let mut candidates = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Codex Home 目录项失败：{error}"))?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(version) = file_name
            .strip_prefix("state_")
            .and_then(|value| value.strip_suffix(".sqlite"))
            .and_then(|value| value.parse::<u64>().ok())
        else {
            continue;
        };
        candidates.push((version, entry.path()));
    }
    candidates
        .into_iter()
        .max_by_key(|(version, _)| *version)
        .map(|(_, path)| path)
        .ok_or_else(|| format!("未在 {} 中找到 Codex 对话数据库", codex_home.display()))
}

fn open_conversation_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("无法打开 Codex 对话数据库 {}：{error}", path.display()))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("无法配置 Codex 对话数据库 {}：{error}", path.display()))?;
    Ok(connection)
}

fn sqlite_table_has_column(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("无法读取 SQLite 表 {table}：{error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("无法读取 SQLite 表 {table} 的字段：{error}"))?;
    for item in columns {
        if item.map_err(|error| format!("无法解析 SQLite 表 {table} 的字段：{error}"))? == column
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn openai_conversation_rollouts(
    connection: &Connection,
    database_path: &Path,
) -> Result<Vec<PathBuf>, String> {
    let mut statement = connection
        .prepare("SELECT rollout_path FROM threads WHERE model_provider = ?1")
        .map_err(|error| format!("无法查询 {}：{error}", database_path.display()))?;
    let rows = statement
        .query_map(params![OFFICIAL_CONVERSATION_PROVIDER], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| format!("无法读取 {} 中的对话：{error}", database_path.display()))?;
    rows.map(|row| {
        row.map(PathBuf::from)
            .map_err(|error| format!("无法解析 Codex 对话文件路径：{error}"))
    })
    .collect()
}

fn update_rollout_provider(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Err(format!("Codex 对话文件不存在：{}", path.display()));
    }

    let source = fs::File::open(path)
        .map_err(|error| format!("无法打开 Codex 对话文件 {}：{error}", path.display()))?;
    let mut reader = BufReader::new(source);
    let mut first_line = String::new();
    reader
        .read_line(&mut first_line)
        .map_err(|error| format!("无法读取 Codex 对话文件 {}：{error}", path.display()))?;
    if first_line.trim().is_empty() {
        return Err(format!("Codex 对话文件为空：{}", path.display()));
    }

    let mut metadata: Value = serde_json::from_str(first_line.trim_end())
        .map_err(|error| format!("Codex 对话元数据无效 {}：{error}", path.display()))?;
    let Some(provider) = metadata.pointer_mut("/payload/model_provider") else {
        return Err(format!(
            "Codex 对话文件缺少 model_provider：{}",
            path.display()
        ));
    };
    if provider.as_str() != Some(OFFICIAL_CONVERSATION_PROVIDER) {
        return Ok(false);
    }
    *provider = Value::String(LOCAL_PROXY_CONVERSATION_PROVIDER.to_string());

    let temp_path = path.with_extension(format!("codex-switch-sync-{}.tmp", std::process::id()));
    let write_result = (|| -> Result<(), String> {
        let temp = fs::File::create(&temp_path).map_err(|error| {
            format!(
                "无法创建 Codex 对话临时文件 {}：{error}",
                temp_path.display()
            )
        })?;
        let mut writer = BufWriter::new(temp);
        serde_json::to_writer(&mut writer, &metadata)
            .map_err(|error| format!("无法写入 Codex 对话元数据：{error}"))?;
        writer
            .write_all(b"\n")
            .and_then(|_| std::io::copy(&mut reader, &mut writer).map(|_| ()))
            .and_then(|_| writer.flush())
            .map_err(|error| format!("无法写入 Codex 对话文件 {}：{error}", path.display()))?;
        writer
            .get_ref()
            .sync_all()
            .map_err(|error| format!("无法刷新 Codex 对话文件 {}：{error}", path.display()))
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    drop(reader);
    crate::storage::replace_file(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("无法提交 Codex 对话文件 {}：{error}", path.display())
    })?;
    Ok(true)
}

fn update_desktop_thread_catalogs(codex_home: &Path) -> Result<(), String> {
    let catalog_dir = codex_home.join("sqlite");
    if !catalog_dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(&catalog_dir)
        .map_err(|error| format!("无法读取 Codex 对话目录 {}：{error}", catalog_dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Codex 对话目录项失败：{error}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("db") {
            continue;
        }
        let connection = open_conversation_database(&path)?;
        if !sqlite_table_has_column(&connection, "local_thread_catalog", "model_provider")? {
            continue;
        }
        connection
            .execute(
                "UPDATE local_thread_catalog SET model_provider = ?1 WHERE model_provider = ?2",
                params![
                    LOCAL_PROXY_CONVERSATION_PROVIDER,
                    OFFICIAL_CONVERSATION_PROVIDER
                ],
            )
            .map_err(|error| format!("更新 Codex 对话目录 {} 失败：{error}", path.display()))?;
    }
    Ok(())
}

fn api_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
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

fn load_auth_for_request<R: Runtime>(
    _app: &tauri::AppHandle<R>,
    paths: &Paths,
    id: &str,
) -> Result<Value, String> {
    let managed_path = managed_auth_path(paths, id);
    // The current .codex/auth.json is a startup-only import source. Subsequent
    // account operations use the managed copy so external file changes cannot
    // silently alter the active account.
    let auth = read_json(&managed_path)?;
    validate_auth(&auth)?;
    Ok(auth)
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
    touch_account_field(&paths, &id, AccountSyncField::Note)?;
    touch_account_field(&paths, &id, AccountSyncField::ExpiresAt)?;
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
                    let _ = touch_account_field(&paths, &id, AccountSyncField::Usage);
                }
                // A usage refresh can fail for temporary reasons (for example, a network
                // disconnect or timeout). Do not turn a transient failure into a persisted
                // account exclusion. Only disable accounts after an explicit authentication
                // rejection from the upstream API.
                let state = read_state(&paths);
                let disable_error = if should_disable_account_auto_switch(
                    &error,
                    state.auto_switch_on_quota_exhaustion
                        && state.auto_disable_unreachable_accounts,
                ) {
                    set_account_auto_switch_enabled_for_paths(&paths, &id, false).err()
                } else {
                    None
                };
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

fn should_disable_account_auto_switch(
    error: &str,
    auto_disable_unreachable_accounts: bool,
) -> bool {
    // `try_refresh_usage_blocking` includes the upstream HTTP status in these errors.
    // Treat only definite account access failures as permanent enough to
    // remove the account from automatic switching. Network errors, timeouts, 5xx, parsing
    // errors, and refresh-token endpoint failures remain retryable unless the user has opted
    // in to automatically disabling unreachable accounts.
    error.contains("HTTP 401")
        || error.contains("HTTP 403")
        || error.contains("HTTP 402")
        || (auto_disable_unreachable_accounts && is_unreachable_usage_error(error))
}

fn is_unreachable_usage_error(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error.contains("error sending request")
        || error.contains("timed out")
        || error.contains("timeout")
        || error.contains("dns error")
        || error.contains("connection")
        || error.contains("network")
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
    touch_account_field(&paths, id, AccountSyncField::Usage)?;
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
fn refresh_local_codex_path<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(path) = discover_running_chatgpt_or_codex_path() else {
        return;
    };
    let Ok(paths) = resolve_paths(app) else {
        return;
    };
    let mut state = read_state(&paths);
    if state.local_codex_path.as_deref() != Some(path.as_str()) {
        state.local_codex_path = Some(path);
        let _ = write_state(&paths, &state);
    }
}

#[cfg(not(target_os = "windows"))]
fn refresh_local_codex_path<R: Runtime>(_app: &tauri::AppHandle<R>) {}

#[cfg(target_os = "windows")]
fn discover_running_chatgpt_or_codex_path() -> Option<String> {
    windows_powershell_line(
        "Get-Process -Name ChatGPT,codex -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1 -ExpandProperty Path",
    )
    .and_then(|path| normalize_windows_chatgpt_target(&path))
}

pub(crate) fn refresh_and_get_chatgpt_launch_target<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<ChatGptLaunchTarget> {
    refresh_local_codex_path(app);

    #[cfg(target_os = "windows")]
    {
        let saved_target = resolve_paths(app)
            .ok()
            .and_then(|paths| read_state(&paths).local_codex_path)
            .filter(|path| Path::new(path).is_file())
            .map(ChatGptLaunchTarget::Executable);
        saved_target.or_else(official_default_chatgpt_target)
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn official_default_chatgpt_target() -> Option<ChatGptLaunchTarget> {
    windows_powershell_line(
        "(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty InstallLocation)",
    )
    .and_then(|path| {
        let target = Path::new(&path).join("app").join("ChatGPT.exe");
        target
            .is_file()
            .then(|| target.as_os_str().to_string_lossy().into_owned())
    })
    .map(ChatGptLaunchTarget::Executable)
    .or_else(|| {
        windows_powershell_line(
            "$app = Get-StartApps | Where-Object { $_.Name -eq 'ChatGPT' -and $_.AppID -like 'OpenAI.Codex_*' } | Select-Object -First 1; if ($app) { $app.AppID }",
        )
        .map(ChatGptLaunchTarget::ShellApp)
    })
}

#[cfg(target_os = "windows")]
fn chatgpt_or_codex_is_running() -> Result<bool, String> {
    let output = windows_hidden_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "if (@(Get-Process -Name ChatGPT,codex -ErrorAction SilentlyContinue).Count -gt 0) { exit 0 } else { exit 1 }",
        ])
        .status()
        .map_err(|error| format!("检查 ChatGPT/Codex 进程失败：{error}"))?;
    Ok(output.success())
}

#[cfg(unix)]
fn chatgpt_or_codex_is_running() -> Result<bool, String> {
    for name in [CHATGPT_COMMAND, LEGACY_CODEX_COMMAND] {
        match Command::new("pgrep").args(["-x", name]).status() {
            Ok(status) if status.success() => return Ok(true),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(format!("检查 ChatGPT/Codex 进程失败：{error}")),
        }
    }
    Ok(false)
}

#[cfg(target_os = "windows")]
pub(crate) fn stop_chatgpt_processes() -> Result<(), String> {
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

#[cfg(target_os = "windows")]
pub(crate) fn wait_for_chatgpt_processes_to_exit(timeout: Duration) -> Result<(), String> {
    // ChatGPT is a multi-process application.  Its main process can exit before a
    // renderer or the bundled `codex.exe` has gone away, and a remaining process
    // may briefly respawn another one.  Keep checking and terminating during the
    // whole grace period instead of terminating once and only passively waiting.
    let timeout_ms = timeout.as_millis();
    let script = format!(
        r#"
$deadline = [DateTime]::UtcNow.AddMilliseconds({timeout_ms})
while ($true) {{
    $running = @(Get-Process -Name ChatGPT,codex -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) {{ exit 0 }}

    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    if ([DateTime]::UtcNow -ge $deadline) {{
        $details = $running | ForEach-Object {{ "$($_.ProcessName) (PID $($_.Id))" }}
        [Console]::Error.WriteLine("仍在运行：" + ($details -join ", "))
        exit 1
    }}
    Start-Sleep -Milliseconds 150
}}
"#,
    );
    let output = windows_hidden_command("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|error| format!("确认 ChatGPT 已退出失败：{error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let details = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let suffix = if details.is_empty() {
            String::new()
        } else {
            format!("（{details}）")
        };
        Err(format!(
            "ChatGPT/Codex 进程未在 {} 秒内完全退出，已取消启动以避免旧凭据与新凭据竞争{suffix}",
            timeout.as_secs()
        ))
    }
}

#[cfg(unix)]
pub(crate) fn stop_chatgpt_processes() -> Result<(), String> {
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
pub(crate) fn wait_for_chatgpt_processes_to_exit(_timeout: Duration) -> Result<(), String> {
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
pub(crate) fn start_chatgpt(target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    match target {
        Some(ChatGptLaunchTarget::ShellApp(app_id)) => {
            let app_uri = format!("shell:AppsFolder\\{app_id}");
            windows_hidden_command("explorer.exe")
                .arg(app_uri)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("启动 ChatGPT 失败：{error}"))
        }
        Some(ChatGptLaunchTarget::Executable(target)) => start_windows_executable(target)
            .or_else(|recorded_error| start_official_windows_chatgpt(recorded_error)),
        None => Err("未找到本地 ChatGPT/Codex 路径，且官方默认安装路径不可用".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn start_official_windows_chatgpt(recorded_error: String) -> Result<(), String> {
    let official_target = official_default_chatgpt_target().ok_or(recorded_error.clone())?;
    let result = match official_target {
        ChatGptLaunchTarget::ShellApp(app_id) => {
            let app_uri = format!("shell:AppsFolder\\{app_id}");
            windows_hidden_command("explorer.exe")
                .arg(app_uri)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("Failed to start official ChatGPT: {error}"))
        }
        ChatGptLaunchTarget::Executable(path) => start_windows_executable(&path),
    };
    result.map_err(|official_error| {
        format!(
            "Failed to start the recorded ChatGPT/Codex path: {recorded_error}; the official installation also failed: {official_error}"
        )
    })
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
pub(crate) fn start_chatgpt(_target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
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
pub(crate) fn start_chatgpt(_target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
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
        should_disable_account_auto_switch, sync_conversation_metadata,
        update_disabled_account_ids, LOCAL_PROXY_CONVERSATION_PROVIDER,
    };
    use crate::models::ManagerStateFile;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use rusqlite::Connection;
    use serde_json::{json, Value};
    use std::{fs, path::PathBuf, time::SystemTime};

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

    #[test]
    fn usage_refresh_failures_only_disable_for_explicit_auth_rejections() {
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 401 Unauthorized",
            false,
        ));
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 403 Forbidden",
            false,
        ));
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 402 Payment Required",
            false,
        ));

        assert!(!should_disable_account_auto_switch(
            "failed to read Codex usage: error sending request",
            false,
        ));
        assert!(!should_disable_account_auto_switch(
            "failed to read Codex usage: operation timed out",
            false,
        ));
        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 503 Service Unavailable",
            false,
        ));
        assert!(should_disable_account_auto_switch(
            "failed to read Codex usage: error sending request",
            true,
        ));
    }

    #[test]
    fn syncs_openai_conversations_into_the_local_proxy_history() {
        let codex_home = temporary_sync_test_dir();
        let rollout_path = codex_home.join("rollout.jsonl");
        fs::write(
            &rollout_path,
            format!(
                "{}\n{}\n",
                json!({
                    "type": "session_meta",
                    "payload": { "model_provider": "openai" }
                }),
                json!({ "type": "event_msg", "payload": { "type": "task_started" } })
            ),
        )
        .expect("write rollout");

        let state_path = codex_home.join("state_5.sqlite");
        let state = Connection::open(&state_path).expect("open state database");
        state
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    model_provider TEXT NOT NULL
                );",
            )
            .expect("create threads table");
        state
            .execute(
                "INSERT INTO threads (id, rollout_path, model_provider) VALUES (?1, ?2, 'openai')",
                ("thread-1", rollout_path.to_string_lossy().as_ref()),
            )
            .expect("insert thread");
        drop(state);

        let catalog_dir = codex_home.join("sqlite");
        fs::create_dir_all(&catalog_dir).expect("create catalog directory");
        let catalog_path = catalog_dir.join("codex-dev.db");
        let catalog = Connection::open(&catalog_path).expect("open catalog database");
        catalog
            .execute_batch(
                "CREATE TABLE local_thread_catalog (
                    thread_id TEXT PRIMARY KEY,
                    model_provider TEXT NOT NULL
                );
                INSERT INTO local_thread_catalog (thread_id, model_provider)
                VALUES ('thread-1', 'openai');",
            )
            .expect("create catalog");
        drop(catalog);

        let result = sync_conversation_metadata(&codex_home).expect("sync conversations");
        assert_eq!(result.conversations_updated, 1);
        assert_eq!(result.rollout_files_updated, 1);

        let state = Connection::open(&state_path).expect("reopen state database");
        let state_provider: String = state
            .query_row(
                "SELECT model_provider FROM threads WHERE id = 'thread-1'",
                [],
                |row| row.get(0),
            )
            .expect("read state provider");
        assert_eq!(state_provider, LOCAL_PROXY_CONVERSATION_PROVIDER);

        let catalog = Connection::open(&catalog_path).expect("reopen catalog database");
        let catalog_provider: String = catalog
            .query_row(
                "SELECT model_provider FROM local_thread_catalog WHERE thread_id = 'thread-1'",
                [],
                |row| row.get(0),
            )
            .expect("read catalog provider");
        assert_eq!(catalog_provider, LOCAL_PROXY_CONVERSATION_PROVIDER);

        let metadata: Value = serde_json::from_str(
            fs::read_to_string(&rollout_path)
                .expect("read rollout")
                .lines()
                .next()
                .expect("rollout metadata"),
        )
        .expect("parse rollout metadata");
        assert_eq!(
            metadata
                .pointer("/payload/model_provider")
                .and_then(Value::as_str),
            Some(LOCAL_PROXY_CONVERSATION_PROVIDER)
        );

        drop(catalog);
        drop(state);
        fs::remove_dir_all(&codex_home).expect("remove test directory");
    }

    fn temporary_sync_test_dir() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "codex-switch-conversation-sync-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }
}
