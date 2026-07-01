use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use rand::RngCore;
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tiny_http::{Header, Request, Response as HttpResponse, Server, StatusCode};

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER: &str = "https://auth.openai.com";
const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const RESET_CREDITS_URL: &str = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const ORIGINATOR: &str = "codex_cli_rs";

#[derive(Default)]
struct AppState {
    login_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountSummary {
    id: String,
    email: String,
    plan: String,
    account_id: Option<String>,
    active: bool,
    usage: UsageSummary,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageSummary {
    primary: Option<UsageWindow>,
    secondary: Option<UsageWindow>,
    fetched_at: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageWindow {
    used_percent: f64,
    remaining_percent: f64,
    resets_at: Option<i64>,
    window_minutes: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResetCredit {
    issued_at: Option<String>,
    expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResetCreditsSummary {
    credits: Vec<ResetCredit>,
}

#[derive(Default, Serialize, Deserialize)]
struct ManagerStateFile {
    active_account_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    codex_home: String,
    auth_path: String,
    account_store: String,
    version: String,
}

#[derive(Serialize, Clone)]
struct LoginStatus {
    ok: bool,
    message: String,
}

#[derive(Serialize)]
struct LoginStart {
    url: String,
    embedded: bool,
}

#[derive(Clone)]
struct Paths {
    codex_home: PathBuf,
    current_auth: PathBuf,
    accounts: PathBuf,
    state_file: PathBuf,
}

fn paths<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Paths, String> {
    let codex_home = std::env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
        .ok_or_else(|| "无法定位用户 Home 目录".to_string())?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    let accounts = app_data.join("accounts");
    Ok(Paths {
        current_auth: codex_home.join("auth.json"),
        codex_home,
        state_file: app_data.join("state.json"),
        accounts,
    })
}

fn read_json(path: &Path) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取 {} 失败：{error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{} 不是有效 JSON：{error}", path.display()))
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标路径没有父目录".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("创建 {} 失败：{error}", parent.display()))?;
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("序列化 auth.json 失败：{error}"))?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temp, bytes).map_err(|error| format!("写入临时文件失败：{error}"))?;
    replace_file(&temp, path).map_err(|error| format!("提交 {} 失败：{error}", path.display()))
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let mut source_wide: Vec<u16> = source.as_os_str().encode_wide().collect();
    source_wide.push(0);
    let mut destination_wide: Vec<u16> = destination.as_os_str().encode_wide().collect();
    destination_wide.push(0);
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn decode_jwt(token: &str) -> Result<Value, String> {
    let payload = token
        .split('.')
        .nth(1)
        .filter(|part| !part.is_empty())
        .ok_or_else(|| "auth.json 中的 JWT 格式无效".to_string())?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| "auth.json 中的 JWT 无法解码".to_string())?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "auth.json 中的 JWT payload 不是有效 JSON".to_string())
}

fn token_string<'a>(auth: &'a Value, key: &str) -> Option<&'a str> {
    auth.get("tokens")?
        .get(key)?
        .as_str()
        .filter(|value| !value.is_empty())
}

fn auth_claims(auth: &Value) -> Result<Value, String> {
    let token = token_string(auth, "id_token")
        .or_else(|| token_string(auth, "access_token"))
        .ok_or_else(|| "auth.json 缺少 ChatGPT tokens".to_string())?;
    decode_jwt(token)
}

fn nested_auth(claims: &Value) -> Option<&Value> {
    claims.get("https://api.openai.com/auth")
}

fn account_fields(auth: &Value) -> Result<(String, String, Option<String>, String), String> {
    let claims = auth_claims(auth)?;
    let nested = nested_auth(&claims);
    let email = claims
        .get("email")
        .and_then(Value::as_str)
        .or_else(|| {
            claims
                .get("https://api.openai.com/profile")?
                .get("email")?
                .as_str()
        })
        .unwrap_or("未知账户")
        .to_string();
    let plan = nested
        .and_then(|value| value.get("chatgpt_plan_type"))
        .and_then(Value::as_str)
        .unwrap_or("ChatGPT")
        .to_string();
    let account_id = auth
        .get("tokens")
        .and_then(|value| value.get("account_id"))
        .and_then(Value::as_str)
        .or_else(|| nested?.get("chatgpt_account_id")?.as_str())
        .map(str::to_string);
    let identity = nested
        .and_then(|value| {
            value
                .get("chatgpt_user_id")
                .or_else(|| value.get("user_id"))
        })
        .and_then(Value::as_str)
        .or_else(|| claims.get("sub").and_then(Value::as_str))
        .unwrap_or(&email);
    let mut hasher = Sha256::new();
    hasher.update(identity.as_bytes());
    hasher.update(b"\0");
    hasher.update(account_id.as_deref().unwrap_or("personal").as_bytes());
    let digest = hasher.finalize();
    let id = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok((email, plan, account_id, id))
}

