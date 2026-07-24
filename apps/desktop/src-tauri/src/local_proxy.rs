use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{self, BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, OnceLock, TryLockError},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use chrono::{Local, TimeZone};
use reqwest::blocking::{Client, Response as ReqwestResponse};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::{
    agent_identity,
    auth::{account_fields, is_agent_identity_auth, token_string, validate_auth},
    codex_api::{refresh_tokens, token_expiring, ORIGINATOR},
    models::{
        AccountSummary, DailyTokenUsage, LocalProxyStatus, ManagerStateFile, ProviderApiFormat,
        ProviderProfile, ProxyOnboardingStatus, TokenUsageEntry, UsageSummary,
    },
    providers::{
        self, LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER, LOCAL_PROXY_BASE_URL, LOCAL_PROXY_HOST,
        LOCAL_PROXY_PORT,
    },
    storage::{
        managed_auth_path, read_app_settings, read_json, read_state, resolve_paths,
        write_app_settings, write_managed_auth_if_changed, write_state, Paths,
    },
};

const OFFICIAL_CODEX_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(600);
const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const TOOL_SEARCH_PROXY_NAME: &str = "tool_search";
const CUSTOM_TOOL_INPUT_FIELD: &str = "input";
const CHAT_TOOL_NAME_MAX_LEN: usize = 64;
const DIAGNOSTIC_LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;
const DIAGNOSTIC_LOG_FILE_NAME: &str = "local-proxy-diagnostics.jsonl";
const DIAGNOSTIC_RESPONSE_BODY_MAX_CHARS: usize = 4_000;
const TOKEN_USAGE_JSONL_FILE_NAME: &str = "token-usage.jsonl";
const TOKEN_USAGE_DB_FILE_NAME: &str = "token-usage.sqlite3";
const TOKEN_USAGE_DB_KEEP_ROWS: i64 = 10_000;
const TOKEN_USAGE_LIST_LIMIT: usize = 500;
const TOKEN_USAGE_CAPTURE_MAX_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const TOKEN_USAGE_WINDOW_LABEL: &str = "token-usage";
const CUSTOM_TOOL_INPUT_DESCRIPTION: &str =
    "Raw string input for the original custom tool. Preserve formatting exactly.";
const CUSTOM_TOOL_PRESERVED_METADATA_HEADING: &str = "Original tool definition:";
const LOCAL_PROXY_LAN_HOST: &str = "0.0.0.0";

struct ProxyRuntime {
    server: Arc<Server>,
    handle: Option<JoinHandle<()>>,
}

struct UpstreamPayload {
    status: u16,
    content_type: Option<String>,
    response_headers: Vec<(String, String)>,
    body: UpstreamBody,
    token_usage_account: Option<TokenUsageAccount>,
}

enum UpstreamBody {
    Buffered(Vec<u8>),
    Streaming(Box<dyn Read + Send>),
}

enum ActiveTarget {
    Official { model: String },
    Provider(ProviderProfile),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct TokenUsageValues {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
    cached_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

#[derive(Clone)]
struct TokenUsageAccount {
    account_id: String,
    account_email: String,
    active_account_generation: u64,
    auto_switch_attempt_generation: u64,
    auto_switch_eligible: bool,
}

#[derive(Clone)]
struct TokenUsageContext {
    ts: u64,
    provider: String,
    model: String,
    request_hash: String,
    started_at: Instant,
    content_type: Option<String>,
    expects_event_stream: bool,
    account: Option<TokenUsageAccount>,
}

#[derive(Clone, Copy)]
enum ProxyDiagnosticRoute {
    LocalHealth,
    LocalModels,
    TargetResolutionError,
    Official,
    ProviderChatBridge,
    ProviderResponsesPassthrough,
    ProviderPassthrough,
}

impl ProxyDiagnosticRoute {
    fn as_str(self) -> &'static str {
        match self {
            ProxyDiagnosticRoute::LocalHealth => "local_health",
            ProxyDiagnosticRoute::LocalModels => "local_models",
            ProxyDiagnosticRoute::TargetResolutionError => "target_resolution_error",
            ProxyDiagnosticRoute::Official => "official",
            ProxyDiagnosticRoute::ProviderChatBridge => "provider_chat_bridge",
            ProxyDiagnosticRoute::ProviderResponsesPassthrough => "provider_responses_passthrough",
            ProxyDiagnosticRoute::ProviderPassthrough => "provider_passthrough",
        }
    }

    fn is_local(self) -> bool {
        matches!(
            self,
            ProxyDiagnosticRoute::LocalHealth | ProxyDiagnosticRoute::LocalModels
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CodexToolKind {
    Function,
    Namespace,
    Custom,
    ToolSearch,
}

#[derive(Debug, Clone)]
struct CodexToolSpec {
    kind: CodexToolKind,
    name: String,
    namespace: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct CodexToolContext {
    chat_tools: Vec<Value>,
    seen_chat_names: HashSet<String>,
    chat_name_to_spec: HashMap<String, CodexToolSpec>,
    namespace_name_to_chat_name: HashMap<(String, String), String>,
}

impl CodexToolContext {
    fn chat_tools(&self) -> &[Value] {
        &self.chat_tools
    }

    fn lookup_chat_name(&self, chat_name: &str) -> Option<&CodexToolSpec> {
        self.chat_name_to_spec.get(chat_name)
    }

    fn is_custom_tool_chat_name(&self, chat_name: &str) -> bool {
        self.lookup_chat_name(chat_name)
            .is_some_and(|spec| spec.kind == CodexToolKind::Custom)
    }

    fn chat_name_for_response_function(&self, name: &str, namespace: Option<&str>) -> String {
        if let Some(namespace) = namespace.filter(|value| !value.is_empty()) {
            if let Some(chat_name) = self
                .namespace_name_to_chat_name
                .get(&(namespace.to_string(), name.to_string()))
            {
                return chat_name.clone();
            }
            return flatten_namespace_tool_name(namespace, name);
        }

        name.to_string()
    }

    fn add_chat_tool(&mut self, chat_name: String, spec: CodexToolSpec, chat_tool: Value) {
        if chat_name.trim().is_empty() || self.seen_chat_names.contains(&chat_name) {
            return;
        }
        self.seen_chat_names.insert(chat_name.clone());
        if let Some(namespace) = spec.namespace.as_ref() {
            self.namespace_name_to_chat_name
                .insert((namespace.clone(), spec.name.clone()), chat_name.clone());
        }
        self.chat_name_to_spec.insert(chat_name, spec);
        self.chat_tools.push(chat_tool);
    }

    fn add_function_tool(&mut self, tool: &Value, namespace: Option<&str>) {
        let Some(original_name) = responses_tool_name(tool) else {
            return;
        };
        let chat_name = namespace
            .map(|namespace| flatten_namespace_tool_name(namespace, &original_name))
            .unwrap_or_else(|| original_name.clone());
        let Some(chat_tool) = responses_function_tool_to_chat_tool(tool, &chat_name) else {
            return;
        };
        let spec = CodexToolSpec {
            kind: if namespace.is_some() {
                CodexToolKind::Namespace
            } else {
                CodexToolKind::Function
            },
            name: original_name,
            namespace: namespace.map(ToString::to_string),
        };
        self.add_chat_tool(chat_name, spec, chat_tool);
    }

    fn add_custom_tool(&mut self, tool: &Value) {
        let Some(name) = responses_tool_name(tool) else {
            return;
        };
        let chat_tool = json!({
            "type": "function",
            "function": {
                "name": name,
                "description": responses_custom_tool_description(tool),
                "parameters": {
                    "type": "object",
                    "properties": {
                        CUSTOM_TOOL_INPUT_FIELD: {
                            "type": "string",
                            "description": CUSTOM_TOOL_INPUT_DESCRIPTION
                        }
                    },
                    "required": [CUSTOM_TOOL_INPUT_FIELD]
                }
            }
        });
        let spec = CodexToolSpec {
            kind: CodexToolKind::Custom,
            name: name.clone(),
            namespace: None,
        };
        self.add_chat_tool(name, spec, chat_tool);
    }

    fn add_tool_search_tool(&mut self) {
        let chat_tool = json!({
            "type": "function",
            "function": {
                "name": TOOL_SEARCH_PROXY_NAME,
                "description": "Search and load Codex tools, plugins, connectors, and MCP namespaces for the current task.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query for tools or connectors to load."
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of tool groups to return."
                        }
                    },
                    "required": ["query"]
                }
            }
        });
        let spec = CodexToolSpec {
            kind: CodexToolKind::ToolSearch,
            name: TOOL_SEARCH_PROXY_NAME.to_string(),
            namespace: None,
        };
        self.add_chat_tool(TOOL_SEARCH_PROXY_NAME.to_string(), spec, chat_tool);
    }

    fn add_namespace_tool(&mut self, namespace_tool: &Value) {
        let Some(namespace) = namespace_tool.get("name").and_then(Value::as_str) else {
            return;
        };
        let Some(children) = namespace_tool
            .get("tools")
            .or_else(|| namespace_tool.get("children"))
            .and_then(Value::as_array)
        else {
            return;
        };

        for child in children {
            if child.get("type").and_then(Value::as_str) == Some("function") {
                self.add_function_tool(child, Some(namespace));
            }
        }
    }

    fn add_response_tool(&mut self, tool: &Value) {
        match tool {
            Value::String(name) => self.add_custom_tool(&json!({
                "type": "custom",
                "name": name
            })),
            Value::Object(_) => match tool.get("type").and_then(Value::as_str) {
                Some("function") => self.add_function_tool(tool, None),
                Some("custom") => self.add_custom_tool(tool),
                Some("tool_search") => self.add_tool_search_tool(),
                Some("namespace") => self.add_namespace_tool(tool),
                _ => {}
            },
            _ => {}
        }
    }
}

static RUNTIME: OnceLock<Mutex<Option<ProxyRuntime>>> = OnceLock::new();
static TOKEN_USAGE_DB_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static AUTO_SWITCH_COORDINATOR: OnceLock<AutoSwitchCoordinator> = OnceLock::new();

#[derive(Default)]
struct AutoSwitchCoordinator {
    state: Mutex<AutoSwitchState>,
}

#[derive(Default)]
struct AutoSwitchState {
    // The account generation advances only after a real automatic switch. The attempt
    // generation also advances after no-op/error outcomes so requests that were already
    // in flight do not repeat the same expensive refresh after waiting for the lock.
    active_account_generation: u64,
    switch_attempt_generation: u64,
    last_attempt: Option<CompletedAutoSwitchAttempt>,
}

struct CompletedAutoSwitchAttempt {
    observed_generation: u64,
    failed_account_id: String,
    should_retry: bool,
}

enum AutoSwitchAttempt {
    Unchanged,
    AlreadyChanged,
    Switched,
}

impl AutoSwitchCoordinator {
    fn recover_state<'a>(
        &'a self,
        mut state: MutexGuard<'a, AutoSwitchState>,
    ) -> MutexGuard<'a, AutoSwitchState> {
        // A panic can happen after the account state was written but before the
        // coordinator published it. Advance both generations conservatively so old
        // responses only retry, then keep ordinary official proxying available.
        state.active_account_generation = state.active_account_generation.wrapping_add(1);
        state.switch_attempt_generation = state.switch_attempt_generation.wrapping_add(1);
        state.last_attempt = None;
        self.state.clear_poison();
        state
    }

    fn lock_state(&self) -> MutexGuard<'_, AutoSwitchState> {
        match self.state.lock() {
            Ok(state) => state,
            Err(error) => self.recover_state(error.into_inner()),
        }
    }

    #[cfg(test)]
    fn active_account_generation(&self) -> u64 {
        self.lock_state().active_account_generation
    }

    fn account_snapshot<T, F>(&self, snapshot: F) -> Result<(u64, u64, T), String>
    where
        F: FnOnce() -> Result<T, String>,
    {
        let state = self.lock_state();
        let value = snapshot()?;
        Ok((
            state.active_account_generation,
            state.switch_attempt_generation,
            value,
        ))
    }

    fn switch_or_wait<F>(
        &self,
        observed_generation: u64,
        observed_attempt_generation: u64,
        failed_account_id: &str,
        switch: F,
    ) -> Result<bool, String>
    where
        F: FnOnce() -> Result<AutoSwitchAttempt, String>,
    {
        self.switch_or_wait_with_waiter_hook(
            observed_generation,
            observed_attempt_generation,
            failed_account_id,
            switch,
            || {},
        )
    }

    fn switch_or_wait_with_waiter_hook<F, W>(
        &self,
        observed_generation: u64,
        observed_attempt_generation: u64,
        failed_account_id: &str,
        switch: F,
        waiter_hook: W,
    ) -> Result<bool, String>
    where
        F: FnOnce() -> Result<AutoSwitchAttempt, String>,
        W: FnOnce(),
    {
        let mut state = match self.state.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => {
                waiter_hook();
                self.lock_state()
            }
            Err(TryLockError::Poisoned(error)) => self.recover_state(error.into_inner()),
        };

        if state.active_account_generation != observed_generation {
            return Ok(true);
        }

        if state.switch_attempt_generation != observed_attempt_generation {
            if let Some(last_attempt) = state.last_attempt.as_ref() {
                if last_attempt.observed_generation == observed_generation
                    && last_attempt.failed_account_id == failed_account_id
                {
                    return Ok(last_attempt.should_retry);
                }
            }
        }

        let attempt = match switch() {
            Ok(attempt) => attempt,
            Err(error) => {
                state.switch_attempt_generation = state.switch_attempt_generation.wrapping_add(1);
                state.last_attempt = Some(CompletedAutoSwitchAttempt {
                    observed_generation,
                    failed_account_id: failed_account_id.to_string(),
                    should_retry: false,
                });
                return Err(error);
            }
        };
        state.switch_attempt_generation = state.switch_attempt_generation.wrapping_add(1);
        let should_retry = match attempt {
            AutoSwitchAttempt::Unchanged => false,
            AutoSwitchAttempt::AlreadyChanged => true,
            AutoSwitchAttempt::Switched => {
                state.active_account_generation = state.active_account_generation.wrapping_add(1);
                true
            }
        };
        state.last_attempt = Some(CompletedAutoSwitchAttempt {
            observed_generation,
            failed_account_id: failed_account_id.to_string(),
            should_retry,
        });
        Ok(should_retry)
    }
}

fn runtime() -> &'static Mutex<Option<ProxyRuntime>> {
    RUNTIME.get_or_init(|| Mutex::new(None))
}

fn token_usage_db_lock() -> &'static Mutex<()> {
    TOKEN_USAGE_DB_LOCK.get_or_init(|| Mutex::new(()))
}

fn auto_switch_coordinator() -> &'static AutoSwitchCoordinator {
    AUTO_SWITCH_COORDINATOR.get_or_init(AutoSwitchCoordinator::default)
}

pub(crate) fn is_running() -> bool {
    runtime()
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

fn status<R: Runtime>(app: &tauri::AppHandle<R>) -> LocalProxyStatus {
    let (
        auto_switch_on_quota_exhaustion,
        custom_auto_switch_priority_enabled,
        auto_disable_unreachable_accounts,
        listen_on_all_interfaces,
        image_generation_account_id,
        openai_auth_account_id,
    ) = resolve_paths(app)
        .map(|paths| {
            let state = read_state(&paths);
            (
                state.auto_switch_on_quota_exhaustion,
                state.custom_auto_switch_priority_enabled,
                state.auto_disable_unreachable_accounts,
                state.local_proxy_listen_on_all_interfaces,
                state.image_generation_account_id,
                state.local_proxy_openai_auth_account_id,
            )
        })
        .unwrap_or((false, false, false, false, None, None));
    LocalProxyStatus {
        running: is_running(),
        address: proxy_bind_host(listen_on_all_interfaces).to_string(),
        port: LOCAL_PROXY_PORT,
        base_url: LOCAL_PROXY_BASE_URL.to_string(),
        auto_switch_on_quota_exhaustion,
        custom_auto_switch_priority_enabled,
        auto_disable_unreachable_accounts,
        listen_on_all_interfaces,
        image_generation_account_id,
        openai_auth_account_id,
    }
}

#[tauri::command]
pub(crate) fn get_local_proxy_status<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    Ok(status(&app))
}

#[tauri::command]
pub(crate) fn export_diagnostic_logs<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<String, String> {
    let destination = PathBuf::from(path);
    let parent = destination
        .parent()
        .ok_or_else(|| "Diagnostic log export path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;

    let source = diagnostic_log_path(&app)?;
    if source.exists() {
        fs::copy(&source, &destination).map_err(|error| {
            format!(
                "Failed to export diagnostics from {} to {}: {error}",
                source.display(),
                destination.display()
            )
        })?;
    } else {
        let empty_log = json!({
            "ts": unix_now(),
            "event": "no_diagnostic_logs",
            "message": "No local proxy diagnostic logs have been recorded yet."
        })
        .to_string();
        fs::write(&destination, format!("{empty_log}\n")).map_err(|error| {
            format!(
                "Failed to write diagnostic export {}: {error}",
                destination.display()
            )
        })?;
    }

    Ok(destination.display().to_string())
}

#[tauri::command]
pub(crate) fn list_token_usage_entries<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<TokenUsageEntry>, String> {
    let connection = open_token_usage_db(&app)?;
    list_token_usage_entries_from_db(&connection, TOKEN_USAGE_LIST_LIMIT)
}

#[tauri::command]
pub(crate) fn list_daily_token_usage<R: Runtime>(
    app: tauri::AppHandle<R>,
    start_ts: u64,
) -> Result<Vec<DailyTokenUsage>, String> {
    let connection = open_token_usage_db(&app)?;
    list_daily_token_usage_from_db(&connection, start_ts)
}

#[tauri::command]
pub(crate) async fn show_token_usage_window<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TOKEN_USAGE_WINDOW_LABEL) {
        let _ = window.destroy();
    }

    WebviewWindowBuilder::new(&app, TOKEN_USAGE_WINDOW_LABEL, token_usage_window_url())
        .title("Token Usage")
        .inner_size(1180.0, 780.0)
        .min_inner_size(900.0, 620.0)
        .resizable(true)
        .maximizable(true)
        .closable(true)
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn token_usage_window_url() -> WebviewUrl {
    WebviewUrl::App("index.html#token-usage".into())
}

pub(crate) fn restore_local_proxy_if_enabled<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<bool, String> {
    let paths = resolve_paths(app)?;
    if !read_state(&paths).local_proxy_enabled {
        return Ok(false);
    }

    let started = match start_server(app.clone()) {
        Ok(started) => started,
        Err(error) => {
            let _ = set_local_proxy_enabled(&paths, false);
            return Err(error);
        }
    };
    if let Err(error) = providers::apply_local_proxy_config_for_state(app) {
        if started {
            stop_server();
        }
        let _ = set_local_proxy_enabled(&paths, false);
        return Err(error);
    }
    Ok(true)
}

#[tauri::command]
pub(crate) async fn start_local_proxy<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || start_local_proxy_blocking(app))
        .await
        .map_err(|error| format!("Local proxy start task failed: {error}"))?
}

