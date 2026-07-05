use std::{
    collections::HashMap,
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
use reqwest::blocking::Client;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tiny_http::{Header, Request, Response as HttpResponse, Server, StatusCode};

use crate::{
    auth::decode_jwt,
    codex_api::{CLIENT_ID, ISSUER, ORIGINATOR},
    models::{LoginStart, LoginStatus},
    storage::import_value,
};

#[derive(Default)]
pub(crate) struct AppState {
    login_cancel: Mutex<Option<Arc<AtomicBool>>>,
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

fn emit_login<R: Runtime>(
    app: &tauri::AppHandle<R>,
    ok: bool,
    message: impl Into<String>,
    account_id: Option<String>,
) {
    let _ = app.emit(
        "login-status",
        LoginStatus {
            ok,
            message: message.into(),
            account_id,
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
            .title("登录 ChatGPT - Codex Switch")
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
                    None,
                ),
                Err(open_error) => {
                    cancel.store(true, Ordering::Relaxed);
                    emit_login(
                        &window_app,
                        false,
                        format!("无法打开登录页面：{error}；{open_error}"),
                        None,
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
            html_response(request, 404, "页面不存在", "请回到 Codex Switch 继续操作。");
            continue;
        }
        let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
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
            emit_login(&app, false, format!("登录失败：{description}"), None);
            break;
        }
        let Some(code) = params.get("code").filter(|value| !value.is_empty()) else {
            html_response(request, 400, "登录未完成", "授权响应中缺少 code。");
            emit_login(&app, false, "登录失败：授权响应缺少 code", None);
            break;
        };
        let client = match Client::builder().timeout(Duration::from_secs(25)).build() {
            Ok(client) => client,
            Err(error) => {
                html_response(request, 500, "登录失败", "无法创建安全网络连接。");
                emit_login(&app, false, format!("登录失败：{error}"), None);
                break;
            }
        };
        match exchange_code(&client, port, code, &verifier)
            .and_then(|tokens| persist_login(&app, tokens))
        {
            Ok(account_id) => {
                html_response(
                    request,
                    200,
                    "登录成功",
                    "账户已保存。请回到 Codex Switch 手动切换到此账户。",
                );
                emit_login(
                    &app,
                    true,
                    "登录成功，账户已保存，可手动切换",
                    Some(account_id),
                );
                let _ = app.emit("accounts-changed", ());
                crate::system_tray::refresh_menu(&app);
                thread::sleep(Duration::from_millis(850));
                if let Some(window) = app.get_webview_window("codex-login") {
                    let _ = window.close();
                }
                break;
            }
            Err(error) => {
                html_response(request, 500, "登录失败", &error);
                emit_login(&app, false, error, None);
                break;
            }
        }
    }
}

fn persist_login<R: Runtime>(app: &tauri::AppHandle<R>, tokens: Value) -> Result<String, String> {
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
    import_value(app, auth, false)
}

#[tauri::command]
pub(crate) fn start_login<R: Runtime + 'static>(
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
                emit_login(&window_app, false, error, None);
            }
        });
    } else if let Err(error) = open_login_in_default_browser(&app, &url) {
        cancel.store(true, Ordering::Relaxed);
        return Err(error);
    }
    Ok(LoginStart { url, embedded })
}