fn validate_auth(auth: &Value) -> Result<(), String> {
    if !auth.is_object() {
        return Err("auth.json 顶层必须是对象".to_string());
    }
    token_string(auth, "access_token")
        .ok_or_else(|| "auth.json 缺少 tokens.access_token".to_string())?;
    account_fields(auth).map(|_| ())
}

fn account_dir(paths: &Paths, id: &str) -> PathBuf {
    paths.accounts.join(id)
}

fn managed_auth_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("auth.json")
}

fn usage_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("usage.json")
}

fn read_state(paths: &Paths) -> ManagerStateFile {
    fs::read(&paths.state_file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_state(paths: &Paths, state: &ManagerStateFile) -> Result<(), String> {
    let value = serde_json::to_value(state).map_err(|error| error.to_string())?;
    write_json_atomic(&paths.state_file, &value)
}

fn import_value<R: Runtime>(
    app: &tauri::AppHandle<R>,
    auth: Value,
    activate: bool,
) -> Result<String, String> {
    validate_auth(&auth)?;
    let paths = paths(app)?;
    let (_, _, _, id) = account_fields(&auth)?;
    write_json_atomic(&managed_auth_path(&paths, &id), &auth)?;
    if activate {
        write_json_atomic(&paths.current_auth, &auth)?;
        write_state(
            &paths,
            &ManagerStateFile {
                active_account_id: Some(id.clone()),
            },
        )?;
    }
    Ok(id)
}

fn sync_current_into_store<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let paths = paths(app)?;
    if !paths.current_auth.exists() {
        return Ok(());
    }
    let auth = read_json(&paths.current_auth)?;
    validate_auth(&auth)?;
    let id = import_value(app, auth, false)?;
    let mut state = read_state(&paths);
    if state.active_account_id.as_deref() != Some(&id) {
        state.active_account_id = Some(id);
        write_state(&paths, &state)?;
    }
    Ok(())
}

fn load_usage(path: &Path) -> UsageSummary {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_usage(path: &Path, usage: &UsageSummary) -> Result<(), String> {
    let value = serde_json::to_value(usage).map_err(|error| error.to_string())?;
    write_json_atomic(path, &value)
}

#[tauri::command]
fn get_app_info<R: Runtime>(app: tauri::AppHandle<R>) -> Result<AppInfo, String> {
    let paths = paths(&app)?;
    Ok(AppInfo {
        codex_home: paths.codex_home.display().to_string(),
        auth_path: paths.current_auth.display().to_string(),
        account_store: paths.accounts.display().to_string(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
fn list_accounts<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Vec<AccountSummary>, String> {
    // A current API-key or malformed auth file should not prevent the manager
    // from opening; it simply cannot be added to the ChatGPT account store.
    let _ = sync_current_into_store(&app);
    let paths = paths(&app)?;
    fs::create_dir_all(&paths.accounts).map_err(|error| format!("创建账户目录失败：{error}"))?;
    let active_id = read_state(&paths).active_account_id;
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
        accounts.push(AccountSummary {
            active: active_id.as_deref() == Some(&id),
            usage: load_usage(&usage_path(&paths, &id)),
            id,
            email,
            plan,
            account_id,
        });
    }
    accounts.sort_by(|left, right| {
        right
            .active
            .cmp(&left.active)
            .then_with(|| left.email.cmp(&right.email))
    });
    Ok(accounts)
}

#[tauri::command]
fn import_auth_file<R: Runtime>(app: tauri::AppHandle<R>, path: String) -> Result<String, String> {
    let auth = read_json(Path::new(&path))?;
    let id = import_value(&app, auth, false)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(id)
}

#[tauri::command]
fn switch_account<R: Runtime>(app: tauri::AppHandle<R>, id: String) -> Result<(), String> {
    // Best-effort capture of tokens Codex may have refreshed since the last switch.
    let _ = sync_current_into_store(&app);
    let paths = paths(&app)?;
    let selected = read_json(&managed_auth_path(&paths, &id))?;
    validate_auth(&selected)?;
    write_json_atomic(&paths.current_auth, &selected)?;
    write_state(
        &paths,
        &ManagerStateFile {
            active_account_id: Some(id),
        },
    )?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_account<R: Runtime>(app: tauri::AppHandle<R>, id: String) -> Result<(), String> {
    let paths = paths(&app)?;
    if read_state(&paths).active_account_id.as_deref() == Some(&id) {
        return Err("不能删除当前正在使用的账户，请先切换到其他账户".to_string());
    }
    let target = account_dir(&paths, &id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| format!("删除账户失败：{error}"))?;
    }
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())
}

fn token_expiring(auth: &Value) -> bool {
    let Some(token) = token_string(auth, "access_token") else {
        return true;
    };
    let Ok(claims) = decode_jwt(token) else {
        return false;
    };
    let Some(exp) = claims.get("exp").and_then(Value::as_i64) else {
        return false;
    };
    exp <= Utc::now().timestamp() + 300
}

fn refresh_tokens(client: &Client, auth: &mut Value) -> Result<(), String> {
    let refresh_token = token_string(auth, "refresh_token")
        .ok_or_else(|| "登录已过期，且 auth.json 中没有 refresh_token；请重新登录".to_string())?
        .to_string();
    let response = client
        .post(format!("{ISSUER}/oauth/token"))
        .header("Content-Type", "application/json")
        .header("originator", ORIGINATOR)
        .json(&json!({
            "client_id": CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .map_err(|error| format!("刷新登录凭据失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "刷新登录凭据失败（HTTP {}），请重新登录",
            response.status()
        ));
    }
    let payload: Value = response
        .json()
        .map_err(|error| format!("解析刷新响应失败：{error}"))?;
    let tokens = auth
        .get_mut("tokens")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "auth.json 缺少 tokens 对象".to_string())?;
    for key in ["id_token", "access_token", "refresh_token"] {
        if let Some(value) = payload.get(key).and_then(Value::as_str) {
            tokens.insert(key.to_string(), Value::String(value.to_string()));
        }
    }
    auth.as_object_mut()
        .ok_or_else(|| "auth.json 顶层格式无效".to_string())?
        .insert(
            "last_refresh".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );
    Ok(())
}

fn usage_request(client: &Client, auth: &Value) -> Result<Response, String> {
    let access_token = token_string(auth, "access_token")
        .ok_or_else(|| "auth.json 缺少 access_token".to_string())?;
    let (_, _, account_id, _) = account_fields(auth)?;
    let mut request = client
        .get(USAGE_URL)
        .bearer_auth(access_token)
        .header("originator", ORIGINATOR)
        .header("User-Agent", "codex_cli_rs/0.1.0");
    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }
    request
        .send()
        .map_err(|error| format!("读取 Codex 用量失败：{error}"))
}

fn reset_credits_request(client: &Client, auth: &Value) -> Result<Response, String> {
    let access_token = token_string(auth, "access_token")
        .ok_or_else(|| "auth.json 缺少 access_token".to_string())?;
    let (_, _, account_id, _) = account_fields(auth)?;
    let mut request = client
        .get(RESET_CREDITS_URL)
        .bearer_auth(access_token)
        .header("originator", ORIGINATOR)
        .header("User-Agent", "codex_cli_rs/0.1.0");
    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }
    request
        .send()
        .map_err(|error| format!("读取 Codex 重置卡失败：{error}"))
}

fn normalized_timestamp(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(timestamp) = value.as_str() {
        return chrono::DateTime::parse_from_rfc3339(timestamp)
            .ok()
            .map(|value| value.with_timezone(&Utc).to_rfc3339());
    }

    let raw = value.as_i64()?;
    let seconds = if raw.abs() >= 100_000_000_000 {
        raw / 1000
    } else {
        raw
    };
    chrono::DateTime::<Utc>::from_timestamp(seconds, 0).map(|value| value.to_rfc3339())
}

fn parse_reset_credits(payload: &Value) -> Result<ResetCreditsSummary, String> {
    let credits = payload
        .get("credits")
        .and_then(Value::as_array)
        .ok_or_else(|| "重置卡接口响应缺少 credits 列表".to_string())?;
    let mut result = credits
        .iter()
        .map(|credit| ResetCredit {
            issued_at: normalized_timestamp(
                credit
                    .get("granted_at")
                    .or_else(|| credit.get("created_at")),
            ),
            expires_at: normalized_timestamp(credit.get("expires_at")),
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| left.expires_at.cmp(&right.expires_at));
    Ok(ResetCreditsSummary { credits: result })
}

fn window_from(value: Option<&Value>) -> Option<UsageWindow> {
    let value = value?;
    let used = value.get("used_percent")?.as_f64()?.clamp(0.0, 100.0);
    Some(UsageWindow {
        used_percent: used,
        remaining_percent: (100.0 - used).clamp(0.0, 100.0),
        resets_at: value.get("reset_at").and_then(Value::as_i64),
        window_minutes: value
            .get("limit_window_seconds")
            .and_then(Value::as_i64)
            .filter(|seconds| *seconds > 0)
            .map(|seconds| seconds / 60),
    })
}

fn parse_usage(payload: &Value) -> UsageSummary {
    let rate_limit = payload.get("rate_limit").filter(|value| !value.is_null());
    UsageSummary {
        primary: window_from(rate_limit.and_then(|value| value.get("primary_window"))),
        secondary: window_from(rate_limit.and_then(|value| value.get("secondary_window"))),
        fetched_at: Some(Utc::now().to_rfc3339()),
        error: None,
    }
}

#[tauri::command]
fn refresh_usage<R: Runtime>(app: tauri::AppHandle<R>, id: String) -> Result<UsageSummary, String> {
    let paths = paths(&app)?;
    let auth_path = managed_auth_path(&paths, &id);
    let mut auth = read_json(&auth_path)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建网络客户端失败：{error}"))?;

    if token_expiring(&auth) {
        refresh_tokens(&client, &mut auth)?;
        write_json_atomic(&auth_path, &auth)?;
    }

    let mut response = usage_request(&client, &auth)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        refresh_tokens(&client, &mut auth)?;
        write_json_atomic(&auth_path, &auth)?;
        response = usage_request(&client, &auth)?;
    }

    let result = if response.status().is_success() {
        let payload: Value = response
            .json()
            .map_err(|error| format!("解析用量响应失败：{error}"))?;
        Ok(parse_usage(&payload))
    } else {
        Err(format!("Codex 用量接口返回 HTTP {}", response.status()))
    };

    match result {
        Ok(usage) => {
            save_usage(&usage_path(&paths, &id), &usage)?;
            if read_state(&paths).active_account_id.as_deref() == Some(&id) {
                write_json_atomic(&paths.current_auth, &auth)?;
            }
            app.emit("accounts-changed", ())
                .map_err(|error| error.to_string())?;
            Ok(usage)
        }
        Err(error) => {
            let cached = UsageSummary {
                error: Some(error.clone()),
                fetched_at: Some(Utc::now().to_rfc3339()),
                ..load_usage(&usage_path(&paths, &id))
            };
            let _ = save_usage(&usage_path(&paths, &id), &cached);
            Err(error)
        }
    }
}

#[tauri::command]
fn fetch_reset_credits<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<ResetCreditsSummary, String> {
    let paths = paths(&app)?;
    let auth_path = managed_auth_path(&paths, &id);
    let mut auth = read_json(&auth_path)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建网络客户端失败：{error}"))?;

    if token_expiring(&auth) {
        refresh_tokens(&client, &mut auth)?;
        write_json_atomic(&auth_path, &auth)?;
    }

    let mut response = reset_credits_request(&client, &auth)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        refresh_tokens(&client, &mut auth)?;
        write_json_atomic(&auth_path, &auth)?;
        response = reset_credits_request(&client, &auth)?;
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
    if read_state(&paths).active_account_id.as_deref() == Some(&id) {
        write_json_atomic(&paths.current_auth, &auth)?;
    }
    parse_reset_credits(&payload)
}

fn random_urlsafe<const N: usize>() -> String {
    let mut bytes = [0_u8; N];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn bind_login_server() -> Result<(Server, u16), String> {
    for port in [1455_u16, 1457_u16] {
        if let Ok(server) = Server::http(("127.0.0.1", port)) {
            return Ok((server, port));
        }
    }
    Err("登录回调端口 1455 和 1457 均被占用，请关闭其他 Codex 登录窗口后重试".to_string())
}

fn authorize_url(port: u16, state: &str, challenge: &str) -> Result<String, String> {
    let redirect_uri = format!("http://localhost:{port}/auth/callback");
    let mut url =
        url::Url::parse(&format!("{ISSUER}/oauth/authorize")).map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair(
            "scope",
            "openid profile email offline_access api.connectors.read api.connectors.invoke",
        )
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true")
        .append_pair("state", state)
        .append_pair("originator", ORIGINATOR);
    Ok(url.to_string())
}

fn exchange_code(client: &Client, port: u16, code: &str, verifier: &str) -> Result<Value, String> {
    let redirect_uri = format!("http://localhost:{port}/auth/callback");
    let response = client
        .post(format!("{ISSUER}/oauth/token"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("originator", ORIGINATOR)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &redirect_uri),
            ("client_id", CLIENT_ID),
            ("code_verifier", verifier),
        ])
        .send()
        .map_err(|error| format!("登录凭据交换失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("登录凭据交换失败（HTTP {}）", response.status()));
    }
    response
        .json()
        .map_err(|error| format!("登录响应格式无效：{error}"))
}

fn html_response(request: Request, status: u16, title: &str, message: &str) {
    let safe_title = title.replace('<', "&lt;").replace('>', "&gt;");
    let safe_message = message.replace('<', "&lt;").replace('>', "&gt;");
    let body = format!(
        r#"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{safe_title}</title><style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f6f1;color:#183024;font-family:system-ui,sans-serif}}main{{width:min(420px,calc(100% - 40px));padding:38px;text-align:center;border:1px solid #d8e4da;border-radius:18px;background:white;box-shadow:0 24px 70px #1738241a}}i{{display:grid;place-items:center;width:54px;height:54px;margin:auto;border-radius:16px;background:#e2f1e5;color:#28734d;font-style:normal;font-size:26px}}h1{{font-size:22px;margin:18px 0 8px}}p{{color:#6c7c72;line-height:1.6;font-size:14px}}</style></head><body><main><i>✓</i><h1>{safe_title}</h1><p>{safe_message}</p></main></body></html>"#
    );
    let mut response = HttpResponse::from_string(body).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes("Content-Type", "text/html; charset=utf-8") {
        response = response.with_header(header);
    }
    let _ = request.respond(response);
}

fn emit_login<R: Runtime>(app: &tauri::AppHandle<R>, ok: bool, message: impl Into<String>) {
    let _ = app.emit(
        "login-status",
        LoginStatus {
            ok,
            message: message.into(),
        },
    );
}

fn open_login_in_default_browser<R: Runtime>(
    app: &tauri::AppHandle<R>,
    url: &str,
) -> Result<(), String> {
    app.opener()
        .open_url(url.to_string(), None::<&str>)
        .map_err(|error| format!("无法打开默认浏览器：{error}"))
}

fn open_embedded_login_window<R: Runtime + 'static>(
    app: &tauri::AppHandle<R>,
    url: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let fallback_url = url.to_string();
    let window_app = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            if let Some(window) = window_app.get_webview_window("codex-login") {
                let _ = window.close();
            }
            let redirect_target = serde_json::to_string(&fallback_url)
                .unwrap_or_else(|_| "\"about:blank\"".to_string());
            let redirect_script =
                format!("window.setTimeout(() => window.location.replace({redirect_target}), 50);");
            let window = WebviewWindowBuilder::new(
                &window_app,
                "codex-login",
                WebviewUrl::App("login.html".into()),
            )
            .title("登录 ChatGPT - Codex Auth Manager")
            .inner_size(520.0, 720.0)
            .min_inner_size(420.0, 620.0)
            .center()
            .build()?;
            window.show()?;
            window.set_focus()?;
            window.eval(redirect_script)?;
            Ok::<(), tauri::Error>(())
        })();

        if let Err(error) = result {
            match open_login_in_default_browser(&window_app, &fallback_url) {
                Ok(()) => emit_login(
                    &window_app,
                    false,
                    format!("应用内登录窗口打开失败，已改用默认浏览器：{error}"),
                ),
                Err(open_error) => {
                    cancel.store(true, Ordering::Relaxed);
                    emit_login(
                        &window_app,
                        false,
                        format!("无法打开登录页面：{error}；{open_error}"),
                    );
                }
            }
        }
    })
    .map_err(|error| format!("无法调度应用内登录窗口：{error}"))
}