fn start_local_proxy_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    let paths = resolve_paths(&app)?;
    // Validate the selected official credential before interrupting a running client.
    // The local proxy supports both OAuth and Agent Identity authentication.
    providers::ensure_local_proxy_compatible_for_state(&paths)?;
    // Only interrupt and relaunch a client that is actually running. When no
    // client is open, proxy mode can be enabled by updating its configuration
    // directly, without treating the absence of a process as a stop failure.
    let client_was_running = crate::commands::chatgpt_or_codex_is_running()?;
    let launch_target = client_was_running
        .then(|| crate::commands::refresh_and_get_chatgpt_launch_target(&app))
        .flatten();
    if client_was_running {
        // Preserve the path of a running client before ending all ChatGPT/Codex
        // processes. This keeps custom installations usable after proxy mode starts.
        crate::commands::stop_chatgpt_processes()?;
        crate::commands::wait_for_chatgpt_processes_to_exit(std::time::Duration::from_secs(10))?;
    }

    let started = start_server(app.clone())?;
    if let Err(error) = providers::apply_local_proxy_config_for_state(&app) {
        if started {
            stop_server();
        }
        return Err(error);
    }
    set_local_proxy_enabled(&paths, true)?;
    let mut settings = read_app_settings(&app)?;
    settings.proxy_onboarding_status = ProxyOnboardingStatus::Enabled;
    write_app_settings(&app, &settings)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    let proxy_status = status(&app);
    if !client_was_running {
        return Ok(proxy_status);
    }
    // Update direct-history metadata while the desktop client is completely
    // stopped, then only launch it once the old conversations are ready for
    // local-proxy mode.
    let sync_result = crate::commands::sync_conversation_metadata_if_present(&paths.codex_home);
    let start_result = crate::commands::start_chatgpt(launch_target.as_ref());
    match (sync_result, start_result) {
        (Ok(_), Ok(())) => Ok(proxy_status),
        (Err(sync_error), Ok(())) => Err(format!(
            "代理模式已启动，ChatGPT/Codex 已重启，但此前对话记录同步失败：{sync_error}"
        )),
        (Ok(_), Err(start_error)) => Err(format!(
            "代理模式已启动，但无法自动启动 ChatGPT/Codex（{start_error}）。请手动启动 ChatGPT 或 Codex。"
        )),
        (Err(sync_error), Err(start_error)) => Err(format!(
            "代理模式已启动，但此前对话记录同步失败（{sync_error}），且无法自动启动 ChatGPT/Codex（{start_error}）。请手动启动 ChatGPT 或 Codex。"
        )),
    }
}

#[tauri::command]
pub(crate) async fn stop_local_proxy<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || stop_local_proxy_blocking(app))
        .await
        .map_err(|error| format!("Local proxy stop task failed: {error}"))?
}

fn stop_local_proxy_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    let _switch_guard = crate::commands::account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    let paths = resolve_paths(&app)?;
    let selected_account_id = read_state(&paths).active_account_id;

    // Validate the selected credential before interrupting the client. The managed
    // copy is loaded again after shutdown so auth.json receives the latest tokens.
    if let Some(account_id) = selected_account_id.as_deref() {
        let auth = crate::commands::load_validated_managed_auth(&paths, account_id)?;
        ensure_proxy_can_stop_with_auth(&auth)?;
    }

    let client_was_running = crate::commands::chatgpt_or_codex_is_running()?;
    let launch_target = client_was_running
        .then(|| crate::commands::refresh_and_get_chatgpt_launch_target(&app))
        .flatten();
    if client_was_running {
        crate::commands::stop_chatgpt_processes()?;
        crate::commands::wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    stop_server();
    if let Some(account_id) = selected_account_id.as_deref() {
        crate::commands::write_managed_auth_to_current(&paths, account_id)?;
    }
    providers::restore_official_config(&paths)?;
    let mut state = read_state(&paths);
    state.active_provider_id = None;
    state.local_proxy_enabled = false;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    let proxy_status = status(&app);
    if !client_was_running {
        return Ok(proxy_status);
    }

    let restart_result = crate::dream_skin::restart_active_session().and_then(|restarted| {
        if restarted {
            Ok(())
        } else {
            crate::commands::start_chatgpt(launch_target.as_ref())
        }
    });
    restart_result.map_err(|error| {
        format!(
            "Local proxy was stopped and the selected auth.json was restored, but ChatGPT/Codex could not be restarted ({error}). Please start ChatGPT or Codex manually."
        )
    })?;
    Ok(proxy_status)
}

fn ensure_proxy_can_stop_with_auth(auth: &Value) -> Result<(), String> {
    if is_agent_identity_auth(auth) {
        return Err(
            "当前账号使用 Agent Identity，只能在本地代理模式下使用。请先在代理模式中切换到 OAuth Token 或其他非 Agent Identity 账号，再停止代理"
                .to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_auto_switch_on_quota_exhaustion<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    if enabled && !is_running() {
        return Err(
            "Start the local proxy before enabling automatic account switching".to_string(),
        );
    }
    let paths = resolve_paths(&app)?;
    let mut state = read_state(&paths);
    state.auto_switch_on_quota_exhaustion = enabled;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) fn set_custom_auto_switch_priority_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    let paths = resolve_paths(&app)?;
    let mut state = read_state(&paths);
    if enabled && (!is_running() || !state.auto_switch_on_quota_exhaustion) {
        return Err(
            "Enable automatic account switching before enabling custom priorities".to_string(),
        );
    }
    state.custom_auto_switch_priority_enabled = enabled;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) fn set_auto_disable_unreachable_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    let paths = resolve_paths(&app)?;
    let mut state = read_state(&paths);
    if enabled && (!is_running() || !state.auto_switch_on_quota_exhaustion) {
        return Err(
            "Enable automatic account switching before enabling automatic disabling of unreachable accounts"
                .to_string(),
        );
    }
    state.auto_disable_unreachable_accounts = enabled;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) fn set_image_generation_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    account_id: Option<String>,
) -> Result<LocalProxyStatus, String> {
    if !is_running() {
        return Err(
            "Start the local proxy before selecting an image generation account".to_string(),
        );
    }

    let paths = resolve_paths(&app)?;
    let account_id = account_id.filter(|value| !value.trim().is_empty());
    if let Some(account_id) = account_id.as_deref() {
        let auth = crate::commands::load_validated_managed_auth(&paths, account_id)?;
        if is_agent_identity_auth(&auth) || token_string(&auth, "access_token").is_none() {
            return Err("Image generation account must use an OAuth token".to_string());
        }
    }

    let mut state = read_state(&paths);
    state.image_generation_account_id = account_id;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) async fn set_local_proxy_openai_auth_account<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    account_id: Option<String>,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_local_proxy_openai_auth_account_blocking(app, account_id)
    })
    .await
    .map_err(|error| format!("OpenAI login update task failed: {error}"))?
}

fn set_local_proxy_openai_auth_account_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    account_id: Option<String>,
) -> Result<LocalProxyStatus, String> {
    if !is_running() {
        return Err("Start the local proxy before selecting an OpenAI login account".to_string());
    }

    let _switch_guard = crate::commands::account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    let paths = resolve_paths(&app)?;
    let account_id = account_id.filter(|value| !value.trim().is_empty());
    providers::validate_local_proxy_openai_auth_account(&paths, account_id.as_deref())?;

    let mut state = read_state(&paths);
    if state.local_proxy_openai_auth_account_id == account_id {
        return Ok(status(&app));
    }
    state.local_proxy_openai_auth_account_id = account_id;
    write_state(&paths, &state)?;
    providers::apply_local_proxy_config_for_state(&app)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    let proxy_status = status(&app);

    crate::commands::restart_chatgpt_unlocked(&app).map_err(|error| {
        format!(
            "OpenAI login state was updated, but ChatGPT/Codex could not be restarted ({error}). Please start ChatGPT or Codex manually."
        )
    })?;
    Ok(proxy_status)
}

#[derive(Clone, Copy)]
enum OfficialCredentialPurpose {
    Default,
    ImageGeneration,
}

enum OfficialRequestAuthentication {
    OAuth {
        access_token: String,
        chatgpt_account_id: Option<String>,
    },
    AgentIdentity {
        active_account_id: String,
        auth: Value,
        request_authentication: agent_identity::AgentIdentityRequestAuthentication,
    },
}

struct OfficialProxyCredentials {
    authentication: OfficialRequestAuthentication,
    token_usage_account: TokenUsageAccount,
}

#[tauri::command]
pub(crate) fn set_local_proxy_listen_on_all_interfaces<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    if !is_running() {
        return Err("Start the local proxy before changing its listening address".to_string());
    }

    let paths = resolve_paths(&app)?;
    let mut state = read_state(&paths);
    let previous = state.local_proxy_listen_on_all_interfaces;
    if previous == enabled {
        return Ok(status(&app));
    }

    state.local_proxy_listen_on_all_interfaces = enabled;
    write_state(&paths, &state)?;
    stop_server();
    if let Err(error) = start_server(app.clone()) {
        state.local_proxy_listen_on_all_interfaces = previous;
        let _ = write_state(&paths, &state);
        let restore_error = start_server(app.clone()).err();
        return Err(match restore_error {
            Some(restore_error) => format!(
                "Failed to restart local proxy with the requested listening address: {error}. Failed to restore the previous listener: {restore_error}"
            ),
            None => format!(
                "Failed to restart local proxy with the requested listening address: {error}. The previous listener was restored."
            ),
        });
    }

    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

fn set_local_proxy_enabled(paths: &Paths, enabled: bool) -> Result<(), String> {
    let mut state = read_state(paths);
    state.local_proxy_enabled = enabled;
    write_state(paths, &state)
}

fn start_server<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let mut guard = runtime()
        .lock()
        .map_err(|_| "Local proxy runtime lock is poisoned".to_string())?;
    if guard.is_some() {
        return Ok(false);
    }

    let state = read_state(&resolve_paths(&app)?);
    let bind_addr = format!(
        "{}:{LOCAL_PROXY_PORT}",
        proxy_bind_host(state.local_proxy_listen_on_all_interfaces)
    );
    let server = Arc::new(
        Server::http(&bind_addr)
            .map_err(|error| format!("Failed to start local proxy at {bind_addr}: {error}"))?,
    );
    let server_for_thread = server.clone();
    let handle = thread::Builder::new()
        .name("codex-switch-local-proxy".to_string())
        .spawn(move || {
            for request in server_for_thread.incoming_requests() {
                let request_app = app.clone();
                let _ = thread::Builder::new()
                    .name("codex-switch-local-proxy-request".to_string())
                    .spawn(move || handle_request(request_app, request));
            }
        })
        .map_err(|error| format!("Failed to spawn local proxy thread: {error}"))?;
    *guard = Some(ProxyRuntime {
        server,
        handle: Some(handle),
    });
    Ok(true)
}

fn proxy_bind_host(listen_on_all_interfaces: bool) -> &'static str {
    if listen_on_all_interfaces {
        LOCAL_PROXY_LAN_HOST
    } else {
        LOCAL_PROXY_HOST
    }
}

fn stop_server() {
    let runtime = runtime().lock().ok().and_then(|mut guard| guard.take());
    if let Some(mut runtime) = runtime {
        runtime.server.unblock();
        if let Some(handle) = runtime.handle.take() {
            let _ = handle.join();
        }
    }
}

fn handle_request<R: Runtime>(app: tauri::AppHandle<R>, mut request: Request) {
    let method = request.method().clone();
    let url = request.url().to_string();
    let headers = request
        .headers()
        .iter()
        .map(|header| {
            (
                header.field.as_str().as_str().to_string(),
                header.value.as_str().to_string(),
            )
        })
        .collect::<Vec<_>>();

    let mut body = Vec::new();
    if let Err(error) = request.as_reader().read_to_end(&mut body) {
        respond_error(
            request,
            400,
            format!("Failed to read request body: {error}"),
        );
        return;
    }

    let result = handle_proxy_request(&app, &method, &url, &headers, body);
    match result {
        Ok(payload) => respond_payload(request, payload),
        Err(error) => respond_error(request, 502, error),
    }
}

fn handle_proxy_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
) -> Result<UpstreamPayload, String> {
    let path = request_path(url);
    let started_at = Instant::now();
    if *method == Method::Get && path == "/health" {
        let diagnostic = proxy_diagnostic_entry(
            method,
            url,
            headers,
            &body,
            None,
            ProxyDiagnosticRoute::LocalHealth,
        );
        let result = Ok(json_payload(200, json!({ "status": "ok" })));
        append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
        return result;
    }
    if *method == Method::Get && matches!(path, "/models" | "/v1/models") {
        let target = match active_target(app) {
            Ok(target) => target,
            Err(error) => {
                let diagnostic = proxy_diagnostic_entry(
                    method,
                    url,
                    headers,
                    &body,
                    None,
                    ProxyDiagnosticRoute::LocalModels,
                );
                let result = Err(error);
                append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
                return result;
            }
        };
        let diagnostic = proxy_diagnostic_entry(
            method,
            url,
            headers,
            &body,
            Some(&target),
            ProxyDiagnosticRoute::LocalModels,
        );
        let result = match &target {
            ActiveTarget::Official { model } => {
                forward_official(app, method, url, headers, body, model)
            }
            ActiveTarget::Provider(provider) => Ok(json_payload(
                200,
                providers::model_catalog_for_models(&provider_models_for_codex(provider)),
            )),
        };
        append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
        return result;
    }

    let target = match active_target(app) {
        Ok(target) => target,
        Err(error) => {
            let diagnostic = proxy_diagnostic_entry(
                method,
                url,
                headers,
                &body,
                None,
                ProxyDiagnosticRoute::TargetResolutionError,
            );
            let result = Err(error);
            append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
            return result;
        }
    };
    let route = proxy_diagnostic_route(path, &target);
    let diagnostic = proxy_diagnostic_entry(method, url, headers, &body, Some(&target), route);
    let usage_context = token_usage_context(method, path, &body, &target, started_at);
    let result = match target {
        ActiveTarget::Official { model } => {
            let response = forward_official(app, method, url, headers, body.clone(), &model);
            retry_official_request_after_quota_switch(app, response, || {
                forward_official(app, method, url, headers, body, &model)
            })
        }
        ActiveTarget::Provider(provider) => {
            if is_responses_endpoint(path) && provider.api_format == ProviderApiFormat::OpenaiChat {
                forward_chat_bridge(method, url, headers, body, &provider)
            } else {
                forward_provider(method, url, headers, body, &provider)
            }
        }
    };
    let result = attach_token_usage_capture(app, usage_context, result);
    append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
    result
}

fn retry_official_request_after_quota_switch<R: Runtime, F>(
    app: &tauri::AppHandle<R>,
    response: Result<UpstreamPayload, String>,
    retry: F,
) -> Result<UpstreamPayload, String>
where
    F: FnOnce() -> Result<UpstreamPayload, String>,
{
    retry_official_request_after_quota_switch_with(
        response,
        |observed_generation, observed_attempt_generation, failed_account_id| {
            auto_switch_official_account(
                app,
                observed_generation,
                observed_attempt_generation,
                failed_account_id,
            )
        },
        retry,
    )
}

fn retry_official_request_after_quota_switch_with<S, F>(
    response: Result<UpstreamPayload, String>,
    switch: S,
    retry: F,
) -> Result<UpstreamPayload, String>
where
    S: FnOnce(u64, u64, &str) -> Result<bool, String>,
    F: FnOnce() -> Result<UpstreamPayload, String>,
{
    let response = response?;
    if !is_official_quota_exhaustion(&response) {
        return Ok(response);
    }

    let Some(account) = response
        .token_usage_account
        .as_ref()
        .filter(|account| credential_can_trigger_auto_switch(account))
    else {
        return Ok(response);
    };
    let observed_generation = account.active_account_generation;
    let observed_attempt_generation = account.auto_switch_attempt_generation;
    let failed_account_id = account.account_id.clone();

    match switch(
        observed_generation,
        observed_attempt_generation,
        &failed_account_id,
    ) {
        Ok(true) => retry(),
        Ok(false) => Ok(response),
        Err(error) => {
            eprintln!(
                "failed to automatically switch official account after quota exhaustion: {error}"
            );
            Ok(response)
        }
    }
}

fn credential_can_trigger_auto_switch(account: &TokenUsageAccount) -> bool {
    account.auto_switch_eligible
}

fn is_official_quota_exhaustion(payload: &UpstreamPayload) -> bool {
    if payload.status == 429 {
        return true;
    }
    if payload.status != 403 {
        return false;
    }
    let UpstreamBody::Buffered(body) = &payload.body else {
        return false;
    };
    let message = String::from_utf8_lossy(body).to_ascii_lowercase();
    [
        "quota",
        "usage_limit",
        "rate_limit",
        "rate limit",
        "limit reached",
        "额度",
        "配额",
    ]
    .iter()
    .any(|signal| message.contains(signal))
}

fn auto_switch_official_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    observed_generation: u64,
    observed_attempt_generation: u64,
    failed_account_id: &str,
) -> Result<bool, String> {
    let should_retry = auto_switch_coordinator().switch_or_wait(
        observed_generation,
        observed_attempt_generation,
        failed_account_id,
        || try_auto_switch_official_account(app, failed_account_id),
    )?;
    if !should_retry {
        return Ok(false);
    }

    // The retry closure is intentionally official-only. If the user selected a Provider
    // while this request was waiting, keep the original quota response instead of sending
    // the retry through stale official routing.
    let state = read_state(&resolve_paths(app)?);
    Ok(state.active_provider_id.is_none() && state.active_account_id.is_some())
}