fn run_login_loop<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    server: Server,
    port: u16,
    expected_state: String,
    verifier: String,
    cancel: Arc<AtomicBool>,
) {
    let started = Instant::now();
    while !cancel.load(Ordering::Relaxed) && started.elapsed() < Duration::from_secs(600) {
        let request = match server.recv_timeout(Duration::from_millis(250)) {
            Ok(Some(request)) => request,
            Ok(None) => continue,
            Err(_) => break,
        };
        let parsed = match url::Url::parse(&format!("http://localhost{}", request.url())) {
            Ok(value) => value,
            Err(_) => {
                html_response(
                    request,
                    400,
                    "登录请求无效",
                    "回调地址无法解析，请重新尝试。",
                );
                continue;
            }
        };
        if parsed.path() != "/auth/callback" {
            html_response(
                request,
                404,
                "页面不存在",
                "请回到 Codex Auth Manager 继续操作。",
            );
            continue;
        }
        let params: std::collections::HashMap<String, String> =
            parsed.query_pairs().into_owned().collect();
        if params.get("state") != Some(&expected_state) {
            html_response(
                request,
                400,
                "安全校验失败",
                "登录 state 不匹配，请关闭窗口后重试。",
            );
            continue;
        }
        if let Some(error) = params.get("error") {
            let description = params
                .get("error_description")
                .map(String::as_str)
                .unwrap_or(error);
            html_response(request, 403, "登录未完成", description);
            emit_login(&app, false, format!("登录失败：{description}"));
            break;
        }
        let Some(code) = params.get("code").filter(|value| !value.is_empty()) else {
            html_response(request, 400, "登录未完成", "授权响应中缺少 code。");
            emit_login(&app, false, "登录失败：授权响应缺少 code");
            break;
        };
        let client = match Client::builder().timeout(Duration::from_secs(25)).build() {
            Ok(client) => client,
            Err(error) => {
                html_response(request, 500, "登录失败", "无法创建安全网络连接。");
                emit_login(&app, false, format!("登录失败：{error}"));
                break;
            }
        };
        match exchange_code(&client, port, code, &verifier).and_then(|tokens| {
            let id_token = tokens
                .get("id_token")
                .and_then(Value::as_str)
                .ok_or_else(|| "登录响应缺少 id_token".to_string())?;
            let access_token = tokens
                .get("access_token")
                .and_then(Value::as_str)
                .ok_or_else(|| "登录响应缺少 access_token".to_string())?;
            let refresh_token = tokens
                .get("refresh_token")
                .and_then(Value::as_str)
                .ok_or_else(|| "登录响应缺少 refresh_token".to_string())?;
            let claims = decode_jwt(id_token)?;
            let account_id = claims
                .get("https://api.openai.com/auth")
                .and_then(|value| value.get("chatgpt_account_id"))
                .and_then(Value::as_str);
            let auth = json!({
                "auth_mode": "chatgpt",
                "OPENAI_API_KEY": null,
                "tokens": {
                    "id_token": id_token,
                    "access_token": access_token,
                    "refresh_token": refresh_token,
                    "account_id": account_id,
                },
                "last_refresh": Utc::now().to_rfc3339(),
            });
            import_value(&app, auth, false)
        }) {
            Ok(_) => {
                html_response(
                    request,
                    200,
                    "登录成功",
                    "账户已保存。请回到 Codex Auth Manager 手动切换到此账户。",
                );
                emit_login(&app, true, "登录成功，账户已保存，可手动切换");
                let _ = app.emit("accounts-changed", ());
                thread::sleep(Duration::from_millis(850));
                if let Some(window) = app.get_webview_window("codex-login") {
                    let _ = window.close();
                }
                break;
            }
            Err(error) => {
                html_response(request, 500, "登录失败", &error);
                emit_login(&app, false, error);
                break;
            }
        }
    }
}