fn try_auto_switch_official_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    failed_account_id: &str,
) -> Result<AutoSwitchAttempt, String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    if !state.auto_switch_on_quota_exhaustion || state.active_provider_id.is_some() {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    let Some(current_id) = state.active_account_id else {
        return Ok(AutoSwitchAttempt::Unchanged);
    };

    // A manual official-account switch also makes the failed request stale. Retry against
    // it without advancing the automatic-switch generation or switching away from it.
    if current_id != failed_account_id {
        return Ok(AutoSwitchAttempt::AlreadyChanged);
    }

    // The quota result that triggered this flow can be stale, so refresh every enabled
    // official account before choosing a replacement instead of relying on cached usage.
    let accounts = crate::commands::list_accounts(app.clone())?;
    if !accounts
        .iter()
        .any(|account| account.id == current_id && account.auto_switch_enabled)
    {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    let refreshed_accounts = accounts
        .into_iter()
        .filter(|account| account.auto_switch_enabled)
        .filter_map(|mut account| {
            match crate::commands::refresh_usage_blocking(app.clone(), account.id.clone()) {
                Ok(usage) => {
                    account.usage = usage;
                    Some(account)
                }
                Err(error) => {
                    eprintln!(
                        "failed to refresh usage for {} during automatic switch: {error}",
                        account.id
                    );
                    None
                }
            }
        })
        .collect::<Vec<_>>();

    // Do not overwrite a manual switch or a Provider switch made while usage was refreshing.
    // A new official account can service one retry, while a Provider requires rerouting the
    // whole request and therefore leaves the original response unchanged here.
    let state = read_state(&paths);
    if !state.auto_switch_on_quota_exhaustion || state.active_provider_id.is_some() {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    if state.active_account_id.as_deref() != Some(&current_id) {
        return Ok(if state.active_account_id.is_some() {
            AutoSwitchAttempt::AlreadyChanged
        } else {
            AutoSwitchAttempt::Unchanged
        });
    }

    let Some(target) = account_with_lowest_remaining_primary_quota(
        &refreshed_accounts,
        &current_id,
        state.custom_auto_switch_priority_enabled,
    ) else {
        return Ok(AutoSwitchAttempt::Unchanged);
    };
    let target_id = target.id.clone();
    if let Err(error) = crate::commands::switch_account(app.clone(), target_id.clone()) {
        // switch_account writes the selected account before emitting UI events. If a
        // post-switch side effect failed, the new account is still active and concurrent
        // quota responses must be released to retry against it.
        let state = read_state(&paths);
        if state.active_provider_id.is_none()
            && state.active_account_id.as_deref() == Some(&target_id)
        {
            eprintln!(
                "automatic account switch to {target_id} completed with a post-switch error: {error}"
            );
            return Ok(AutoSwitchAttempt::Switched);
        }
        return Err(error);
    }
    Ok(AutoSwitchAttempt::Switched)
}

fn account_with_lowest_remaining_primary_quota<'a>(
    accounts: &'a [AccountSummary],
    current_id: &str,
    custom_priority_enabled: bool,
) -> Option<&'a AccountSummary> {
    accounts
        .iter()
        .filter(|account| account.id != current_id)
        .filter(|account| account.auto_switch_enabled)
        .filter_map(|account| {
            primary_remaining_quota_score(&account.usage).map(|score| (account, score))
        })
        .min_by(|(left_account, left_usage), (right_account, right_usage)| {
            let priority_order = if custom_priority_enabled {
                left_account
                    .auto_switch_priority
                    .cmp(&right_account.auto_switch_priority)
            } else {
                std::cmp::Ordering::Equal
            };
            priority_order.then_with(|| {
                left_usage
                    .partial_cmp(right_usage)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        })
        .map(|(account, _)| account)
}

fn primary_remaining_quota_score(usage: &UsageSummary) -> Option<f64> {
    if usage.error.is_some() {
        return None;
    }
    let primary = usage.primary.as_ref()?;
    if primary.remaining_percent <= 0.0 {
        return None;
    }
    Some(primary.remaining_percent)
}

fn active_target<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<ActiveTarget, String> {
    let paths = resolve_paths(app)?;
    if let Some(id) = read_state(&paths).active_provider_id {
        let provider = providers::read_provider(&paths, &id)?;
        providers::ensure_not_local_proxy_base_url(&provider.base_url)?;
        return Ok(ActiveTarget::Provider(provider));
    }
    Ok(ActiveTarget::Official {
        model: providers::preferred_official_model(&paths),
    })
}

fn proxy_diagnostic_route(path: &str, target: &ActiveTarget) -> ProxyDiagnosticRoute {
    match target {
        ActiveTarget::Official { .. } => ProxyDiagnosticRoute::Official,
        ActiveTarget::Provider(provider)
            if is_responses_endpoint(path)
                && provider.api_format == ProviderApiFormat::OpenaiChat =>
        {
            ProxyDiagnosticRoute::ProviderChatBridge
        }
        ActiveTarget::Provider(_) if is_responses_endpoint(path) => {
            ProxyDiagnosticRoute::ProviderResponsesPassthrough
        }
        ActiveTarget::Provider(_) => ProxyDiagnosticRoute::ProviderPassthrough,
    }
}

fn proxy_diagnostic_entry(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: &[u8],
    target: Option<&ActiveTarget>,
    route: ProxyDiagnosticRoute,
) -> Value {
    let path = request_path(url);
    let request_body = serde_json::from_slice::<Value>(body).ok();
    let upstream_endpoint = upstream_endpoint_for_codex_request(url);

    let mut entry = json!({
        "ts": unix_now(),
        "event": "local_proxy_request",
        "method": method.as_str(),
        "path": path,
        "query": request_query_diagnostic(url),
        "upstreamEndpoint": request_path(&upstream_endpoint),
        "isResponsesEndpoint": is_responses_endpoint(path),
        "route": route.as_str(),
        "requestBodyBytes": body.len(),
        "requestBodyHash": short_hash_bytes(body),
        "requestBody": request_body_diagnostic(body, request_body.as_ref()),
        "requestHeaders": diagnostic_header_summary(headers),
        "target": diagnostic_target(target, route),
    });

    if is_responses_endpoint(path) {
        entry["responses"] = request_body
            .as_ref()
            .map(responses_body_diagnostic)
            .unwrap_or_else(|| json!({ "json": false }));
    }

    entry
}

fn append_proxy_diagnostic_result<R: Runtime>(
    app: &tauri::AppHandle<R>,
    mut entry: Value,
    result: &Result<UpstreamPayload, String>,
    duration: Duration,
) {
    entry["durationMs"] = json!(duration.as_millis() as u64);
    match result {
        Ok(payload) => {
            let mut result = json!({
                "ok": status_ok(payload.status),
                "status": payload.status,
                "contentType": payload.content_type,
                "bodyKind": match &payload.body {
                    UpstreamBody::Buffered(_) => "buffered",
                    UpstreamBody::Streaming(_) => "streaming",
                }
            });
            if !status_ok(payload.status) {
                result["responseBody"] = match &payload.body {
                    UpstreamBody::Buffered(body) => {
                        diagnostic_response_body(body, payload.content_type.as_deref())
                    }
                    UpstreamBody::Streaming(_) => json!({
                        "captured": false,
                        "reason": "streaming response body was not buffered"
                    }),
                };
            }
            entry["result"] = result;
        }
        Err(error) => {
            entry["result"] = json!({
                "ok": false,
                "error": truncate_for_log(error, 240),
                "errorHash": short_hash_str(error)
            });
        }
    }

    if let Err(error) = append_diagnostic_log(app, &entry) {
        eprintln!("failed to write local proxy diagnostics: {error}");
    }
}

fn token_usage_context(
    method: &Method,
    path: &str,
    body: &[u8],
    target: &ActiveTarget,
    started_at: Instant,
) -> Option<TokenUsageContext> {
    if *method != Method::Post || !is_responses_endpoint(path) {
        return None;
    }

    let request_body = serde_json::from_slice::<Value>(body).ok();
    let (provider, model) = match target {
        ActiveTarget::Official { model } => {
            let selected_model = request_body
                .as_ref()
                .map(|value| selected_official_model(value, model))
                .unwrap_or_else(|| model.clone());
            ("Official Codex".to_string(), selected_model)
        }
        ActiveTarget::Provider(provider) => {
            let model = request_body
                .as_ref()
                .map(|value| selected_provider_model(value, provider))
                .unwrap_or_else(|| provider.model.clone());
            (provider.name.clone(), model)
        }
    };

    Some(TokenUsageContext {
        ts: unix_now(),
        provider,
        model,
        request_hash: short_hash_bytes(body),
        started_at,
        content_type: None,
        expects_event_stream: request_body
            .as_ref()
            .and_then(|value| value.get("stream"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        account: None,
    })
}

fn attach_token_usage_capture<R: Runtime + 'static>(
    app: &tauri::AppHandle<R>,
    context: Option<TokenUsageContext>,
    result: Result<UpstreamPayload, String>,
) -> Result<UpstreamPayload, String> {
    let mut payload = result?;
    let Some(mut context) = context else {
        return Ok(payload);
    };
    if !status_ok(payload.status) {
        return Ok(payload);
    }
    context.content_type = payload.content_type.clone();
    context.account = payload.token_usage_account.clone();
    payload.body = match payload.body {
        UpstreamBody::Buffered(body) => {
            let usage = extract_token_usage_from_bytes(
                &body,
                context.content_type.as_deref(),
                context.expects_event_stream,
            );
            record_token_usage_entry(app, &context, usage);
            UpstreamBody::Buffered(body)
        }
        UpstreamBody::Streaming(reader) => UpstreamBody::Streaming(Box::new(
            TokenUsageCaptureReader::new(reader, app.clone(), context),
        )),
    };
    Ok(payload)
}

struct TokenUsageCaptureReader<R: Runtime> {
    inner: Box<dyn Read + Send>,
    app: tauri::AppHandle<R>,
    context: TokenUsageContext,
    body: Vec<u8>,
    sse_buffer: String,
    usage: Option<TokenUsageValues>,
    recorded: bool,
}

impl<R: Runtime> TokenUsageCaptureReader<R> {
    fn new(
        inner: Box<dyn Read + Send>,
        app: tauri::AppHandle<R>,
        context: TokenUsageContext,
    ) -> Self {
        Self {
            inner,
            app,
            context,
            body: Vec::new(),
            sse_buffer: String::new(),
            usage: None,
            recorded: false,
        }
    }

    fn observe(&mut self, bytes: &[u8]) {
        if self.captures_event_stream() {
            let chunk = String::from_utf8_lossy(bytes).replace("\r\n", "\n");
            self.sse_buffer.push_str(&chunk);
            self.process_sse_blocks();
            return;
        }
        let remaining = TOKEN_USAGE_CAPTURE_MAX_BYTES.saturating_sub(self.body.len());
        if remaining > 0 {
            self.body
                .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        }
    }

    fn process_sse_blocks(&mut self) {
        while let Some(index) = self.sse_buffer.find("\n\n") {
            let block = self.sse_buffer[..index].to_string();
            self.sse_buffer.drain(..index + 2);
            self.process_sse_block(&block);
        }
    }

    fn process_sse_block(&mut self, block: &str) {
        let data = block
            .lines()
            .filter_map(|line| line.trim_start().strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if data.trim().is_empty() || data.trim() == "[DONE]" {
            return;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&data) {
            if let Some(usage) = extract_token_usage_from_value(&value) {
                self.usage = Some(usage);
            }
        }
    }

    fn captures_event_stream(&self) -> bool {
        self.context.expects_event_stream || is_event_stream(self.context.content_type.as_deref())
    }

    fn finish(&mut self) {
        if self.recorded {
            return;
        }
        self.recorded = true;
        if self.captures_event_stream() {
            self.process_sse_blocks();
            if !self.sse_buffer.trim().is_empty() {
                let block = std::mem::take(&mut self.sse_buffer);
                self.process_sse_block(&block);
            }
        } else if self.usage.is_none() {
            self.usage = extract_token_usage_from_bytes(
                &self.body,
                self.context.content_type.as_deref(),
                self.context.expects_event_stream,
            );
        }
        record_token_usage_entry(&self.app, &self.context, self.usage.clone());
    }
}

impl<R: Runtime> Read for TokenUsageCaptureReader<R> {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        match self.inner.read(target) {
            Ok(0) => {
                self.finish();
                Ok(0)
            }
            Ok(count) => {
                self.observe(&target[..count]);
                Ok(count)
            }
            Err(error) => {
                self.finish();
                Err(error)
            }
        }
    }
}

impl<R: Runtime> Drop for TokenUsageCaptureReader<R> {
    fn drop(&mut self) {
        self.finish();
    }
}

fn extract_token_usage_from_bytes(
    bytes: &[u8],
    content_type: Option<&str>,
    expects_event_stream: bool,
) -> Option<TokenUsageValues> {
    if expects_event_stream || is_event_stream(content_type) {
        let text = String::from_utf8_lossy(bytes).replace("\r\n", "\n");
        let mut usage = None;
        for block in text.split("\n\n") {
            let data = block
                .lines()
                .filter_map(|line| line.trim_start().strip_prefix("data:"))
                .map(str::trim_start)
                .collect::<Vec<_>>()
                .join("\n");
            if data.trim().is_empty() || data.trim() == "[DONE]" {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&data) {
                if let Some(next) = extract_token_usage_from_value(&value) {
                    usage = Some(next);
                }
            }
        }
        return usage;
    }

    serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| extract_token_usage_from_value(&value))
}

fn extract_token_usage_from_value(value: &Value) -> Option<TokenUsageValues> {
    let usage = value
        .get("usage")
        .filter(|usage| !usage.is_null())
        .or_else(|| {
            value
                .pointer("/response/usage")
                .filter(|usage| !usage.is_null())
        })
        .or_else(|| {
            value
                .pointer("/choices/0/usage")
                .filter(|usage| !usage.is_null())
        })?;
    Some(token_usage_values_from_usage(usage))
}

fn token_usage_values_from_usage(usage: &Value) -> TokenUsageValues {
    let input_tokens = first_usage_number(usage, &[&["input_tokens"], &["prompt_tokens"]]);
    let output_tokens = first_usage_number(usage, &[&["output_tokens"], &["completion_tokens"]]);
    let reasoning_tokens = first_usage_number(
        usage,
        &[
            &["output_tokens_details", "reasoning_tokens"],
            &["completion_tokens_details", "reasoning_tokens"],
            &["reasoning_tokens"],
        ],
    );
    let cached_tokens = first_usage_number(
        usage,
        &[
            &["input_tokens_details", "cached_tokens"],
            &["prompt_tokens_details", "cached_tokens"],
            &["cache_read_input_tokens"],
            &["cached_tokens"],
            &["prompt_cache_hit_tokens"],
        ],
    );
    let total_tokens = first_usage_number(usage, &[&["total_tokens"]]).or_else(|| {
        input_tokens
            .zip(output_tokens)
            .map(|(input, output)| input + output)
    });

    TokenUsageValues {
        input_tokens,
        output_tokens,
        reasoning_tokens,
        cached_tokens,
        total_tokens,
    }
}

fn first_usage_number(usage: &Value, paths: &[&[&str]]) -> Option<u64> {
    paths
        .iter()
        .find_map(|path| usage_number_at_path(usage, path))
}

fn usage_number_at_path(value: &Value, path: &[&str]) -> Option<u64> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current
        .as_u64()
        .or_else(|| current.as_i64().and_then(|value| u64::try_from(value).ok()))
}

fn record_token_usage_entry<R: Runtime>(
    app: &tauri::AppHandle<R>,
    context: &TokenUsageContext,
    usage: Option<TokenUsageValues>,
) {
    let usage = usage.unwrap_or_default();
    let duration_ms = context.started_at.elapsed().as_millis() as u64;
    let id = short_hash_str(&format!(
        "{}:{}:{}:{}:{}:{}",
        context.ts,
        context.provider,
        context.model,
        context.request_hash,
        duration_ms,
        unix_millis()
    ));
    let entry = TokenUsageEntry {
        id,
        ts: context.ts,
        provider: context.provider.clone(),
        account_id: context
            .account
            .as_ref()
            .map(|account| account.account_id.clone()),
        account_email: context
            .account
            .as_ref()
            .map(|account| account.account_email.clone()),
        model: context.model.clone(),
        duration_ms: Some(duration_ms),
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        reasoning_tokens: usage.reasoning_tokens,
        cached_tokens: usage.cached_tokens,
        total_tokens: usage.total_tokens,
    };
    if let Err(error) = append_token_usage_entry(app, &entry) {
        eprintln!("failed to write token usage entry: {error}");
    }
}

fn diagnostic_header_summary(headers: &[(String, String)]) -> Value {
    json!({
        "xClientRequestId": diagnostic_header_value(headers, "x-client-request-id"),
        "xCodexWindowId": diagnostic_header_value(headers, "x-codex-window-id"),
        "sessionId": diagnostic_header_value(headers, "session_id"),
        "contentType": diagnostic_header_value(headers, "content-type"),
        "accept": diagnostic_header_value(headers, "accept"),
        "authorizationPresent": header_value(headers, "authorization").is_some(),
        "apiKeyPresent": header_value(headers, "x-api-key").is_some()
            || header_value(headers, "openai-api-key").is_some()
            || header_value(headers, "api-key").is_some(),
        "chatgptAccountIdPresent": header_value(headers, "chatgpt-account-id").is_some()
    })
}

fn diagnostic_header_value(headers: &[(String, String)], name: &str) -> Value {
    header_value(headers, name)
        .map(diagnostic_string_value)
        .unwrap_or_else(|| json!({ "present": false }))
}

fn header_value<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn request_query_diagnostic(url: &str) -> Value {
    url.split_once('?')
        .map(|(_, query)| diagnostic_string_value(query))
        .unwrap_or_else(|| json!({ "present": false }))
}

fn diagnostic_target(target: Option<&ActiveTarget>, route: ProxyDiagnosticRoute) -> Value {
    match target {
        Some(ActiveTarget::Official { model }) => json!({
            "type": "official",
            "model": model
        }),
        Some(ActiveTarget::Provider(provider)) => json!({
            "type": "provider",
            "id": provider.id,
            "name": provider.name,
            "apiFormat": provider.api_format,
            "model": provider.model,
            "modelSelectionControlledByCodex": provider.model_selection_controlled_by_codex
        }),
        None if route.is_local() => json!({ "type": "local" }),
        None => json!({ "type": "unresolved" }),
    }
}

fn request_body_diagnostic(body: &[u8], parsed: Option<&Value>) -> Value {
    let mut result = json!({
        "bytes": body.len(),
        "hash": short_hash_bytes(body),
    });

    let Some(value) = parsed else {
        result["json"] = Value::Bool(false);
        result["empty"] = Value::Bool(body.is_empty());
        return result;
    };

    result["json"] = Value::Bool(true);
    result["shape"] = diagnostic_value_shape(Some(value));
    result["model"] = diagnostic_scalar_value(value.get("model"));
    result["stream"] = diagnostic_scalar_value(value.get("stream"));
    result["store"] = diagnostic_scalar_value(value.get("store"));
    result["previousResponseId"] = value
        .get("previous_response_id")
        .and_then(Value::as_str)
        .map(diagnostic_string_value)
        .unwrap_or_else(|| diagnostic_scalar_value(value.get("previous_response_id")));
    result["input"] = diagnostic_value_shape(value.get("input"));
    result["messages"] = diagnostic_value_shape(value.get("messages"));
    result["tools"] = diagnostic_value_shape(value.get("tools"));
    result["toolChoice"] = diagnostic_value_shape(value.get("tool_choice"));
    result["include"] = diagnostic_value_shape(value.get("include"));
    result["instructions"] = diagnostic_value_shape(value.get("instructions"));
    result["metadata"] = diagnostic_value_shape(value.get("metadata"));
    result["maxOutputTokens"] = diagnostic_scalar_value(value.get("max_output_tokens"));
    result["maxTokens"] = diagnostic_scalar_value(value.get("max_tokens"));
    result["temperature"] = diagnostic_scalar_value(value.get("temperature"));
    result
}

fn responses_body_diagnostic(body: &Value) -> Value {
    json!({
        "json": true,
        "model": diagnostic_scalar_value(body.get("model")),
        "previousResponseId": body
            .get("previous_response_id")
            .and_then(Value::as_str)
            .map(diagnostic_string_value)
            .unwrap_or_else(|| json!({ "present": false })),
        "store": diagnostic_scalar_value(body.get("store")),
        "stream": diagnostic_scalar_value(body.get("stream")),
        "input": diagnostic_value_shape(body.get("input")),
        "tools": diagnostic_value_shape(body.get("tools")),
        "include": diagnostic_value_shape(body.get("include")),
        "instructions": diagnostic_value_shape(body.get("instructions")),
        "bodyHash": diagnostic_value_hash(body)
    })
}

fn diagnostic_string_value(value: &str) -> Value {
    json!({
        "present": true,
        "len": value.len(),
        "hash": short_hash_str(value)
    })
}

fn diagnostic_scalar_value(value: Option<&Value>) -> Value {
    match value {
        None => json!({ "present": false }),
        Some(Value::Bool(value)) => json!({ "present": true, "type": "bool", "value": value }),
        Some(Value::Number(value)) => json!({ "present": true, "type": "number", "value": value }),
        Some(Value::String(value)) => json!({
            "present": true,
            "type": "string",
            "len": value.len(),
            "hash": short_hash_str(value)
        }),
        Some(other) => diagnostic_value_shape(Some(other)),
    }
}

fn diagnostic_response_body(bytes: &[u8], content_type: Option<&str>) -> Value {
    let (text, utf8) = match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_string(), true),
        Err(_) => (String::from_utf8_lossy(bytes).to_string(), false),
    };
    json!({
        "captured": true,
        "bytes": bytes.len(),
        "hash": short_hash_bytes(bytes),
        "contentType": content_type,
        "utf8": utf8,
        "truncated": text.chars().count() > DIAGNOSTIC_RESPONSE_BODY_MAX_CHARS,
        "text": truncate_for_log(&text, DIAGNOSTIC_RESPONSE_BODY_MAX_CHARS)
    })
}

fn diagnostic_value_shape(value: Option<&Value>) -> Value {
    let Some(value) = value else {
        return json!({ "present": false });
    };

    let mut result = match value {
        Value::Null => json!({ "present": true, "type": "null" }),
        Value::Bool(_) => json!({ "present": true, "type": "bool" }),
        Value::Number(_) => json!({ "present": true, "type": "number" }),
        Value::String(text) => json!({ "present": true, "type": "string", "len": text.len() }),
        Value::Array(items) => json!({ "present": true, "type": "array", "len": items.len() }),
        Value::Object(map) => json!({ "present": true, "type": "object", "len": map.len() }),
    };
    result["hash"] = Value::String(diagnostic_value_hash(value));
    result
}

fn diagnostic_value_hash(value: &Value) -> String {
    short_hash_str(&canonical_json_string(value))
}

fn short_hash_str(value: &str) -> String {
    short_hash_bytes(value.as_bytes())
}

fn short_hash_bytes(value: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value);
    let digest = hasher.finalize();
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn truncate_for_log(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for ch in value.chars().take(max_chars) {
        output.push(ch);
    }
    if value.chars().count() > max_chars {
        output.push_str("...");
    }
    output
}

fn append_diagnostic_log<R: Runtime>(
    app: &tauri::AppHandle<R>,
    entry: &Value,
) -> Result<(), String> {
    let path = diagnostic_log_path(app)?;
    rotate_diagnostic_log_if_needed(&path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Diagnostic log path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    serde_json::to_writer(&mut file, entry)
        .map_err(|error| format!("Failed to serialize diagnostic log: {error}"))?;
    file.write_all(b"\n")
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn rotate_diagnostic_log_if_needed(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.len() <= DIAGNOSTIC_LOG_MAX_BYTES {
        return Ok(());
    }

    let rotated = path.with_extension("jsonl.old");
    if rotated.exists() {
        fs::remove_file(&rotated)
            .map_err(|error| format!("Failed to remove {}: {error}", rotated.display()))?;
    }
    fs::rename(path, &rotated).map_err(|error| {
        format!(
            "Failed to rotate diagnostic log {} to {}: {error}",
            path.display(),
            rotated.display()
        )
    })
}

fn diagnostic_log_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data directory: {error}"))?;
    Ok(app_data.join("logs").join(DIAGNOSTIC_LOG_FILE_NAME))
}

fn append_token_usage_entry<R: Runtime>(
    app: &tauri::AppHandle<R>,
    entry: &TokenUsageEntry,
) -> Result<(), String> {
    let connection = open_token_usage_db(app)?;
    insert_token_usage_entry(&connection, entry)?;
    prune_token_usage_entries(&connection)
}

fn open_token_usage_db<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Connection, String> {
    let _guard = token_usage_db_lock()
        .lock()
        .map_err(|error| format!("Failed to lock token usage database: {error}"))?;
    let path = token_usage_db_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Token usage database path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;

    let mut connection = Connection::open(&path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    connection
        .busy_timeout(Duration::from_secs(3))
        .map_err(|error| format!("Failed to configure {}: {error}", path.display()))?;
    init_token_usage_schema(&connection)?;
    let jsonl_path = token_usage_jsonl_path(app)?;
    migrate_token_usage_jsonl_if_needed(&mut connection, &jsonl_path)?;
    Ok(connection)
}

fn init_token_usage_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS token_usage_entries (
                id TEXT PRIMARY KEY,
                ts INTEGER NOT NULL,
                provider TEXT NOT NULL,
                account_id TEXT,
                account_email TEXT,
                model TEXT NOT NULL,
                duration_ms INTEGER,
                input_tokens INTEGER,
                output_tokens INTEGER,
                reasoning_tokens INTEGER,
                cached_tokens INTEGER,
                total_tokens INTEGER,
                created_at_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS token_usage_entries_ts_id
                ON token_usage_entries (ts DESC, id DESC);
            CREATE TABLE IF NOT EXISTS token_usage_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )
        .map_err(|error| format!("Failed to initialize token usage database: {error}"))?;
    ensure_token_usage_account_columns(connection)
}

fn ensure_token_usage_account_columns(connection: &Connection) -> Result<(), String> {
    let columns = token_usage_table_columns(connection)?;
    for (name, sql) in [
        (
            "account_id",
            "ALTER TABLE token_usage_entries ADD COLUMN account_id TEXT",
        ),
        (
            "account_email",
            "ALTER TABLE token_usage_entries ADD COLUMN account_email TEXT",
        ),
    ] {
        if !columns.contains(name) {
            connection
                .execute(sql, [])
                .map_err(|error| format!("Failed to add token usage column {name}: {error}"))?;
        }
    }
    Ok(())
}

fn token_usage_table_columns(connection: &Connection) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(token_usage_entries)")
        .map_err(|error| format!("Failed to inspect token usage database: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Failed to inspect token usage columns: {error}"))?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|error| format!("Failed to read token usage columns: {error}"))
}

fn migrate_token_usage_jsonl_if_needed(
    connection: &mut Connection,
    path: &Path,
) -> Result<(), String> {
    let migrated = connection
        .query_row(
            "SELECT value FROM token_usage_meta WHERE key = 'jsonl_migrated'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read token usage migration state: {error}"))?
        .is_some();
    if migrated {
        return Ok(());
    }

    if path.exists() {
        import_token_usage_jsonl(connection, path)?;
        prune_token_usage_entries(connection)?;
    }
    connection
        .execute(
            "INSERT OR REPLACE INTO token_usage_meta (key, value) VALUES ('jsonl_migrated', '1')",
            [],
        )
        .map_err(|error| format!("Failed to write token usage migration state: {error}"))?;
    Ok(())
}

fn import_token_usage_jsonl(connection: &mut Connection, path: &Path) -> Result<usize, String> {
    let file = fs::File::open(path).map_err(|error| {
        format!(
            "Failed to open legacy token usage log {}: {error}",
            path.display()
        )
    })?;
    let reader = BufReader::new(file);
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Failed to start token usage migration: {error}"))?;
    let mut imported = 0;
    {
        let mut statement = transaction
            .prepare(
                r#"
                INSERT OR IGNORE INTO token_usage_entries (
                    id, ts, provider, account_id, account_email, model, duration_ms,
                    input_tokens, output_tokens, reasoning_tokens, cached_tokens,
                    total_tokens, created_at_ms
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                "#,
            )
            .map_err(|error| format!("Failed to prepare token usage migration: {error}"))?;
        for line in reader.lines() {
            let line = line.map_err(|error| {
                format!(
                    "Failed to read legacy token usage log {}: {error}",
                    path.display()
                )
            })?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<TokenUsageEntry>(trimmed) else {
                continue;
            };
            imported += insert_token_usage_entry_with_statement(&mut statement, &entry)?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Failed to commit token usage migration: {error}"))?;
    Ok(imported)
}

fn insert_token_usage_entry(
    connection: &Connection,
    entry: &TokenUsageEntry,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            INSERT OR IGNORE INTO token_usage_entries (
                id, ts, provider, account_id, account_email, model, duration_ms,
                input_tokens, output_tokens, reasoning_tokens, cached_tokens,
                total_tokens, created_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            "#,
            token_usage_params(entry),
        )
        .map(|_| ())
        .map_err(|error| format!("Failed to insert token usage entry: {error}"))
}

fn insert_token_usage_entry_with_statement(
    statement: &mut rusqlite::Statement<'_>,
    entry: &TokenUsageEntry,
) -> Result<usize, String> {
    statement
        .execute(token_usage_params(entry))
        .map_err(|error| format!("Failed to import token usage entry: {error}"))
}

fn list_token_usage_entries_from_db(
    connection: &Connection,
    limit: usize,
) -> Result<Vec<TokenUsageEntry>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, ts, provider, account_id, account_email, model, duration_ms,
                   input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens
            FROM token_usage_entries
            ORDER BY ts DESC, id DESC
            LIMIT ?1
            "#,
        )
        .map_err(|error| format!("Failed to query token usage entries: {error}"))?;
    let rows = statement
        .query_map(params![usize_to_i64(limit)], |row| {
            Ok(TokenUsageEntry {
                id: row.get(0)?,
                ts: i64_to_u64(row.get::<_, i64>(1)?),
                provider: row.get(2)?,
                account_id: row.get(3)?,
                account_email: row.get(4)?,
                model: row.get(5)?,
                duration_ms: opt_i64_to_u64(row.get(6)?),
                input_tokens: opt_i64_to_u64(row.get(7)?),
                output_tokens: opt_i64_to_u64(row.get(8)?),
                reasoning_tokens: opt_i64_to_u64(row.get(9)?),
                cached_tokens: opt_i64_to_u64(row.get(10)?),
                total_tokens: opt_i64_to_u64(row.get(11)?),
            })
        })
        .map_err(|error| format!("Failed to read token usage entries: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to parse token usage entries: {error}"))
}

fn list_daily_token_usage_from_db(
    connection: &Connection,
    start_ts: u64,
) -> Result<Vec<DailyTokenUsage>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT ts, total_tokens, input_tokens, output_tokens, reasoning_tokens, cached_tokens
            FROM token_usage_entries
            WHERE ts >= ?1
            ORDER BY ts ASC
            "#,
        )
        .map_err(|error| format!("Failed to query daily token usage: {error}"))?;
    let rows = statement
        .query_map(params![u64_to_i64(start_ts)], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        })
        .map_err(|error| format!("Failed to read daily token usage: {error}"))?;

    let mut daily_totals = BTreeMap::<String, (u64, u64, u64, u64, u64)>::new();
    for row in rows {
        let (timestamp, total, input, output, reasoning, cached) =
            row.map_err(|error| format!("Failed to parse daily token usage: {error}"))?;
        let Some(local_time) = Local.timestamp_opt(timestamp, 0).single() else {
            continue;
        };
        let input = opt_i64_to_u64(input).unwrap_or(0);
        let output = opt_i64_to_u64(output).unwrap_or(0);
        let reasoning = opt_i64_to_u64(reasoning).unwrap_or(0);
        let cached = opt_i64_to_u64(cached).unwrap_or(0);
        let total = opt_i64_to_u64(total).unwrap_or_else(|| input.saturating_add(output));
        let date = local_time.format("%Y-%m-%d").to_string();
        daily_totals
            .entry(date)
            .and_modify(|current| {
                current.0 = current.0.saturating_add(total);
                current.1 = current.1.saturating_add(input);
                current.2 = current.2.saturating_add(output);
                current.3 = current.3.saturating_add(reasoning);
                current.4 = current.4.saturating_add(cached);
            })
            .or_insert((total, input, output, reasoning, cached));
    }

    Ok(daily_totals
        .into_iter()
        .map(
            |(
                date,
                (total_tokens, input_tokens, output_tokens, reasoning_tokens, cached_tokens),
            )| DailyTokenUsage {
                date,
                total_tokens,
                input_tokens,
                output_tokens,
                reasoning_tokens,
                cached_tokens,
            },
        )
        .collect())
}

fn prune_token_usage_entries(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            r#"
            DELETE FROM token_usage_entries
            WHERE id IN (
                SELECT id FROM token_usage_entries
                ORDER BY ts DESC, id DESC
                LIMIT -1 OFFSET ?1
            )
            "#,
            params![TOKEN_USAGE_DB_KEEP_ROWS],
        )
        .map(|_| ())
        .map_err(|error| format!("Failed to prune token usage entries: {error}"))
}

fn token_usage_params(entry: &TokenUsageEntry) -> [rusqlite::types::Value; 13] {
    [
        rusqlite::types::Value::Text(entry.id.clone()),
        rusqlite::types::Value::Integer(u64_to_i64(entry.ts)),
        rusqlite::types::Value::Text(entry.provider.clone()),
        optional_string_value(entry.account_id.as_deref()),
        optional_string_value(entry.account_email.as_deref()),
        rusqlite::types::Value::Text(entry.model.clone()),
        optional_u64_value(entry.duration_ms),
        optional_u64_value(entry.input_tokens),
        optional_u64_value(entry.output_tokens),
        optional_u64_value(entry.reasoning_tokens),
        optional_u64_value(entry.cached_tokens),
        optional_u64_value(entry.total_tokens),
        rusqlite::types::Value::Integer(u128_to_i64(unix_millis())),
    ]
}

fn optional_string_value(value: Option<&str>) -> rusqlite::types::Value {
    value
        .map(|value| rusqlite::types::Value::Text(value.to_string()))
        .unwrap_or(rusqlite::types::Value::Null)
}

fn optional_u64_value(value: Option<u64>) -> rusqlite::types::Value {
    value
        .map(|value| rusqlite::types::Value::Integer(u64_to_i64(value)))
        .unwrap_or(rusqlite::types::Value::Null)
}

fn opt_i64_to_u64(value: Option<i64>) -> Option<u64> {
    value.and_then(|value| u64::try_from(value).ok())
}

fn i64_to_u64(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn u64_to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn u128_to_i64(value: u128) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn usize_to_i64(value: usize) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn token_usage_db_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data directory: {error}"))?;
    Ok(app_data.join(TOKEN_USAGE_DB_FILE_NAME))
}

fn token_usage_jsonl_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data directory: {error}"))?;
    Ok(app_data.join("logs").join(TOKEN_USAGE_JSONL_FILE_NAME))
}

fn forward_official<R: Runtime>(
    app: &tauri::AppHandle<R>,
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    model: &str,
) -> Result<UpstreamPayload, String> {
    let client = http_client()?;
    let upstream_endpoint = upstream_endpoint_for_codex_request(url);
    let credential_purpose = if is_image_generation_endpoint(request_path(&upstream_endpoint)) {
        OfficialCredentialPurpose::ImageGeneration
    } else {
        OfficialCredentialPurpose::Default
    };
    let mut credentials = official_credentials(app, &client, credential_purpose)?;
    let upstream_url = official_url(&upstream_endpoint);
    let body = official_body_for_upstream(method, &upstream_endpoint, body, model);
    let mut payload = send_official_request(
        &client,
        method,
        &upstream_url,
        headers,
        body.as_slice(),
        &credentials.authentication,
    )?;
    if invalid_agent_identity_task_response(&credentials.authentication, &payload) {
        refresh_agent_identity_task(&mut credentials.authentication, app, &client)?;
        payload = send_official_request(
            &client,
            method,
            &upstream_url,
            headers,
            body.as_slice(),
            &credentials.authentication,
        )?;
    }
    payload.token_usage_account = Some(credentials.token_usage_account);
    Ok(payload)
}

fn send_official_request(
    client: &Client,
    method: &Method,
    upstream_url: &str,
    headers: &[(String, String)],
    body: &[u8],
    authentication: &OfficialRequestAuthentication,
) -> Result<UpstreamPayload, String> {
    let mut request = client
        .request(reqwest_method(method)?, upstream_url)
        .header("originator", ORIGINATOR)
        .header("User-Agent", "codex_cli_rs/0.1.0");
    match authentication {
        OfficialRequestAuthentication::OAuth {
            access_token,
            chatgpt_account_id,
        } => {
            request = request.bearer_auth(access_token);
            if let Some(account_id) = chatgpt_account_id {
                request = request.header("ChatGPT-Account-Id", account_id);
            }
        }
        OfficialRequestAuthentication::AgentIdentity {
            request_authentication,
            ..
        } => {
            request = request
                .header("Authorization", &request_authentication.authorization)
                .header("ChatGPT-Account-Id", &request_authentication.account_id);
            if request_authentication.is_fedramp {
                request = request.header("x-openai-fedramp", "true");
            }
        }
    }
    stream_response(
        apply_forward_headers(request, headers, true)
            .body(body.to_vec())
            .send()
            .map_err(|error| format!("Official Codex proxy request failed: {error}"))?,
    )
}

fn official_body_for_upstream(method: &Method, url: &str, body: Vec<u8>, model: &str) -> Vec<u8> {
    if *method != Method::Post || !is_responses_endpoint(request_path(url)) {
        return body;
    }
    let model = model.trim();
    if model.is_empty() {
        return body;
    }
    let Ok(mut value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    if requested_model(&value).is_some() {
        return body;
    }
    value["model"] = Value::String(selected_official_model(&value, model));
    serde_json::to_vec(&value).unwrap_or(body)
}

fn forward_provider(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    let client = http_client()?;
    let upstream_endpoint = upstream_endpoint_for_codex_request(url);
    let upstream_url = build_upstream_url(&provider.base_url, &upstream_endpoint);
    let body = provider_body_for_upstream(method, &upstream_endpoint, body, provider);
    let request = client
        .request(reqwest_method(method)?, upstream_url)
        .bearer_auth(provider.api_key.trim());
    let request = apply_forward_headers(request, headers, true);
    stream_response(
        request
            .body(body)
            .send()
            .map_err(|error| format!("Provider proxy request failed: {error}"))?,
    )
}

fn provider_models_for_codex(provider: &ProviderProfile) -> Vec<String> {
    if provider.model_selection_controlled_by_codex {
        provider.models.clone()
    } else {
        vec![provider.model.clone()]
    }
}

fn provider_body_for_upstream(
    method: &Method,
    url: &str,
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Vec<u8> {
    if *method != Method::Post || !is_responses_endpoint(request_path(url)) {
        return body;
    }
    let Ok(mut value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    value["model"] = Value::String(selected_provider_model(&value, provider));
    serde_json::to_vec(&value).unwrap_or(body)
}

fn forward_chat_bridge(
    method: &Method,
    _url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    if *method != Method::Post {
        return Err("Chat bridge only supports POST requests".to_string());
    }
    let mut responses_body: Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Responses request body is not valid JSON: {error}"))?;
    let selected_model = selected_provider_model(&responses_body, provider);
    responses_body["model"] = Value::String(selected_model.clone());
    let tool_context = build_codex_tool_context_from_request(&responses_body);
    let chat_body = responses_to_chat_completions_with_context(&responses_body, &tool_context);
    let stream = chat_body
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let client = http_client()?;
    let upstream_url = build_upstream_url(&provider.base_url, "/chat/completions");
    let request = client
        .post(upstream_url)
        .bearer_auth(provider.api_key.trim())
        .json(&chat_body);
    let request = apply_forward_headers(request, headers, true);
    let response = request
        .send()
        .map_err(|error| format!("Chat bridge request failed: {error}"))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let response_headers = forwarded_response_headers(response.headers());
    if stream && status_ok(status) && is_event_stream(content_type.as_deref()) {
        return Ok(UpstreamPayload {
            status,
            content_type: Some("text/event-stream; charset=utf-8".to_string()),
            response_headers,
            body: UpstreamBody::Streaming(Box::new(ChatSseReader::new(
                BufReader::new(response),
                selected_model,
                tool_context,
            ))),
            token_usage_account: None,
        });
    }

    let body = response
        .bytes()
        .map_err(|error| format!("Failed to read chat bridge response: {error}"))?;
    if !status_ok(status) {
        return Ok(UpstreamPayload {
            status,
            content_type: content_type
                .or_else(|| Some("application/json; charset=utf-8".to_string())),
            response_headers,
            body: UpstreamBody::Buffered(body.to_vec()),
            token_usage_account: None,
        });
    }

    let json: Value = serde_json::from_slice(&body)
        .map_err(|_| "Chat bridge upstream returned non-JSON response".to_string())?;
    let mut payload = json_payload(status, chat_to_responses_json(&json, &tool_context));
    payload.response_headers = response_headers;
    Ok(payload)
}

fn selected_provider_model(body: &Value, provider: &ProviderProfile) -> String {
    if !provider.model_selection_controlled_by_codex {
        return provider.model.clone();
    }
    body.get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| provider.models.iter().any(|allowed| allowed == model))
        .unwrap_or(&provider.model)
        .to_string()
}

fn requested_model(body: &Value) -> Option<&str> {
    body.get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
}

fn selected_official_model(body: &Value, fallback: &str) -> String {
    requested_model(body)
        .unwrap_or_else(|| fallback.trim())
        .to_string()
}

fn official_credentials<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    purpose: OfficialCredentialPurpose,
) -> Result<OfficialProxyCredentials, String> {
    let paths = resolve_paths(app)?;
    // Bind the selected account to both coordinator generations. Requests that start
    // during a switch wait here and use the new account generation; requests from the
    // same failed attempt can later tell that another thread already handled it.
    let (active_account_generation, auto_switch_attempt_generation, state) =
        auto_switch_coordinator().account_snapshot(|| Ok(read_state(&paths)))?;
    let active_account_id = state
        .active_account_id
        .as_deref()
        .ok_or_else(|| "Select an official account before using the local proxy".to_string())?;
    let active_auth = read_json(&managed_auth_path(&paths, active_account_id))?;
    validate_auth(&active_auth)?;
    let credential_account_id = credential_account_id(&state, &active_auth, purpose)?;
    let auto_switch_eligible = credential_account_id == active_account_id;
    let mut auth = if auto_switch_eligible {
        active_auth
    } else {
        read_json(&managed_auth_path(&paths, &credential_account_id))?
    };
    validate_auth(&auth)?;
    let (_, _, _, auth_account_id) = account_fields(&auth)?;
    if auth_account_id != credential_account_id {
        return Err(format!(
            "Managed proxy credential does not match the selected account: selected={}, credential={}",
            credential_account_id, auth_account_id
        ));
    }
    let (email, _, account_id, id) = account_fields(&auth)?;
    let token_usage_account = TokenUsageAccount {
        account_id: id,
        account_email: email,
        active_account_generation,
        auto_switch_attempt_generation,
        auto_switch_eligible,
    };
    if matches!(purpose, OfficialCredentialPurpose::ImageGeneration)
        && is_agent_identity_auth(&auth)
    {
        return Err("Select a non-Agent Identity OAuth account for image generation".to_string());
    }
    if is_agent_identity_auth(&auth) {
        if agent_identity::ensure_task(client, &mut auth)? {
            write_managed_auth_if_changed(&paths, &credential_account_id, &auth)?;
        }
        return Ok(OfficialProxyCredentials {
            authentication: OfficialRequestAuthentication::AgentIdentity {
                active_account_id: credential_account_id,
                request_authentication: agent_identity::request_authentication(&auth)?,
                auth,
            },
            token_usage_account,
        });
    }
    if token_expiring(&auth) {
        refresh_tokens(client, &mut auth)?;
        // An old in-flight request must not overwrite Codex's watched auth.json after a
        // hot switch.  Refresh only the managed credential for the account it started with.
        write_managed_auth_if_changed(&paths, &credential_account_id, &auth)?;
    }
    let access_token = token_string(&auth, "access_token")
        .ok_or_else(|| "auth.json is missing tokens.access_token".to_string())?
        .to_string();
    Ok(OfficialProxyCredentials {
        authentication: OfficialRequestAuthentication::OAuth {
            access_token,
            chatgpt_account_id: account_id,
        },
        token_usage_account,
    })
}

fn credential_account_id(
    state: &ManagerStateFile,
    active_auth: &Value,
    purpose: OfficialCredentialPurpose,
) -> Result<String, String> {
    let active_account_id = state
        .active_account_id
        .as_deref()
        .ok_or_else(|| "Select an official account before using the local proxy".to_string())?;
    if !matches!(purpose, OfficialCredentialPurpose::ImageGeneration)
        || !is_agent_identity_auth(active_auth)
    {
        return Ok(active_account_id.to_string());
    }
    state
        .image_generation_account_id
        .clone()
        .ok_or_else(|| "Select a non-Agent Identity OAuth account for image generation".to_string())
}

fn invalid_agent_identity_task_response(
    authentication: &OfficialRequestAuthentication,
    payload: &UpstreamPayload,
) -> bool {
    let OfficialRequestAuthentication::AgentIdentity { .. } = authentication else {
        return false;
    };
    let UpstreamBody::Buffered(body) = &payload.body else {
        return false;
    };
    reqwest::StatusCode::from_u16(payload.status)
        .ok()
        .is_some_and(|status| {
            agent_identity::is_invalid_task_response(status, &String::from_utf8_lossy(body))
        })
}

fn refresh_agent_identity_task<R: Runtime>(
    authentication: &mut OfficialRequestAuthentication,
    app: &tauri::AppHandle<R>,
    client: &Client,
) -> Result<(), String> {
    let OfficialRequestAuthentication::AgentIdentity {
        active_account_id,
        auth,
        request_authentication,
    } = authentication
    else {
        return Ok(());
    };
    agent_identity::register_task(client, auth)?;
    write_managed_auth_if_changed(&resolve_paths(app)?, active_account_id, auth)?;
    *request_authentication = agent_identity::request_authentication(auth)?;
    Ok(())
}

fn apply_forward_headers(
    mut request: reqwest::blocking::RequestBuilder,
    headers: &[(String, String)],
    skip_auth: bool,
) -> reqwest::blocking::RequestBuilder {
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if should_skip_header(&lower, skip_auth) {
            continue;
        }
        request = request.header(name.as_str(), value.as_str());
    }
    request
}