#[tauri::command]
fn start_login<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    embedded: bool,
) -> Result<LoginStart, String> {
    if let Some(previous) = state
        .login_cancel
        .lock()
        .map_err(|_| "登录状态锁已损坏".to_string())?
        .take()
    {
        previous.store(true, Ordering::Relaxed);
        thread::sleep(Duration::from_millis(300));
    }
    if let Some(window) = app.get_webview_window("codex-login") {
        let _ = window.close();
    }
    let (server, port) = bind_login_server()?;
    let verifier = random_urlsafe::<64>();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let oauth_state = random_urlsafe::<32>();
    let url = authorize_url(port, &oauth_state, &challenge)?;
    let cancel = Arc::new(AtomicBool::new(false));
    *state
        .login_cancel
        .lock()
        .map_err(|_| "登录状态锁已损坏".to_string())? = Some(cancel.clone());

    let thread_app = app.clone();
    let thread_cancel = cancel.clone();
    thread::spawn(move || {
        run_login_loop(
            thread_app,
            server,
            port,
            oauth_state,
            verifier,
            thread_cancel,
        )
    });

    if embedded {
        let window_app = app.clone();
        let window_url = url.clone();
        let window_cancel = cancel.clone();
        thread::spawn(move || {
            if let Err(error) =
                open_embedded_login_window(&window_app, &window_url, window_cancel.clone())
            {
                window_cancel.store(true, Ordering::Relaxed);
                emit_login(&window_app, false, error);
            }
        });
    } else if let Err(error) = open_login_in_default_browser(&app, &url) {
        cancel.store(true, Ordering::Relaxed);
        return Err(error);
    }
    Ok(LoginStart { url, embedded })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            list_accounts,
            import_auth_file,
            switch_account,
            delete_account,
            refresh_usage,
            fetch_reset_credits,
            start_login,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Auth Manager");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt(payload: Value) -> String {
        format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap())
        )
    }

    #[test]
    fn parses_account_identity_without_exposing_tokens() {
        let auth = json!({
            "tokens": {
                "id_token": jwt(json!({
                    "email": "person@example.com",
                    "sub": "user-1",
                    "https://api.openai.com/auth": {
                        "chatgpt_plan_type": "plus",
                        "chatgpt_account_id": "account-1"
                    }
                })),
                "access_token": "header.payload.signature",
                "refresh_token": "secret"
            }
        });
        let (email, plan, account_id, id) = account_fields(&auth).unwrap();
        assert_eq!(email, "person@example.com");
        assert_eq!(plan, "plus");
        assert_eq!(account_id.as_deref(), Some("account-1"));
        assert_eq!(id.len(), 24);
    }

    #[test]
    fn maps_used_quota_to_remaining_quota() {
        let usage = parse_usage(&json!({
            "rate_limit": {
                "primary_window": { "used_percent": 42, "limit_window_seconds": 18000, "reset_at": 123 },
                "secondary_window": { "used_percent": 5, "limit_window_seconds": 604800, "reset_at": 456 }
            }
        }));
        assert_eq!(usage.primary.unwrap().remaining_percent, 58.0);
        assert_eq!(usage.secondary.unwrap().window_minutes, Some(10080));
    }

    #[test]
    fn returns_only_reset_credit_times() {
        let summary = parse_reset_credits(&json!({
            "available_count": 1,
            "credits": [{
                "credit_id": "must-not-leave-rust",
                "status": "available",
                "granted_at": "2026-06-30T03:04:05Z",
                "expires_at": "2026-07-30T03:04:05Z"
            }]
        }))
        .unwrap();
        let serialized = serde_json::to_value(summary).unwrap();
        assert_eq!(
            serialized["credits"][0]["issuedAt"],
            "2026-06-30T03:04:05+00:00"
        );
        assert_eq!(
            serialized["credits"][0]["expiresAt"],
            "2026-07-30T03:04:05+00:00"
        );
        assert!(serialized.to_string().find("must-not-leave-rust").is_none());
    }
}