fn should_skip_header(name: &str, skip_auth: bool) -> bool {
    matches!(
        name,
        "host"
            | "content-length"
            | "connection"
            | "transfer-encoding"
            | "accept-encoding"
            | "proxy-connection"
            | "x-forwarded-for"
            | "x-forwarded-host"
            | "x-forwarded-proto"
            | LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER
    ) || (skip_auth
        && matches!(
            name,
            "authorization"
                | "x-api-key"
                | "openai-api-key"
                | "api-key"
                | "chatgpt-account-id"
                | "cookie"
                | "proxy-authorization"
                | "originator"
        ))
}

fn http_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .timeout(UPSTREAM_TIMEOUT)
        .connect_timeout(UPSTREAM_CONNECT_TIMEOUT)
        .build()
        .map_err(|error| format!("Failed to create proxy HTTP client: {error}"))
}

fn reqwest_method(method: &Method) -> Result<reqwest::Method, String> {
    reqwest::Method::from_bytes(method.as_str().as_bytes())
        .map_err(|error| format!("Unsupported HTTP method {}: {error}", method.as_str()))
}

fn stream_response(response: ReqwestResponse) -> Result<UpstreamPayload, String> {
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let response_headers = forwarded_response_headers(response.headers());
    if !status_ok(status) {
        let body = response
            .bytes()
            .map_err(|error| format!("Failed to read upstream error response: {error}"))?;
        return Ok(UpstreamPayload {
            status,
            content_type,
            response_headers,
            body: UpstreamBody::Buffered(body.to_vec()),
            token_usage_account: None,
        });
    }
    Ok(UpstreamPayload {
        status,
        content_type,
        response_headers,
        body: UpstreamBody::Streaming(Box::new(response)),
        token_usage_account: None,
    })
}

fn forwarded_response_headers(headers: &reqwest::header::HeaderMap) -> Vec<(String, String)> {
    ["etag", "x-models-etag"]
        .into_iter()
        .filter_map(|name| {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect()
}

fn build_upstream_url(base_url: &str, endpoint: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let endpoint = endpoint.trim_start_matches('/');
    let endpoint = if base.ends_with("/v1") {
        endpoint.strip_prefix("v1/").unwrap_or(endpoint)
    } else {
        endpoint
    };

    let origin_only = base
        .split_once("://")
        .map(|(_, rest)| !rest.contains('/'))
        .unwrap_or_else(|| !base.contains('/'));
    let mut url = if base.ends_with("/v1") {
        format!("{base}/{endpoint}")
    } else if origin_only {
        format!("{base}/v1/{endpoint}")
    } else {
        format!("{base}/{endpoint}")
    };
    while url.contains("/v1/v1") {
        url = url.replace("/v1/v1", "/v1");
    }
    url
}

fn official_url(endpoint: &str) -> String {
    let endpoint = endpoint.trim_start_matches('/');
    let endpoint = endpoint.strip_prefix("v1/").unwrap_or(endpoint);
    format!("{}/{}", OFFICIAL_CODEX_BASE_URL, endpoint)
}

fn request_path(url: &str) -> &str {
    url.split_once('?').map_or(url, |(path, _)| path)
}

fn upstream_endpoint_for_codex_request(url: &str) -> String {
    let path = request_path(url);
    let normalized_path = normalized_responses_endpoint(path).unwrap_or(path);
    match url.split_once('?') {
        Some((_, query)) if !query.is_empty() => format!("{normalized_path}?{query}"),
        _ => normalized_path.to_string(),
    }
}

fn is_responses_endpoint(path: &str) -> bool {
    normalized_responses_endpoint(path).is_some()
}

fn normalized_responses_endpoint(path: &str) -> Option<&'static str> {
    match path {
        "/responses" | "/v1/responses" | "/v1/v1/responses" | "/codex/v1/responses" => {
            Some("/v1/responses")
        }
        "/responses/compact"
        | "/v1/responses/compact"
        | "/v1/v1/responses/compact"
        | "/codex/v1/responses/compact" => Some("/v1/responses/compact"),
        _ => None,
    }
}

fn is_image_generation_endpoint(path: &str) -> bool {
    matches!(
        path,
        "/images/generations"
            | "/v1/images/generations"
            | "/v1/v1/images/generations"
            | "/codex/v1/images/generations"
            | "/images/edits"
            | "/v1/images/edits"
            | "/v1/v1/images/edits"
            | "/codex/v1/images/edits"
    )
}

fn status_ok(status: u16) -> bool {
    (200..300).contains(&status)
}

fn is_event_stream(content_type: Option<&str>) -> bool {
    content_type
        .map(|value| value.to_ascii_lowercase().contains("text/event-stream"))
        .unwrap_or(false)
}

fn json_payload(status: u16, value: Value) -> UpstreamPayload {
    UpstreamPayload {
        status,
        content_type: Some("application/json; charset=utf-8".to_string()),
        response_headers: Vec::new(),
        body: UpstreamBody::Buffered(serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec())),
        token_usage_account: None,
    }
}

fn respond_payload(request: Request, payload: UpstreamPayload) {
    let UpstreamPayload {
        status,
        content_type,
        response_headers,
        body,
        ..
    } = payload;
    match body {
        UpstreamBody::Buffered(body) => {
            let mut response = Response::from_data(body).with_status_code(StatusCode(status));
            add_content_type(&mut response, content_type.as_deref());
            add_forwarded_response_headers(&mut response, &response_headers);
            let _ = request.respond(response);
        }
        UpstreamBody::Streaming(reader) => {
            let mut response = Response::new(StatusCode(status), Vec::new(), reader, None, None);
            add_content_type(&mut response, content_type.as_deref());
            add_forwarded_response_headers(&mut response, &response_headers);
            let _ = request.respond(response);
        }
    }
}

fn add_content_type<R: Read>(response: &mut Response<R>, content_type: Option<&str>) {
    if let Some(content_type) = content_type {
        if let Ok(header) = Header::from_bytes("Content-Type", content_type.as_bytes()) {
            response.add_header(header);
        }
    }
}

fn add_forwarded_response_headers<R: Read>(
    response: &mut Response<R>,
    headers: &[(String, String)],
) {
    for (name, value) in headers {
        if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }
}

fn respond_error(request: Request, status: u16, message: String) {
    respond_payload(
        request,
        json_payload(status, json!({ "error": { "message": message } })),
    );
}

#[cfg(test)]
fn responses_to_chat_completions(body: &Value) -> Value {
    let tool_context = build_codex_tool_context_from_request(body);
    responses_to_chat_completions_with_context(body, &tool_context)
}

fn responses_to_chat_completions_with_context(
    body: &Value,
    tool_context: &CodexToolContext,
) -> Value {
    let mut messages = Vec::new();
    if let Some(instructions) = body.get("instructions").and_then(value_to_text) {
        if !instructions.trim().is_empty() {
            messages.push(json!({ "role": "system", "content": instructions }));
        }
    }
    if let Some(input) = body.get("input") {
        append_input_messages(input, &mut messages, tool_context);
    }
    if messages.is_empty() {
        messages.push(json!({ "role": "user", "content": "" }));
    }

    let mut result = json!({
        "model": body.get("model").cloned().unwrap_or_else(|| json!("gpt-5-codex")),
        "messages": messages
    });
    for key in [
        "temperature",
        "top_p",
        "stream",
        "presence_penalty",
        "frequency_penalty",
        "parallel_tool_calls",
    ] {
        if let Some(value) = body.get(key) {
            result[key] = value.clone();
        }
    }
    if let Some(value) = body
        .get("max_output_tokens")
        .or_else(|| body.get("max_tokens"))
        .or_else(|| body.get("max_completion_tokens"))
    {
        result["max_tokens"] = value.clone();
    }
    if !tool_context.chat_tools().is_empty() {
        result["tools"] = Value::Array(tool_context.chat_tools().to_vec());
    }
    if let Some(tool_choice) = body.get("tool_choice") {
        result["tool_choice"] = responses_tool_choice_to_chat(tool_choice, tool_context);
    }
    if result.get("tools").is_none() {
        if let Some(object) = result.as_object_mut() {
            object.remove("tool_choice");
            object.remove("parallel_tool_calls");
        }
    }
    if result
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        result["stream_options"] = json!({ "include_usage": true });
    }
    result
}

fn append_input_messages(
    input: &Value,
    messages: &mut Vec<Value>,
    tool_context: &CodexToolContext,
) {
    let mut pending_tool_calls = Vec::new();
    match input {
        Value::String(text) => messages.push(json!({ "role": "user", "content": text })),
        Value::Array(items) => {
            for item in items {
                append_input_item_as_chat_message(
                    item,
                    messages,
                    &mut pending_tool_calls,
                    tool_context,
                );
            }
        }
        Value::Object(map) => {
            append_input_item_as_chat_message(
                &Value::Object(map.clone()),
                messages,
                &mut pending_tool_calls,
                tool_context,
            );
        }
        _ => {}
    }
    flush_pending_tool_calls(messages, &mut pending_tool_calls);
}

fn append_input_item_as_chat_message(
    item: &Value,
    messages: &mut Vec<Value>,
    pending_tool_calls: &mut Vec<Value>,
    tool_context: &CodexToolContext,
) {
    match item {
        Value::String(text) => {
            flush_pending_tool_calls(messages, pending_tool_calls);
            messages.push(json!({ "role": "user", "content": text }));
            return;
        }
        Value::Array(items) => {
            for nested in items {
                append_input_item_as_chat_message(
                    nested,
                    messages,
                    pending_tool_calls,
                    tool_context,
                );
            }
            return;
        }
        _ => {}
    }

    let item_type = item.get("type").and_then(Value::as_str);
    match item_type {
        Some("function_call") => {
            pending_tool_calls.push(responses_function_call_to_chat_tool_call(
                item,
                tool_context,
            ));
        }
        Some("custom_tool_call") => {
            pending_tool_calls.push(responses_custom_tool_call_to_chat_tool_call(item));
        }
        Some("tool_search_call") => {
            pending_tool_calls.push(responses_tool_search_call_to_chat_tool_call(item));
        }
        Some("function_call_output") => {
            flush_pending_tool_calls(messages, pending_tool_calls);
            append_tool_output_message(item, messages);
        }
        Some("custom_tool_call_output") | Some("tool_search_output") => {
            flush_pending_tool_calls(messages, pending_tool_calls);
            append_tool_output_message(item, messages);
        }
        _ => {
            flush_pending_tool_calls(messages, pending_tool_calls);
            append_regular_input_message(item, messages);
        }
    }
}

fn flush_pending_tool_calls(messages: &mut Vec<Value>, pending_tool_calls: &mut Vec<Value>) {
    if pending_tool_calls.is_empty() {
        return;
    }
    messages.push(json!({
        "role": "assistant",
        "content": Value::Null,
        "tool_calls": pending_tool_calls.drain(..).collect::<Vec<_>>()
    }));
}

fn append_tool_output_message(item: &Value, messages: &mut Vec<Value>) {
    let call_id = item.get("call_id").and_then(Value::as_str).unwrap_or("");
    if call_id.is_empty() {
        return;
    }
    let content = match item.get("output") {
        Some(output) => output_to_chat_tool_content(output),
        None => canonical_json_string(item),
    };
    messages.push(json!({
        "role": "tool",
        "tool_call_id": call_id,
        "content": content
    }));
}

fn append_regular_input_message(item: &Value, messages: &mut Vec<Value>) {
    if let Value::Object(map) = item {
        let role = map
            .get("role")
            .and_then(Value::as_str)
            .map(normalize_chat_role)
            .unwrap_or("user");
        if let Some(content) = map.get("content").and_then(value_to_text) {
            messages.push(json!({ "role": role, "content": content }));
        } else if matches!(
            map.get("type").and_then(Value::as_str),
            Some("input_text" | "output_text" | "text")
        ) {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                messages.push(json!({ "role": role, "content": text }));
            }
        }
    }
}

fn normalize_chat_role(role: &str) -> &'static str {
    match role {
        "assistant" => "assistant",
        "system" | "developer" => "system",
        "tool" => "tool",
        _ => "user",
    }
}

fn value_to_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts = items.iter().filter_map(value_to_text).collect::<Vec<_>>();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        Value::Object(map) => {
            for key in [
                "text",
                "input_text",
                "output_text",
                "content",
                "reasoning_content",
                "output",
            ] {
                if let Some(text) = map.get(key).and_then(value_to_text) {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

fn build_codex_tool_context_from_request(body: &Value) -> CodexToolContext {
    let mut context = CodexToolContext::default();
    if let Some(tools) = body.get("tools").and_then(Value::as_array) {
        for tool in tools {
            context.add_response_tool(tool);
        }
    }
    if let Some(input) = body.get("input") {
        collect_tool_search_output_tools(input, &mut context);
    }
    context
}

fn collect_tool_search_output_tools(value: &Value, context: &mut CodexToolContext) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_tool_search_output_tools(item, context);
            }
        }
        Value::Object(obj) => {
            if obj.get("type").and_then(Value::as_str) == Some("tool_search_output") {
                if let Some(tools) = obj.get("tools").and_then(Value::as_array) {
                    for tool in tools {
                        context.add_response_tool(tool);
                    }
                }
            }
            for nested in obj.values() {
                collect_tool_search_output_tools(nested, context);
            }
        }
        _ => {}
    }
}

fn responses_tool_name(tool: &Value) -> Option<String> {
    tool.get("function")
        .and_then(|function| function.get("name"))
        .or_else(|| tool.get("name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn responses_function_tool_to_chat_tool(tool: &Value, chat_name: &str) -> Option<Value> {
    if tool.get("type").and_then(Value::as_str) != Some("function") {
        return None;
    }
    if let Some(function) = tool.get("function") {
        let mut chat_tool = json!({
            "type": "function",
            "function": function.clone()
        });
        if let Some(obj) = chat_tool.get_mut("function").and_then(Value::as_object_mut) {
            obj.insert("name".to_string(), json!(chat_name));
            if let Some(strict) = tool.get("strict").cloned() {
                obj.entry("strict".to_string()).or_insert(strict);
            }
        }
        return Some(chat_tool);
    }

    let mut function = json!({
        "name": chat_name,
        "description": tool.get("description").cloned().unwrap_or_else(|| json!("")),
        "parameters": tool
            .get("parameters")
            .or_else(|| tool.get("input_schema"))
            .cloned()
            .unwrap_or_else(|| json!({ "type": "object" }))
    });
    if let Some(strict) = tool.get("strict") {
        function["strict"] = strict.clone();
    }
    Some(json!({
        "type": "function",
        "function": function
    }))
}

fn responses_custom_tool_description(tool: &Value) -> String {
    let mut description = tool
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if !description.is_empty() {
        description.push_str("\n\n");
    }
    description.push_str(CUSTOM_TOOL_PRESERVED_METADATA_HEADING);
    description.push_str("\n```json\n");
    description.push_str(&canonical_json_string(tool));
    description.push_str("\n```");
    description
}

fn responses_function_call_to_chat_tool_call(
    item: &Value,
    tool_context: &CodexToolContext,
) -> Value {
    let call_id = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let name = item.get("name").and_then(Value::as_str).unwrap_or("");
    let namespace = item.get("namespace").and_then(Value::as_str);
    let chat_name = tool_context.chat_name_for_response_function(name, namespace);
    json!({
        "id": call_id,
        "type": "function",
        "function": {
            "name": chat_name,
            "arguments": canonicalize_tool_arguments(item.get("arguments"))
        }
    })
}

fn responses_custom_tool_call_to_chat_tool_call(item: &Value) -> Value {
    let call_id = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let name = item.get("name").and_then(Value::as_str).unwrap_or("");
    let input = item.get("input").cloned().unwrap_or_else(|| json!(""));
    json!({
        "id": call_id,
        "type": "function",
        "function": {
            "name": name,
            "arguments": canonical_json_string(&json!({ CUSTOM_TOOL_INPUT_FIELD: input }))
        }
    })
}

fn responses_tool_search_call_to_chat_tool_call(item: &Value) -> Value {
    let call_id = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    json!({
        "id": call_id,
        "type": "function",
        "function": {
            "name": TOOL_SEARCH_PROXY_NAME,
            "arguments": item
                .get("arguments")
                .map(canonical_json_string)
                .unwrap_or_else(|| "{}".to_string())
        }
    })
}

fn responses_tool_choice_to_chat(tool_choice: &Value, tool_context: &CodexToolContext) -> Value {
    match tool_choice {
        Value::Object(obj) if obj.get("type").and_then(Value::as_str) == Some("function") => {
            let name = obj.get("name").and_then(Value::as_str).unwrap_or("");
            let namespace = obj.get("namespace").and_then(Value::as_str);
            let chat_name = tool_context.chat_name_for_response_function(name, namespace);
            json!({
                "type": "function",
                "function": { "name": chat_name }
            })
        }
        Value::Object(obj) if obj.get("type").and_then(Value::as_str) == Some("tool_search") => {
            json!({
                "type": "function",
                "function": { "name": TOOL_SEARCH_PROXY_NAME }
            })
        }
        Value::Object(obj) if obj.get("type").and_then(Value::as_str) == Some("custom") => {
            let name = obj.get("name").and_then(Value::as_str).unwrap_or("");
            json!({
                "type": "function",
                "function": { "name": name }
            })
        }
        _ => tool_choice.clone(),
    }
}

fn chat_to_responses_json(chat: &Value, tool_context: &CodexToolContext) -> Value {
    let id = chat
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(response_id);
    let model = chat
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let message = chat
        .pointer("/choices/0/message")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let content = message
        .get("content")
        .and_then(value_to_text)
        .unwrap_or_default();
    let mut output = Vec::new();
    if !content.is_empty() {
        output.push(json!({
            "id": format!("msg_{}", id),
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": content, "annotations": [] }]
        }));
    }
    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        for (index, call) in tool_calls.iter().enumerate() {
            if call
                .pointer("/function/name")
                .and_then(Value::as_str)
                .is_none()
            {
                continue;
            }
            output.push(chat_tool_call_to_response_item(call, index, tool_context));
        }
    }
    json!({
        "id": id,
        "object": "response",
        "created_at": unix_now(),
        "status": "completed",
        "model": model,
        "output": output,
        "usage": chat.get("usage").cloned().unwrap_or_else(|| json!(null))
    })
}

fn chat_tool_call_to_response_item(
    tool_call: &Value,
    index: usize,
    tool_context: &CodexToolContext,
) -> Value {
    let call_id = tool_call
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("call_{index}"));
    let function = tool_call.get("function").unwrap_or(&Value::Null);
    let name = function.get("name").and_then(Value::as_str).unwrap_or("");
    let arguments = canonicalize_tool_arguments(function.get("arguments"));
    let item_id = response_tool_call_item_id_from_chat_name(&call_id, name, tool_context);
    response_tool_call_item_from_chat_name(
        &item_id,
        "completed",
        &call_id,
        name,
        &arguments,
        tool_context,
    )
}

fn response_tool_call_item_id_from_chat_name(
    call_id: &str,
    chat_name: &str,
    tool_context: &CodexToolContext,
) -> String {
    if tool_context.is_custom_tool_chat_name(chat_name) {
        format!("ctc_{call_id}")
    } else {
        format!("fc_{call_id}")
    }
}

fn response_tool_call_item_from_chat_name(
    item_id: &str,
    status: &str,
    call_id: &str,
    chat_name: &str,
    arguments: &str,
    tool_context: &CodexToolContext,
) -> Value {
    match tool_context.lookup_chat_name(chat_name) {
        Some(spec) if spec.kind == CodexToolKind::ToolSearch => {
            response_tool_search_call_item(call_id, status, arguments)
        }
        Some(spec) if spec.kind == CodexToolKind::Custom => {
            response_custom_tool_call_item(item_id, status, call_id, &spec.name, arguments)
        }
        Some(spec) => response_function_call_item(
            item_id,
            status,
            call_id,
            &spec.name,
            spec.namespace.as_deref(),
            arguments,
        ),
        None => response_function_call_item(item_id, status, call_id, chat_name, None, arguments),
    }
}

fn response_tool_search_call_item(call_id: &str, status: &str, arguments: &str) -> Value {
    json!({
        "type": "tool_search_call",
        "call_id": call_id,
        "status": status,
        "execution": "client",
        "arguments": parse_tool_arguments_object(arguments)
    })
}

fn response_custom_tool_call_item(
    item_id: &str,
    status: &str,
    call_id: &str,
    name: &str,
    arguments: &str,
) -> Value {
    json!({
        "id": item_id,
        "type": "custom_tool_call",
        "status": status,
        "call_id": call_id,
        "name": name,
        "input": custom_tool_input_from_chat_arguments(arguments)
    })
}

fn response_function_call_item(
    item_id: &str,
    status: &str,
    call_id: &str,
    name: &str,
    namespace: Option<&str>,
    arguments: &str,
) -> Value {
    let mut item = json!({
        "id": item_id,
        "type": "function_call",
        "status": status,
        "call_id": call_id,
        "name": name,
        "arguments": arguments
    });
    if let Some(namespace) = namespace.filter(|value| !value.is_empty()) {
        item["namespace"] = json!(namespace);
    }
    item
}

fn parse_tool_arguments_object(arguments: &str) -> Value {
    if arguments.trim().is_empty() {
        return json!({});
    }
    serde_json::from_str::<Value>(arguments)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({ "query": arguments }))
}

fn custom_tool_input_from_chat_arguments(arguments: &str) -> String {
    if arguments.trim().is_empty() {
        return String::new();
    }
    match serde_json::from_str::<Value>(arguments) {
        Ok(Value::Object(obj)) => obj
            .get(CUSTOM_TOOL_INPUT_FIELD)
            .and_then(Value::as_str)
            .unwrap_or(arguments)
            .to_string(),
        _ => arguments.to_string(),
    }
}

fn canonicalize_tool_arguments(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return "{}".to_string();
    };
    match value {
        Value::String(text) => canonicalize_tool_arguments_str(text),
        other => canonical_json_string(other),
    }
}

fn canonicalize_tool_arguments_str(arguments: &str) -> String {
    let trimmed = arguments.trim();
    if trimmed.is_empty() {
        return "{}".to_string();
    }
    serde_json::from_str::<Value>(trimmed)
        .ok()
        .map(|value| canonical_json_string(&value))
        .unwrap_or_else(|| arguments.to_string())
}

fn canonical_json_string(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

fn output_to_chat_tool_content(value: &Value) -> String {
    match value {
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .map(|parsed| canonical_json_string(&parsed))
            .unwrap_or_else(|| text.clone()),
        other => canonical_json_string(other),
    }
}

fn flatten_namespace_tool_name(namespace: &str, name: &str) -> String {
    let full_name = format!("{namespace}__{name}");
    if full_name.len() <= CHAT_TOOL_NAME_MAX_LEN {
        return full_name;
    }

    let mut hasher = Sha256::new();
    hasher.update(full_name.as_bytes());
    let digest = hasher.finalize();
    let hash = digest[..5]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let suffix = format!("__{hash}");
    let prefix_len = CHAT_TOOL_NAME_MAX_LEN.saturating_sub(suffix.len());
    let mut prefix = String::new();
    for ch in full_name.chars() {
        if prefix.len() + ch.len_utf8() > prefix_len {
            break;
        }
        prefix.push(ch);
    }
    format!("{prefix}{suffix}")
}

#[derive(Debug, Default)]
struct StreamingToolCall {
    output_index: Option<usize>,
    item_id: String,
    call_id: String,
    name: String,
    arguments: String,
    added: bool,
    done: bool,
}

struct ChatSseReader<R> {
    upstream: R,
    model: String,
    response_id: String,
    message_id: String,
    pending: Vec<u8>,
    pending_offset: usize,
    data_lines: Vec<String>,
    text: String,
    tools: BTreeMap<usize, StreamingToolCall>,
    tool_context: CodexToolContext,
    usage: Option<Value>,
    completed: bool,
}

impl<R: BufRead> ChatSseReader<R> {
    fn new(upstream: R, model: String, tool_context: CodexToolContext) -> Self {
        let response_id = response_id();
        let message_id = format!("msg_{response_id}");
        let pending = response_start_sse(&response_id, &message_id, &model).into_bytes();
        Self {
            upstream,
            model,
            response_id: response_id.clone(),
            message_id: message_id.clone(),
            pending,
            pending_offset: 0,
            data_lines: Vec::new(),
            text: String::new(),
            tools: BTreeMap::new(),
            tool_context,
            usage: None,
            completed: false,
        }
    }

    fn has_pending(&self) -> bool {
        self.pending_offset < self.pending.len()
    }

    fn drain_pending(&mut self, target: &mut [u8]) -> usize {
        if target.is_empty() || !self.has_pending() {
            return 0;
        }
        let count = target
            .len()
            .min(self.pending.len().saturating_sub(self.pending_offset));
        target[..count]
            .copy_from_slice(&self.pending[self.pending_offset..self.pending_offset + count]);
        self.pending_offset += count;
        if !self.has_pending() {
            self.pending.clear();
            self.pending_offset = 0;
        }
        count
    }

    fn push_pending(&mut self, value: String) {
        if self.pending_offset > 0 {
            self.pending.drain(0..self.pending_offset);
            self.pending_offset = 0;
        }
        self.pending.extend_from_slice(value.as_bytes());
    }

    fn process_line(&mut self, line: &str) {
        let line = line.trim_end_matches(&['\r', '\n'][..]);
        if line.is_empty() {
            self.process_event_block();
            return;
        }
        if let Some(data) = line.trim_start().strip_prefix("data:") {
            self.data_lines.push(data.trim_start().to_string());
        }
    }

    fn process_event_block(&mut self) {
        if self.data_lines.is_empty() || self.completed {
            self.data_lines.clear();
            return;
        }
        let data = self.data_lines.join("\n");
        self.data_lines.clear();
        if data.trim() == "[DONE]" {
            self.finish();
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(&data) else {
            return;
        };
        if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(usage.clone());
        }
        if let Some(delta) = chat_stream_delta_text(&value) {
            if !delta.is_empty() {
                self.text.push_str(delta);
                self.push_pending(response_text_delta_sse(&self.message_id, delta));
            }
        }
        if let Some(tool_calls) = value
            .pointer("/choices/0/delta/tool_calls")
            .and_then(Value::as_array)
        {
            for tool_call in tool_calls {
                let events = self.process_tool_call_delta(tool_call);
                if !events.is_empty() {
                    self.push_pending(events);
                }
            }
        }
    }

    fn finish(&mut self) {
        if self.completed {
            return;
        }
        let (tool_events, tool_items) = self.finalize_tools();
        self.push_pending(response_done_sse(
            &self.response_id,
            &self.message_id,
            &self.model,
            &self.text,
            &tool_events,
            tool_items,
            self.usage.clone(),
        ));
        self.completed = true;
    }

    fn fail(&mut self, message: String) {
        if self.completed {
            return;
        }
        self.push_pending(response_failed_sse(
            &self.response_id,
            &self.model,
            &message,
        ));
        self.completed = true;
    }

    fn process_tool_call_delta(&mut self, tool_call: &Value) -> String {
        let index = tool_call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        let id_delta = tool_call.get("id").and_then(Value::as_str);
        let function = tool_call.get("function").unwrap_or(&Value::Null);
        let name_delta = function.get("name").and_then(Value::as_str);
        let args_delta = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("");

        let mut should_add = false;
        let mut output_index = None;
        let mut item_id = String::new();
        let current_name: String;

        {
            let state = self.tools.entry(index).or_default();
            if let Some(id) = id_delta.filter(|value| !value.is_empty()) {
                if !state.added {
                    state.call_id = id.to_string();
                }
            }
            if let Some(name) = name_delta.filter(|value| !value.is_empty()) {
                state.name = name.to_string();
            }
            if !args_delta.is_empty() {
                state.arguments.push_str(args_delta);
            }
            if !state.added && !state.name.is_empty() {
                should_add = true;
            } else if state.added {
                output_index = state.output_index;
                item_id = state.item_id.clone();
            }
            current_name = state.name.clone();
        }

        let is_custom_tool = self.tool_context.is_custom_tool_chat_name(&current_name);
        let mut output = String::new();

        if should_add {
            let output_index = index + 1;
            let Some(state) = self.tools.get_mut(&index) else {
                return output;
            };
            if state.call_id.is_empty() {
                state.call_id = format!("call_{index}");
            }
            state.output_index = Some(output_index);
            state.item_id = response_tool_call_item_id_from_chat_name(
                &state.call_id,
                &state.name,
                &self.tool_context,
            );
            state.added = true;
            let item = response_tool_call_item_from_chat_name(
                &state.item_id,
                "in_progress",
                &state.call_id,
                &state.name,
                "",
                &self.tool_context,
            );
            push_sse(
                &mut output,
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": item
                }),
            );
            if !state.arguments.is_empty() && !is_custom_tool {
                push_sse(
                    &mut output,
                    "response.function_call_arguments.delta",
                    json!({
                        "type": "response.function_call_arguments.delta",
                        "item_id": state.item_id,
                        "output_index": output_index,
                        "delta": state.arguments
                    }),
                );
            }
        } else if !args_delta.is_empty() && !is_custom_tool {
            if let Some(output_index) = output_index {
                push_sse(
                    &mut output,
                    "response.function_call_arguments.delta",
                    json!({
                        "type": "response.function_call_arguments.delta",
                        "item_id": item_id,
                        "output_index": output_index,
                        "delta": args_delta
                    }),
                );
            }
        }

        output
    }

    fn finalize_tools(&mut self) -> (String, Vec<Value>) {
        let mut output = String::new();
        let mut items = Vec::new();
        let keys = self.tools.keys().copied().collect::<Vec<_>>();

        for key in keys {
            if self.tools.get(&key).map(|state| state.done).unwrap_or(true) {
                continue;
            }
            if self
                .tools
                .get(&key)
                .map(|state| state.name.is_empty())
                .unwrap_or(true)
            {
                if let Some(state) = self.tools.get_mut(&key) {
                    state.done = true;
                }
                continue;
            }

            let should_add = self.tools.get(&key).is_some_and(|state| !state.added);
            if should_add {
                let output_index = key + 1;
                let Some(state) = self.tools.get_mut(&key) else {
                    continue;
                };
                if state.call_id.is_empty() {
                    state.call_id = format!("call_{key}");
                }
                state.output_index = Some(output_index);
                state.item_id = response_tool_call_item_id_from_chat_name(
                    &state.call_id,
                    &state.name,
                    &self.tool_context,
                );
                state.added = true;
                let item = response_tool_call_item_from_chat_name(
                    &state.item_id,
                    "in_progress",
                    &state.call_id,
                    &state.name,
                    "",
                    &self.tool_context,
                );
                push_sse(
                    &mut output,
                    "response.output_item.added",
                    json!({
                        "type": "response.output_item.added",
                        "output_index": output_index,
                        "item": item
                    }),
                );
            }

            let Some(state) = self.tools.get_mut(&key) else {
                continue;
            };
            let output_index = state.output_index.unwrap_or(key + 1);
            let arguments = canonicalize_tool_arguments_str(&state.arguments);
            let is_custom_tool = self.tool_context.is_custom_tool_chat_name(&state.name);
            let item = response_tool_call_item_from_chat_name(
                &state.item_id,
                "completed",
                &state.call_id,
                &state.name,
                &arguments,
                &self.tool_context,
            );
            state.done = true;
            items.push(item.clone());

            if is_custom_tool {
                let input = custom_tool_input_from_chat_arguments(&arguments);
                if !input.is_empty() {
                    push_sse(
                        &mut output,
                        "response.custom_tool_call_input.delta",
                        json!({
                            "type": "response.custom_tool_call_input.delta",
                            "item_id": state.item_id,
                            "output_index": output_index,
                            "delta": input
                        }),
                    );
                }
                push_sse(
                    &mut output,
                    "response.custom_tool_call_input.done",
                    json!({
                        "type": "response.custom_tool_call_input.done",
                        "item_id": state.item_id,
                        "output_index": output_index,
                        "input": input
                    }),
                );
            } else {
                push_sse(
                    &mut output,
                    "response.function_call_arguments.done",
                    json!({
                        "type": "response.function_call_arguments.done",
                        "item_id": state.item_id,
                        "output_index": output_index,
                        "arguments": arguments
                    }),
                );
            }
            push_sse(
                &mut output,
                "response.output_item.done",
                json!({
                    "type": "response.output_item.done",
                    "output_index": output_index,
                    "item": item
                }),
            );
        }

        (output, items)
    }
}

impl<R: BufRead> Read for ChatSseReader<R> {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        if target.is_empty() {
            return Ok(0);
        }
        let copied = self.drain_pending(target);
        if copied > 0 {
            return Ok(copied);
        }

        while !self.completed && !self.has_pending() {
            let mut line = String::new();
            match self.upstream.read_line(&mut line) {
                Ok(0) => {
                    self.process_event_block();
                    self.finish();
                }
                Ok(_) => self.process_line(&line),
                Err(error) => self.fail(format!("Chat bridge upstream stream failed: {error}")),
            }
        }
        Ok(self.drain_pending(target))
    }
}

#[cfg(test)]
fn chat_sse_to_responses_sse(sse: &str, model: &str) -> String {
    let response_id = response_id();
    let message_id = format!("msg_{response_id}");
    let mut output = response_start_sse(&response_id, &message_id, model);
    let mut text = String::new();
    for block in sse.split("\n\n") {
        for line in block.lines() {
            let Some(data) = line.trim_start().strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(delta) = chat_stream_delta_text(&value) {
                text.push_str(delta);
                output.push_str(&response_text_delta_sse(&message_id, delta));
            }
        }
    }

    output.push_str(&response_done_sse(
        &response_id,
        &message_id,
        model,
        &text,
        "",
        Vec::new(),
        None,
    ));
    output
}

fn chat_stream_delta_text(value: &Value) -> Option<&str> {
    value
        .pointer("/choices/0/delta/content")
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .pointer("/choices/0/delta/reasoning_content")
                .and_then(Value::as_str)
        })
}

fn response_start_sse(response_id: &str, message_id: &str, model: &str) -> String {
    let mut output = String::new();
    push_sse(
        &mut output,
        "response.created",
        json!({
            "type": "response.created",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": unix_now(),
                "status": "in_progress",
                "model": model,
                "output": []
            }
        }),
    );
    push_sse(
        &mut output,
        "response.output_item.added",
        json!({
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {
                "id": message_id,
                "type": "message",
                "status": "in_progress",
                "role": "assistant",
                "content": []
            }
        }),
    );
    push_sse(
        &mut output,
        "response.content_part.added",
        json!({
            "type": "response.content_part.added",
            "item_id": message_id,
            "output_index": 0,
            "content_index": 0,
            "part": { "type": "output_text", "text": "" }
        }),
    );
    output
}

fn response_text_delta_sse(message_id: &str, delta: &str) -> String {
    let mut output = String::new();
    push_sse(
        &mut output,
        "response.output_text.delta",
        json!({
            "type": "response.output_text.delta",
            "item_id": message_id,
            "output_index": 0,
            "content_index": 0,
            "delta": delta
        }),
    );
    output
}

fn response_done_sse(
    response_id: &str,
    message_id: &str,
    model: &str,
    text: &str,
    tool_events: &str,
    tool_items: Vec<Value>,
    usage: Option<Value>,
) -> String {
    let mut output = String::new();
    let message_item = json!({
        "id": message_id,
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{ "type": "output_text", "text": text, "annotations": [] }]
    });
    push_sse(
        &mut output,
        "response.output_text.done",
        json!({
            "type": "response.output_text.done",
            "item_id": message_id,
            "output_index": 0,
            "content_index": 0,
            "text": text
        }),
    );
    push_sse(
        &mut output,
        "response.content_part.done",
        json!({
            "type": "response.content_part.done",
            "item_id": message_id,
            "output_index": 0,
            "content_index": 0,
            "part": { "type": "output_text", "text": text }
        }),
    );
    push_sse(
        &mut output,
        "response.output_item.done",
        json!({
            "type": "response.output_item.done",
            "output_index": 0,
            "item": message_item
        }),
    );
    output.push_str(tool_events);
    let mut response_output = vec![message_item];
    response_output.extend(tool_items);
    let mut response = json!({
        "id": response_id,
        "object": "response",
        "created_at": unix_now(),
        "status": "completed",
        "model": model,
        "output": response_output
    });
    if let Some(usage) = usage {
        response["usage"] = usage;
    }
    push_sse(
        &mut output,
        "response.completed",
        json!({
            "type": "response.completed",
            "response": response
        }),
    );
    output.push_str("data: [DONE]\n\n");
    output
}

fn response_failed_sse(response_id: &str, model: &str, message: &str) -> String {
    let mut output = String::new();
    push_sse(
        &mut output,
        "response.failed",
        json!({
            "type": "response.failed",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": unix_now(),
                "status": "failed",
                "model": model,
                "error": { "message": message }
            }
        }),
    );
    output.push_str("data: [DONE]\n\n");
    output
}

fn push_sse(output: &mut String, event: &str, value: Value) {
    output.push_str("event: ");
    output.push_str(event);
    output.push_str("\n");
    output.push_str("data: ");
    output.push_str(&value.to_string());
    output.push_str("\n\n");
}

fn response_id() -> String {
    format!("resp_{}", unix_now())
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UsageWindow;
    use serde_json::json;
    use std::io::{Cursor, Read};
    use std::sync::{
        atomic::{AtomicUsize, Ordering as AtomicOrdering},
        mpsc,
    };

    #[test]
    fn proxy_bind_host_uses_loopback_unless_lan_listening_is_enabled() {
        assert_eq!(proxy_bind_host(false), LOCAL_PROXY_HOST);
        assert_eq!(proxy_bind_host(true), LOCAL_PROXY_LAN_HOST);
    }

    #[test]
    fn proxy_cannot_stop_while_an_agent_identity_is_selected() {
        let error = ensure_proxy_can_stop_with_auth(&json!({
            "auth_mode": "agentIdentity",
            "agent_identity": {}
        }))
        .unwrap_err();

        assert!(error.contains("先在代理模式中切换"));
        ensure_proxy_can_stop_with_auth(&json!({ "auth_mode": "chatgpt" })).unwrap();
    }

    fn account_with_usage(id: &str, primary: f64, secondary: f64) -> AccountSummary {
        AccountSummary {
            id: id.to_string(),
            email: format!("{id}@example.com"),
            note: String::new(),
            expires_at: String::new(),
            plan: String::new(),
            account_id: None,
            active: id == "current",
            auto_switch_enabled: true,
            auto_switch_priority: 0,
            local_proxy_compatible: true,
            direct_switch_compatible: true,
            agent_identity: false,
            usage: UsageSummary {
                primary: Some(UsageWindow {
                    used_percent: 100.0 - primary,
                    remaining_percent: primary,
                    resets_at: None,
                    window_minutes: Some(300),
                }),
                secondary: Some(UsageWindow {
                    used_percent: 100.0 - secondary,
                    remaining_percent: secondary,
                    resets_at: None,
                    window_minutes: Some(10_080),
                }),
                fetched_at: None,
                error: None,
            },
        }
    }

    fn official_payload(status: u16, active_account_generation: u64) -> UpstreamPayload {
        UpstreamPayload {
            status,
            content_type: Some("application/json".to_string()),
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(Vec::new()),
            token_usage_account: Some(TokenUsageAccount {
                account_id: "current".to_string(),
                account_email: "current@example.com".to_string(),
                active_account_generation,
                auto_switch_attempt_generation: 0,
                auto_switch_eligible: true,
            }),
        }
    }

    #[test]
    fn quota_switch_prefers_the_account_with_lowest_remaining_primary_quota() {
        let accounts = vec![
            account_with_usage("current", 0.0, 80.0),
            account_with_usage("lowest-remaining", 5.0, 1.0),
            account_with_usage("more-remaining", 72.0, 99.0),
            account_with_usage("exhausted", 0.0, 99.0),
        ];

        let selected =
            account_with_lowest_remaining_primary_quota(&accounts, "current", false).unwrap();

        assert_eq!(selected.id, "lowest-remaining");
    }

    #[test]
    fn quota_switch_ignores_accounts_disabled_for_automatic_switching() {
        let mut disabled = account_with_usage("disabled", 5.0, 1.0);
        disabled.auto_switch_enabled = false;
        let accounts = vec![
            account_with_usage("current", 0.0, 80.0),
            disabled,
            account_with_usage("enabled", 72.0, 99.0),
        ];

        let selected =
            account_with_lowest_remaining_primary_quota(&accounts, "current", false).unwrap();

        assert_eq!(selected.id, "enabled");
    }

    #[test]
    fn quota_switch_prefers_lower_custom_priority_before_usage() {
        let mut lower_priority = account_with_usage("lower-priority", 72.0, 99.0);
        lower_priority.auto_switch_priority = -1;
        let mut higher_priority = account_with_usage("higher-priority", 5.0, 1.0);
        higher_priority.auto_switch_priority = 2;
        let accounts = vec![
            account_with_usage("current", 0.0, 80.0),
            higher_priority,
            lower_priority,
        ];

        let selected =
            account_with_lowest_remaining_primary_quota(&accounts, "current", true).unwrap();

        assert_eq!(selected.id, "lower-priority");
    }

    #[test]
    fn quota_switch_uses_existing_usage_rule_when_custom_priorities_match() {
        let mut lower_usage = account_with_usage("lower-usage", 5.0, 1.0);
        lower_usage.auto_switch_priority = 3;
        let mut higher_usage = account_with_usage("higher-usage", 72.0, 99.0);
        higher_usage.auto_switch_priority = 3;
        let accounts = vec![
            account_with_usage("current", 0.0, 80.0),
            higher_usage,
            lower_usage,
        ];

        let selected =
            account_with_lowest_remaining_primary_quota(&accounts, "current", true).unwrap();

        assert_eq!(selected.id, "lower-usage");
    }

    #[test]
    fn quota_exhaustion_detection_ignores_unrelated_forbidden_responses() {
        let quota_payload = UpstreamPayload {
            status: 403,
            content_type: Some("application/json".to_string()),
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(br#"{"error":{"code":"insufficient_quota"}}"#.to_vec()),
            token_usage_account: None,
        };
        let forbidden_payload = UpstreamPayload {
            status: 403,
            content_type: Some("application/json".to_string()),
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(br#"{"error":{"code":"forbidden"}}"#.to_vec()),
            token_usage_account: None,
        };

        assert!(is_official_quota_exhaustion(&quota_payload));
        assert!(!is_official_quota_exhaustion(&forbidden_payload));
    }

    #[test]
    fn concurrent_quota_responses_share_one_switch_and_all_retry() {
        const REQUEST_COUNT: usize = 8;

        let coordinator = Arc::new(AutoSwitchCoordinator::default());
        let observed_generation = coordinator.active_account_generation();
        let switch_count = Arc::new(AtomicUsize::new(0));
        let retry_count = Arc::new(AtomicUsize::new(0));
        let (switch_started_tx, switch_started_rx) = mpsc::channel();
        let (finish_switch_tx, finish_switch_rx) = mpsc::channel();
        let mut handles = vec![{
            let coordinator = coordinator.clone();
            let switch_count = switch_count.clone();
            let retry_count = retry_count.clone();
            thread::spawn(move || {
                retry_official_request_after_quota_switch_with(
                    Ok(official_payload(429, observed_generation)),
                    |generation, attempt_generation, failed_account_id| {
                        coordinator.switch_or_wait(
                            generation,
                            attempt_generation,
                            failed_account_id,
                            || {
                                switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                                switch_started_tx.send(()).unwrap();
                                finish_switch_rx
                                    .recv_timeout(Duration::from_secs(5))
                                    .unwrap();
                                Ok(AutoSwitchAttempt::Switched)
                            },
                        )
                    },
                    || {
                        retry_count.fetch_add(1, AtomicOrdering::SeqCst);
                        Ok(official_payload(200, observed_generation + 1))
                    },
                )
                .unwrap()
                .status
            })
        }];

        switch_started_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        let (waiter_entered_tx, waiter_entered_rx) = mpsc::channel();
        for _ in 1..REQUEST_COUNT {
            let coordinator = coordinator.clone();
            let switch_count = switch_count.clone();
            let retry_count = retry_count.clone();
            let waiter_entered_tx = waiter_entered_tx.clone();
            handles.push(thread::spawn(move || {
                retry_official_request_after_quota_switch_with(
                    Ok(official_payload(429, observed_generation)),
                    |generation, attempt_generation, failed_account_id| {
                        coordinator.switch_or_wait_with_waiter_hook(
                            generation,
                            attempt_generation,
                            failed_account_id,
                            || {
                                switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                                Ok(AutoSwitchAttempt::Switched)
                            },
                            || waiter_entered_tx.send(()).unwrap(),
                        )
                    },
                    || {
                        retry_count.fetch_add(1, AtomicOrdering::SeqCst);
                        Ok(official_payload(200, observed_generation + 1))
                    },
                )
                .unwrap()
                .status
            }));
        }

        for _ in 1..REQUEST_COUNT {
            waiter_entered_rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }
        finish_switch_tx.send(()).unwrap();

        let statuses = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert!(statuses.iter().all(|status| *status == 200));
        assert_eq!(switch_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(retry_count.load(AtomicOrdering::SeqCst), REQUEST_COUNT);
        assert_eq!(coordinator.active_account_generation(), 1);
    }

    #[test]
    fn quota_waiter_does_not_take_over_when_leader_does_not_switch() {
        let coordinator = Arc::new(AutoSwitchCoordinator::default());
        let observed_generation = coordinator.active_account_generation();
        let follower_switch_count = Arc::new(AtomicUsize::new(0));
        let (leader_started_tx, leader_started_rx) = mpsc::channel();
        let (finish_leader_tx, finish_leader_rx) = mpsc::channel();

        let leader = {
            let coordinator = coordinator.clone();
            thread::spawn(move || {
                coordinator.switch_or_wait(observed_generation, 0, "current", || {
                    leader_started_tx.send(()).unwrap();
                    finish_leader_rx
                        .recv_timeout(Duration::from_secs(5))
                        .unwrap();
                    Ok(AutoSwitchAttempt::Unchanged)
                })
            })
        };
        leader_started_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap();

        let (waiter_entered_tx, waiter_entered_rx) = mpsc::channel();
        let follower = {
            let coordinator = coordinator.clone();
            let follower_switch_count = follower_switch_count.clone();
            thread::spawn(move || {
                coordinator.switch_or_wait_with_waiter_hook(
                    observed_generation,
                    0,
                    "current",
                    || {
                        follower_switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                        Ok(AutoSwitchAttempt::Switched)
                    },
                    || waiter_entered_tx.send(()).unwrap(),
                )
            })
        };
        waiter_entered_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        finish_leader_tx.send(()).unwrap();

        assert!(!leader.join().unwrap().unwrap());
        assert!(!follower.join().unwrap().unwrap());
        assert_eq!(follower_switch_count.load(AtomicOrdering::SeqCst), 0);
        assert_eq!(coordinator.active_account_generation(), 0);
    }

    #[test]
    fn already_changed_account_does_not_advance_automatic_generation() {
        let coordinator = AutoSwitchCoordinator::default();
        let observed_generation = coordinator.active_account_generation();

        assert!(coordinator
            .switch_or_wait(observed_generation, 0, "old", || {
                Ok(AutoSwitchAttempt::AlreadyChanged)
            })
            .unwrap());
        assert_eq!(coordinator.active_account_generation(), observed_generation);

        let switch_count = AtomicUsize::new(0);
        assert!(coordinator
            .switch_or_wait(observed_generation, 0, "current", || {
                switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                Ok(AutoSwitchAttempt::Switched)
            })
            .unwrap());
        assert_eq!(switch_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(coordinator.active_account_generation(), 1);
    }

    #[test]
    fn poisoned_switch_coordinator_keeps_official_snapshots_available() {
        let coordinator = Arc::new(AutoSwitchCoordinator::default());
        let poisoning_coordinator = coordinator.clone();
        assert!(thread::spawn(move || {
            let _state = poisoning_coordinator.state.lock().unwrap();
            panic!("poison automatic switch state for recovery test");
        })
        .join()
        .is_err());

        let (generation, attempt_generation, account_id) = coordinator
            .account_snapshot(|| Ok::<_, String>("current".to_string()))
            .unwrap();
        assert_eq!(generation, 1);
        assert_eq!(attempt_generation, 1);
        assert_eq!(account_id, "current");

        assert!(coordinator
            .switch_or_wait(generation, attempt_generation, &account_id, || {
                Ok(AutoSwitchAttempt::Switched)
            })
            .unwrap());
        assert_eq!(coordinator.active_account_generation(), 2);
    }

    #[test]
    fn delayed_quota_response_uses_its_original_generation() {
        let coordinator = AutoSwitchCoordinator::default();
        let observed_generation = coordinator.active_account_generation();
        assert!(coordinator
            .switch_or_wait(observed_generation, 0, "current", || {
                Ok(AutoSwitchAttempt::Switched)
            })
            .unwrap());

        let second_switch_count = AtomicUsize::new(0);
        let retry_count = AtomicUsize::new(0);
        let response = retry_official_request_after_quota_switch_with(
            Ok(official_payload(429, observed_generation)),
            |generation, attempt_generation, failed_account_id| {
                coordinator.switch_or_wait(
                    generation,
                    attempt_generation,
                    failed_account_id,
                    || {
                        second_switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                        Ok(AutoSwitchAttempt::Switched)
                    },
                )
            },
            || {
                retry_count.fetch_add(1, AtomicOrdering::SeqCst);
                Ok(official_payload(200, observed_generation + 1))
            },
        )
        .unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(second_switch_count.load(AtomicOrdering::SeqCst), 0);
        assert_eq!(retry_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(coordinator.active_account_generation(), 1);
    }

    #[test]
    fn quota_switch_retry_is_limited_to_once() {
        let switch_count = AtomicUsize::new(0);
        let retry_count = AtomicUsize::new(0);

        let response = retry_official_request_after_quota_switch_with(
            Ok(official_payload(429, 0)),
            |_, _, _| {
                switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                Ok(true)
            },
            || {
                retry_count.fetch_add(1, AtomicOrdering::SeqCst);
                Ok(official_payload(429, 1))
            },
        )
        .unwrap();

        assert_eq!(response.status, 429);
        assert_eq!(switch_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(retry_count.load(AtomicOrdering::SeqCst), 1);
    }

    #[test]
    fn upstream_url_avoids_duplicate_v1() {
        assert_eq!(
            build_upstream_url("https://api.example.com/v1", "/v1/responses"),
            "https://api.example.com/v1/responses"
        );
        assert_eq!(
            build_upstream_url("https://api.example.com", "/responses"),
            "https://api.example.com/v1/responses"
        );
    }

    #[test]
    fn codex_response_endpoint_variants_normalize_for_upstream() {
        assert_eq!(
            upstream_endpoint_for_codex_request("/v1/v1/responses?foo=bar"),
            "/v1/responses?foo=bar"
        );
        assert_eq!(
            upstream_endpoint_for_codex_request("/codex/v1/responses"),
            "/v1/responses"
        );
        assert_eq!(
            upstream_endpoint_for_codex_request("/codex/v1/responses/compact?foo=bar"),
            "/v1/responses/compact?foo=bar"
        );
        assert!(is_responses_endpoint("/v1/v1/responses"));
        assert!(is_responses_endpoint("/codex/v1/responses/compact"));
    }

    #[test]
    fn image_endpoints_use_the_image_generation_credential_purpose() {
        assert!(is_image_generation_endpoint("/images/generations"));
        assert!(is_image_generation_endpoint("/v1/images/generations"));
        assert!(is_image_generation_endpoint("/v1/images/edits"));
        assert!(is_image_generation_endpoint("/codex/v1/images/edits"));
        assert!(!is_image_generation_endpoint("/v1/responses"));
    }

    #[test]
    fn image_requests_use_the_configured_oauth_account_for_agent_identity() {
        let mut state = ManagerStateFile {
            active_account_id: Some("agent-identity".to_string()),
            image_generation_account_id: Some("oauth-account".to_string()),
            ..ManagerStateFile::default()
        };
        let agent_identity_auth = json!({
            "auth_mode": "agentIdentity",
            "agent_identity": {}
        });

        assert_eq!(
            credential_account_id(
                &state,
                &agent_identity_auth,
                OfficialCredentialPurpose::Default
            )
            .unwrap(),
            "agent-identity"
        );
        assert_eq!(
            credential_account_id(
                &state,
                &agent_identity_auth,
                OfficialCredentialPurpose::ImageGeneration
            )
            .unwrap(),
            "oauth-account"
        );

        state.image_generation_account_id = None;
        assert!(credential_account_id(
            &state,
            &agent_identity_auth,
            OfficialCredentialPurpose::ImageGeneration
        )
        .unwrap_err()
        .contains("non-Agent Identity OAuth account"));
    }

    #[test]
    fn image_requests_keep_using_an_active_oauth_account() {
        let state = ManagerStateFile {
            active_account_id: Some("active-oauth".to_string()),
            image_generation_account_id: Some("备用-oauth".to_string()),
            ..ManagerStateFile::default()
        };

        assert_eq!(
            credential_account_id(
                &state,
                &json!({ "auth_mode": "chatgpt" }),
                OfficialCredentialPurpose::ImageGeneration
            )
            .unwrap(),
            "active-oauth"
        );
    }

    #[test]
    fn fallback_image_credentials_cannot_trigger_a_main_account_switch() {
        let active = TokenUsageAccount {
            account_id: "agent-identity".to_string(),
            account_email: "agent@example.com".to_string(),
            active_account_generation: 0,
            auto_switch_attempt_generation: 0,
            auto_switch_eligible: true,
        };
        let fallback = TokenUsageAccount {
            account_id: "oauth-account".to_string(),
            account_email: "oauth@example.com".to_string(),
            active_account_generation: 0,
            auto_switch_attempt_generation: 0,
            auto_switch_eligible: false,
        };

        assert!(credential_can_trigger_auto_switch(&active));
        assert!(!credential_can_trigger_auto_switch(&fallback));
    }

    #[test]
    fn official_models_endpoint_preserves_client_version_query() {
        let endpoint = upstream_endpoint_for_codex_request("/v1/models?client_version=0.144.0");

        assert_eq!(endpoint, "/v1/models?client_version=0.144.0");
        assert_eq!(
            official_url(&endpoint),
            "https://chatgpt.com/backend-api/codex/models?client_version=0.144.0"
        );
    }

    #[test]
    fn proxy_diagnostic_entry_redacts_response_body_content() {
        let provider = ProviderProfile {
            id: "responses".to_string(),
            name: "Responses Gateway".to_string(),
            base_url: "https://gateway.example.com/v1".to_string(),
            api_key: "sk-provider-test".to_string(),
            model: "gpt-4.1".to_string(),
            models: vec!["gpt-4.1".to_string()],
            model_selection_controlled_by_codex: false,
            api_format: ProviderApiFormat::OpenaiResponses,
        };
        let body = serde_json::to_vec(&json!({
            "model": "gpt-4.1",
            "previous_response_id": "resp_secret_cursor",
            "input": "do not log this user prompt",
            "tools": [{ "type": "function", "name": "secret_tool" }],
            "store": true
        }))
        .unwrap();

        let target = ActiveTarget::Provider(provider);
        let entry = proxy_diagnostic_entry(
            &Method::Post,
            "/v1/responses",
            &[],
            &body,
            Some(&target),
            ProxyDiagnosticRoute::ProviderResponsesPassthrough,
        );
        let serialized = entry.to_string();

        assert!(serialized.contains("\"previousResponseId\""));
        assert!(serialized.contains("\"hash\""));
        assert!(!serialized.contains("do not log this user prompt"));
        assert!(!serialized.contains("resp_secret_cursor"));
        assert!(!serialized.contains("secret_tool"));
    }

    #[test]
    fn proxy_diagnostic_entry_redacts_non_responses_body_content() {
        let provider = ProviderProfile {
            id: "chat".to_string(),
            name: "Chat Gateway".to_string(),
            base_url: "https://gateway.example.com/v1".to_string(),
            api_key: "sk-provider-test".to_string(),
            model: "deepseek-chat".to_string(),
            models: vec!["deepseek-chat".to_string()],
            model_selection_controlled_by_codex: false,
            api_format: ProviderApiFormat::OpenaiChat,
        };
        let body = serde_json::to_vec(&json!({
            "model": "deepseek-chat",
            "messages": [{ "role": "user", "content": "do not log this chat prompt" }],
            "tools": [{ "type": "function", "function": { "name": "secret_tool" } }],
            "stream": true
        }))
        .unwrap();

        let target = ActiveTarget::Provider(provider);
        let entry = proxy_diagnostic_entry(
            &Method::Post,
            "/v1/chat/completions",
            &[("Authorization".to_string(), "Bearer sk-secret".to_string())],
            &body,
            Some(&target),
            ProxyDiagnosticRoute::ProviderPassthrough,
        );
        let serialized = entry.to_string();

        assert_eq!(entry["route"].as_str(), Some("provider_passthrough"));
        assert_eq!(entry["requestHeaders"]["authorizationPresent"], true);
        assert!(serialized.contains("\"messages\""));
        assert!(serialized.contains("\"requestBody\""));
        assert!(!serialized.contains("do not log this chat prompt"));
        assert!(!serialized.contains("secret_tool"));
        assert!(!serialized.contains("sk-secret"));
        assert!(entry.get("responses").is_none());
    }

    #[test]
    fn proxy_diagnostic_entry_covers_local_models_route() {
        let target = ActiveTarget::Official {
            model: "gpt-5-codex".to_string(),
        };
        let entry = proxy_diagnostic_entry(
            &Method::Get,
            "/v1/models?probe=secret",
            &[],
            &[],
            Some(&target),
            ProxyDiagnosticRoute::LocalModels,
        );
        let serialized = entry.to_string();

        assert_eq!(entry["route"].as_str(), Some("local_models"));
        assert_eq!(entry["target"]["type"].as_str(), Some("official"));
        assert_eq!(entry["target"]["model"].as_str(), Some("gpt-5-codex"));
        assert_eq!(entry["requestBody"]["json"], false);
        assert_eq!(entry["query"]["present"], true);
        assert!(!serialized.contains("probe=secret"));
        assert!(entry.get("responses").is_none());
    }

    #[test]
    fn official_responses_body_preserves_codex_selected_model() {
        for model in ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] {
            let body = serde_json::to_vec(&json!({
                "model": model,
                "input": "ping",
                "stream": false
            }))
            .unwrap();

            let forwarded =
                official_body_for_upstream(&Method::Post, "/v1/responses", body.clone(), "gpt-5.5");

            assert_eq!(forwarded, body);
        }
    }

    #[test]
    fn official_responses_body_uses_preferred_model_when_request_has_none() {
        for requested in [None, Some(Value::Null), Some(json!("  "))] {
            let mut value = json!({ "input": "ping", "stream": false });
            if let Some(requested) = requested {
                value["model"] = requested;
            }
            let body = serde_json::to_vec(&value).unwrap();

            let rewritten =
                official_body_for_upstream(&Method::Post, "/v1/responses", body, "gpt-5.5");
            let json: Value = serde_json::from_slice(&rewritten).unwrap();

            assert_eq!(json["model"], "gpt-5.5");
            assert_eq!(json["input"], "ping");
        }
    }

    #[test]
    fn official_token_usage_tracks_codex_selected_model() {
        let target = ActiveTarget::Official {
            model: "gpt-5.5".to_string(),
        };
        let body = serde_json::to_vec(&json!({
            "model": "gpt-5.6-sol",
            "input": "ping"
        }))
        .unwrap();

        let context = token_usage_context(
            &Method::Post,
            "/v1/responses",
            &body,
            &target,
            Instant::now(),
        )
        .unwrap();

        assert_eq!(context.model, "gpt-5.6-sol");
    }

    #[test]
    fn streaming_token_usage_does_not_require_response_content_type() {
        let target = ActiveTarget::Official {
            model: "gpt-5.6-sol".to_string(),
        };
        let body = serde_json::to_vec(&json!({
            "model": "gpt-5.6-sol",
            "input": "ping",
            "stream": true
        }))
        .unwrap();
        let context = token_usage_context(
            &Method::Post,
            "/v1/responses",
            &body,
            &target,
            Instant::now(),
        )
        .unwrap();
        let sse = concat!(
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-1\",\"usage\":{\"input_tokens\":120,\"input_tokens_details\":{\"cached_tokens\":80},\"output_tokens\":30,\"output_tokens_details\":{\"reasoning_tokens\":12},\"total_tokens\":150}}}\n\n",
            "data: [DONE]\n\n"
        );

        assert!(context.expects_event_stream);
        assert_eq!(
            extract_token_usage_from_bytes(sse.as_bytes(), None, context.expects_event_stream),
            Some(TokenUsageValues {
                input_tokens: Some(120),
                output_tokens: Some(30),
                reasoning_tokens: Some(12),
                cached_tokens: Some(80),
                total_tokens: Some(150),
            })
        );
    }

    #[test]
    fn provider_models_response_matches_codex_model_info_shape() {
        let provider = ProviderProfile {
            id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: "sk-provider-test".to_string(),
            model: "deepseek-chat".to_string(),
            models: vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()],
            model_selection_controlled_by_codex: true,
            api_format: ProviderApiFormat::OpenaiResponses,
        };
        let catalog = providers::model_catalog_for_models(&provider_models_for_codex(&provider));
        let models = catalog["models"].as_array().unwrap();

        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["slug"], "deepseek-chat");
        assert_eq!(models[1]["slug"], "deepseek-reasoner");
        for model in models {
            for key in [
                "supported_reasoning_levels",
                "shell_type",
                "visibility",
                "supported_in_api",
                "priority",
                "base_instructions",
                "supports_reasoning_summaries",
                "support_verbosity",
                "truncation_policy",
                "supports_parallel_tool_calls",
                "experimental_supported_tools",
            ] {
                assert!(model.get(key).is_some(), "missing Codex model field {key}");
            }
        }
    }

    #[test]
    fn non_success_upstream_response_is_buffered_for_diagnostics() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            let response = Response::from_string("{\"error\":\"bad upstream key\"}")
                .with_status_code(StatusCode(401))
                .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
            request.respond(response).unwrap();
        });

        let response = Client::new()
            .get(format!("http://{addr}/fail"))
            .send()
            .unwrap();
        let payload = stream_response(response).unwrap();
        handle.join().unwrap();

        assert_eq!(payload.status, 401);
        let body = match payload.body {
            UpstreamBody::Buffered(body) => body,
            UpstreamBody::Streaming(_) => panic!("non-success responses should be buffered"),
        };
        let diagnostic = diagnostic_response_body(&body, payload.content_type.as_deref());
        assert_eq!(diagnostic["captured"], true);
        assert_eq!(diagnostic["text"], "{\"error\":\"bad upstream key\"}");
        assert_eq!(diagnostic["truncated"], false);
    }

    #[test]
    fn official_models_response_preserves_full_5_6_catalog_and_etag() {
        let catalog = json!({
            "models": [
                {
                    "slug": "gpt-5.6-sol",
                    "tool_mode": "code_mode_only",
                    "multi_agent_version": "v2",
                    "use_responses_lite": true,
                    "context_window": 372000
                },
                {
                    "slug": "gpt-5.6-terra",
                    "tool_mode": "code_mode_only",
                    "multi_agent_version": "v2",
                    "use_responses_lite": true,
                    "context_window": 372000
                },
                {
                    "slug": "gpt-5.6-luna",
                    "tool_mode": "code_mode_only",
                    "multi_agent_version": "v1",
                    "use_responses_lite": true,
                    "context_window": 372000
                }
            ]
        });
        let expected = serde_json::to_vec(&catalog).unwrap();
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let upstream_body = expected.clone();
        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            let response = Response::from_data(upstream_body)
                .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
                .with_header(Header::from_bytes("ETag", "\"models-5.6\"").unwrap());
            request.respond(response).unwrap();
        });

        let response = Client::new()
            .get(format!("http://{addr}/models?client_version=0.144.0"))
            .send()
            .unwrap();
        let mut payload = stream_response(response).unwrap();
        handle.join().unwrap();
        let mut actual = Vec::new();
        match &mut payload.body {
            UpstreamBody::Buffered(body) => actual.extend_from_slice(body),
            UpstreamBody::Streaming(reader) => {
                reader.read_to_end(&mut actual).unwrap();
            }
        }

        assert_eq!(actual, expected);
        assert_eq!(
            payload.response_headers,
            vec![("etag".to_string(), "\"models-5.6\"".to_string())]
        );
    }

    #[test]
    fn upstream_model_headers_are_allowlisted() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::ETAG, "\"models-5.6\"".parse().unwrap());
        headers.insert("x-models-etag", "models-refresh".parse().unwrap());
        headers.insert(reqwest::header::SET_COOKIE, "secret=value".parse().unwrap());

        let forwarded = forwarded_response_headers(&headers);

        assert_eq!(
            forwarded,
            vec![
                ("etag".to_string(), "\"models-5.6\"".to_string()),
                ("x-models-etag".to_string(), "models-refresh".to_string()),
            ]
        );
    }

    #[test]
    fn respond_payload_preserves_model_cache_headers() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            respond_payload(
                request,
                UpstreamPayload {
                    status: 200,
                    content_type: Some("application/json".to_string()),
                    response_headers: vec![
                        ("etag".to_string(), "\"models-5.6\"".to_string()),
                        ("x-models-etag".to_string(), "models-refresh".to_string()),
                    ],
                    body: UpstreamBody::Buffered(b"{\"models\":[]}".to_vec()),
                    token_usage_account: None,
                },
            );
        });

        let response = Client::new()
            .get(format!("http://{addr}/models"))
            .send()
            .unwrap();

        assert_eq!(
            response
                .headers()
                .get("etag")
                .and_then(|value| value.to_str().ok()),
            Some("\"models-5.6\"")
        );
        assert_eq!(
            response
                .headers()
                .get("x-models-etag")
                .and_then(|value| value.to_str().ok()),
            Some("models-refresh")
        );
        assert_eq!(response.text().unwrap(), "{\"models\":[]}");
        handle.join().unwrap();
    }

    #[test]
    fn inbound_official_auth_routing_headers_are_not_forwarded() {
        for header in [
            "authorization",
            "x-api-key",
            "openai-api-key",
            "api-key",
            "chatgpt-account-id",
            "cookie",
            "proxy-authorization",
            "originator",
            LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER,
        ] {
            assert!(
                should_skip_header(header, true),
                "header should be blocked: {header}"
            );
        }
        assert!(should_skip_header(
            LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER,
            false
        ));
        assert!(!should_skip_header("x-request-id", true));
    }

    #[test]
    fn token_usage_database_lists_recent_entries_with_limit() {
        let connection = Connection::open_in_memory().unwrap();
        init_token_usage_schema(&connection).unwrap();
        for index in 0..(TOKEN_USAGE_LIST_LIMIT + 2) {
            insert_token_usage_entry(
                &connection,
                &TokenUsageEntry {
                    id: format!("entry-{index:03}"),
                    ts: index as u64,
                    provider: "Provider".to_string(),
                    account_id: Some("account-123".to_string()),
                    account_email: Some("person@example.com".to_string()),
                    model: "gpt-test".to_string(),
                    duration_ms: Some(10),
                    input_tokens: Some(index as u64),
                    output_tokens: Some(1),
                    reasoning_tokens: Some(0),
                    cached_tokens: Some(0),
                    total_tokens: Some(index as u64 + 1),
                },
            )
            .unwrap();
        }

        let entries =
            list_token_usage_entries_from_db(&connection, TOKEN_USAGE_LIST_LIMIT).unwrap();

        assert_eq!(entries.len(), TOKEN_USAGE_LIST_LIMIT);
        assert_eq!(entries[0].id, "entry-501");
        assert_eq!(entries[0].account_id.as_deref(), Some("account-123"));
        assert_eq!(
            entries[0].account_email.as_deref(),
            Some("person@example.com")
        );
        assert_eq!(entries[TOKEN_USAGE_LIST_LIMIT - 1].id, "entry-002");
        assert!(entries.iter().all(|entry| entry.id != "entry-001"));
    }

    #[test]
    fn token_usage_database_migrates_account_columns() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE token_usage_entries (
                    id TEXT PRIMARY KEY,
                    ts INTEGER NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    duration_ms INTEGER,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    reasoning_tokens INTEGER,
                    cached_tokens INTEGER,
                    total_tokens INTEGER,
                    created_at_ms INTEGER NOT NULL
                );
                "#,
            )
            .unwrap();

        init_token_usage_schema(&connection).unwrap();

        let columns = token_usage_table_columns(&connection).unwrap();
        assert!(columns.contains("account_id"));
        assert!(columns.contains("account_email"));
    }

    #[test]
    fn responses_request_converts_to_chat_messages() {
        let body = json!({
            "model": "deepseek-chat",
            "instructions": "Be brief",
            "input": [{ "role": "user", "content": [{ "type": "input_text", "text": "Hi" }] }],
            "stream": true
        });
        let chat = responses_to_chat_completions(&body);
        assert_eq!(chat["model"], "deepseek-chat");
        assert_eq!(chat["messages"][0]["role"], "system");
        assert_eq!(chat["messages"][1]["content"], "Hi");
        assert_eq!(chat["stream_options"]["include_usage"], true);
    }

    #[test]
    fn provider_image_generation_request_preserves_gpt_image_model() {
        let provider = ProviderProfile {
            id: "images".to_string(),
            name: "Images".to_string(),
            base_url: "https://images.example.com/v1".to_string(),
            api_key: "sk-provider-test".to_string(),
            model: "provider-text-model".to_string(),
            models: vec!["provider-text-model".to_string()],
            model_selection_controlled_by_codex: false,
            api_format: ProviderApiFormat::OpenaiResponses,
        };
        let body = serde_json::to_vec(&json!({
            "model": "gpt-image-2",
            "prompt": "a fox reading code"
        }))
        .unwrap();

        let forwarded =
            provider_body_for_upstream(&Method::Post, "/v1/images/generations", body, &provider);
        let forwarded: Value = serde_json::from_slice(&forwarded).unwrap();

        assert_eq!(forwarded["model"], "gpt-image-2");
        assert_eq!(forwarded["prompt"], "a fox reading code");
    }

    #[test]
    fn responses_chat_bridge_roundtrips_tool_search_and_namespace_tools() {
        let body = json!({
            "model": "deepseek-chat",
            "input": "open the site",
            "tools": [
                { "type": "tool_search" },
                {
                    "type": "namespace",
                    "name": "chrome",
                    "tools": [{
                        "type": "function",
                        "name": "open_url",
                        "description": "Open a URL",
                        "parameters": {
                            "type": "object",
                            "properties": { "url": { "type": "string" } },
                            "required": ["url"]
                        }
                    }]
                }
            ],
            "tool_choice": { "type": "tool_search" }
        });
        let context = build_codex_tool_context_from_request(&body);
        let chat = responses_to_chat_completions_with_context(&body, &context);
        let tools = chat["tools"].as_array().unwrap();

        assert!(tools
            .iter()
            .any(|tool| tool.pointer("/function/name") == Some(&json!("tool_search"))));
        assert!(tools
            .iter()
            .any(|tool| tool.pointer("/function/name") == Some(&json!("chrome__open_url"))));
        assert_eq!(chat["tool_choice"]["function"]["name"], "tool_search");

        let response = chat_to_responses_json(
            &json!({
                "id": "chatcmpl_tools",
                "model": "deepseek-chat",
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "call_search",
                                "type": "function",
                                "function": {
                                    "name": "tool_search",
                                    "arguments": "{\"query\":\"chrome\"}"
                                }
                            },
                            {
                                "id": "call_chrome",
                                "type": "function",
                                "function": {
                                    "name": "chrome__open_url",
                                    "arguments": "{\"url\":\"https://example.com\"}"
                                }
                            }
                        ]
                    },
                    "finish_reason": "tool_calls"
                }]
            }),
            &context,
        );

        assert_eq!(response["output"][0]["type"], "tool_search_call");
        assert_eq!(response["output"][0]["arguments"]["query"], "chrome");
        assert_eq!(response["output"][1]["type"], "function_call");
        assert_eq!(response["output"][1]["namespace"], "chrome");
        assert_eq!(response["output"][1]["name"], "open_url");
    }

    #[test]
    fn chat_sse_reader_restores_streaming_custom_tool_calls() {
        let body = json!({
            "model": "deepseek-chat",
            "tools": [{
                "type": "custom",
                "name": "apply_patch",
                "format": { "type": "grammar", "syntax": "lark", "definition": "start: /.+/" }
            }]
        });
        let context = build_codex_tool_context_from_request(&body);
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_patch\",\"type\":\"function\",\"function\":{\"name\":\"apply_patch\",\"arguments\":\"{\\\"input\\\":\\\"*** Begin\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\" Patch\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
            "data: [DONE]\n\n"
        );
        let mut reader = ChatSseReader::new(
            BufReader::new(Cursor::new(sse.as_bytes().to_vec())),
            "deepseek-chat".to_string(),
            context,
        );
        let mut output = String::new();
        reader.read_to_string(&mut output).unwrap();

        assert!(output.contains("response.custom_tool_call_input.done"));
        assert!(output.contains("\"type\":\"custom_tool_call\""));
        assert!(output.contains("*** Begin Patch"));
    }

    #[test]
    fn chat_sse_reader_emits_incremental_response_events() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" done\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let mut reader = ChatSseReader::new(
            BufReader::new(Cursor::new(sse.as_bytes().to_vec())),
            "deepseek-chat".to_string(),
            CodexToolContext::default(),
        );
        let mut output = String::new();
        reader.read_to_string(&mut output).unwrap();

        assert!(output.contains("response.created"));
        assert!(output.contains("response.output_text.delta"));
        assert!(output.contains("thinking"));
        assert!(output.contains(" done"));
        assert!(output.contains("response.completed"));
        assert!(output.ends_with("data: [DONE]\n\n"));
    }

    #[test]
    fn buffered_chat_sse_conversion_keeps_reasoning_content() {
        let output = chat_sse_to_responses_sse(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"why\"}}]}\n\n",
            "deepseek-chat",
        );

        assert!(output.contains("why"));
        assert!(output.contains("response.completed"));
    }

    #[test]
    fn chat_bridge_honors_codex_selected_provider_model() {
        let provider = ProviderProfile {
            id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: "sk-provider-test".to_string(),
            model: "deepseek-chat".to_string(),
            models: vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()],
            model_selection_controlled_by_codex: true,
            api_format: ProviderApiFormat::OpenaiChat,
        };
        let body = json!({ "model": "deepseek-reasoner", "input": "ping" });

        assert_eq!(
            selected_provider_model(&body, &provider),
            "deepseek-reasoner"
        );
    }

    #[test]
    fn chat_bridge_uses_provider_key_and_chat_endpoint() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let base_url = format!("http://{addr}");
        let (tx, rx) = mpsc::channel();

        let handle = thread::spawn(move || {
            let mut request = server.recv().unwrap();
            let path = request.url().to_string();
            let authorization = request
                .headers()
                .iter()
                .find(|header| {
                    header
                        .field
                        .as_str()
                        .as_str()
                        .eq_ignore_ascii_case("authorization")
                })
                .map(|header| header.value.as_str().to_string());
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body).unwrap();
            tx.send((path, authorization, body)).unwrap();

            let response = Response::from_string(
                json!({
                    "id": "chatcmpl_test",
                    "object": "chat.completion",
                    "model": "deepseek-v4-flash",
                    "choices": [{
                        "index": 0,
                        "message": { "role": "assistant", "content": "ok" },
                        "finish_reason": "stop"
                    }],
                    "usage": {
                        "prompt_tokens": 1,
                        "completion_tokens": 1,
                        "total_tokens": 2
                    }
                })
                .to_string(),
            )
            .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
            request.respond(response).unwrap();
        });

        let provider = ProviderProfile {
            id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            base_url,
            api_key: "sk-provider-test".to_string(),
            model: "deepseek-v4-flash".to_string(),
            models: vec!["deepseek-v4-flash".to_string()],
            model_selection_controlled_by_codex: false,
            api_format: ProviderApiFormat::OpenaiChat,
        };
        let body = serde_json::to_vec(&json!({
            "model": "client-placeholder",
            "input": "ping",
            "stream": false
        }))
        .unwrap();

        let payload = forward_chat_bridge(&Method::Post, "/v1/responses", &[], body, &provider)
            .expect("chat bridge request should succeed");

        let (path, authorization, upstream_body) = rx.recv().unwrap();
        handle.join().unwrap();
        assert_eq!(path, "/v1/chat/completions");
        assert_eq!(authorization.as_deref(), Some("Bearer sk-provider-test"));
        let upstream_json: Value = serde_json::from_str(&upstream_body).unwrap();
        assert_eq!(upstream_json["model"], "deepseek-v4-flash");
        assert_eq!(upstream_json["messages"][0]["content"], "ping");

        assert_eq!(payload.status, 200);
        let response_body = match payload.body {
            UpstreamBody::Buffered(body) => body,
            UpstreamBody::Streaming(_) => panic!("non-stream chat bridge should be buffered"),
        };
        let response_json: Value = serde_json::from_slice(&response_body).unwrap();
        assert_eq!(response_json["output"][0]["content"][0]["text"], "ok");
    }
}
