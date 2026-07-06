use std::{
    io::{self, BufRead, BufReader, Read},
    sync::{Arc, Mutex, OnceLock},
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::blocking::{Client, Response as ReqwestResponse};
use serde_json::{json, Value};
use tauri::{Emitter, Runtime};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::{
    auth::{account_fields, token_string, validate_auth},
    codex_api::{refresh_tokens, token_expiring, ORIGINATOR},
    models::{LocalProxyStatus, ProviderApiFormat, ProviderProfile},
    providers::{self, LOCAL_PROXY_BASE_URL, LOCAL_PROXY_HOST, LOCAL_PROXY_PORT},
    storage::{
        managed_auth_path, read_json, read_state, resolve_paths, write_json_atomic,
        write_managed_auth_if_changed, write_state,
    },
};

const OFFICIAL_CODEX_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(600);
const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

struct ProxyRuntime {
    server: Arc<Server>,
    handle: Option<JoinHandle<()>>,
}

struct UpstreamPayload {
    status: u16,
    content_type: Option<String>,
    body: UpstreamBody,
}

enum UpstreamBody {
    Buffered(Vec<u8>),
    Streaming(Box<dyn Read + Send>),
}

enum ActiveTarget {
    Official,
    Provider(ProviderProfile),
}

static RUNTIME: OnceLock<Mutex<Option<ProxyRuntime>>> = OnceLock::new();

fn runtime() -> &'static Mutex<Option<ProxyRuntime>> {
    RUNTIME.get_or_init(|| Mutex::new(None))
}

pub(crate) fn is_running() -> bool {
    runtime()
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

fn status() -> LocalProxyStatus {
    LocalProxyStatus {
        running: is_running(),
        address: LOCAL_PROXY_HOST.to_string(),
        port: LOCAL_PROXY_PORT,
        base_url: LOCAL_PROXY_BASE_URL.to_string(),
    }
}

#[tauri::command]
pub(crate) fn get_local_proxy_status() -> Result<LocalProxyStatus, String> {
    Ok(status())
}

#[tauri::command]
pub(crate) fn start_local_proxy<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    let started = start_server(app.clone())?;
    if let Err(error) = providers::apply_local_proxy_config_for_state(&app) {
        if started {
            stop_server();
        }
        return Err(error);
    }
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status())
}

#[tauri::command]
pub(crate) fn stop_local_proxy<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    stop_server();
    let paths = resolve_paths(&app)?;
    providers::restore_official_config(&paths)?;
    let mut state = read_state(&paths);
    state.active_provider_id = None;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status())
}

fn start_server<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let mut guard = runtime()
        .lock()
        .map_err(|_| "Local proxy runtime lock is poisoned".to_string())?;
    if guard.is_some() {
        return Ok(false);
    }

    let bind_addr = format!("{LOCAL_PROXY_HOST}:{LOCAL_PROXY_PORT}");
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
    if *method == Method::Get && path == "/health" {
        return Ok(json_payload(200, json!({ "status": "ok" })));
    }
    if *method == Method::Get && matches!(path, "/models" | "/v1/models") {
        return Ok(json_payload(200, models_response(app)?));
    }

    let target = active_target(app)?;
    match target {
        ActiveTarget::Official => forward_official(app, method, url, headers, body),
        ActiveTarget::Provider(provider) => {
            if is_responses_endpoint(path) && provider.api_format == ProviderApiFormat::OpenaiChat {
                forward_chat_bridge(method, url, headers, body, &provider)
            } else {
                forward_provider(method, url, headers, body, &provider)
            }
        }
    }
}

fn active_target<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<ActiveTarget, String> {
    let paths = resolve_paths(app)?;
    if let Some(id) = read_state(&paths).active_provider_id {
        let provider = providers::read_provider(&paths, &id)?;
        providers::ensure_not_local_proxy_base_url(&provider.base_url)?;
        return Ok(ActiveTarget::Provider(provider));
    }
    Ok(ActiveTarget::Official)
}

fn models_response<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Value, String> {
    let models = match active_target(app)? {
        ActiveTarget::Provider(provider) => provider_models_for_codex(&provider),
        ActiveTarget::Official => vec!["gpt-5-codex".to_string()],
    };
    let data = models
        .iter()
        .map(|model| json!({ "id": model, "object": "model" }))
        .collect::<Vec<_>>();
    let catalog = models
        .iter()
        .map(|model| {
            json!({
                "slug": model,
                "display_name": model,
                "description": model,
                "context_window": 128000,
                "max_context_window": 128000
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "object": "list",
        "data": data,
        "models": catalog
    }))
}

fn forward_official<R: Runtime>(
    app: &tauri::AppHandle<R>,
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
) -> Result<UpstreamPayload, String> {
    let client = http_client()?;
    let (access_token, account_id) = official_token(app, &client)?;
    let upstream_url = official_url(url);
    let mut request = client
        .request(reqwest_method(method)?, upstream_url)
        .bearer_auth(access_token)
        .header("originator", ORIGINATOR)
        .header("User-Agent", "codex_cli_rs/0.1.0");
    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }
    request = apply_forward_headers(request, headers, true);
    stream_response(
        request
            .body(body)
            .send()
            .map_err(|error| format!("Official Codex proxy request failed: {error}"))?,
    )
}

fn forward_provider(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    let client = http_client()?;
    let upstream_url = build_upstream_url(&provider.base_url, url);
    let body = provider_body_for_upstream(method, url, body, provider);
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
    let chat_body = responses_to_chat_completions(&responses_body);
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
    if stream && status_ok(status) && is_event_stream(content_type.as_deref()) {
        return Ok(UpstreamPayload {
            status,
            content_type: Some("text/event-stream; charset=utf-8".to_string()),
            body: UpstreamBody::Streaming(Box::new(ChatSseReader::new(
                BufReader::new(response),
                selected_model,
            ))),
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
            body: UpstreamBody::Buffered(body.to_vec()),
        });
    }

    let json: Value = serde_json::from_slice(&body)
        .map_err(|_| "Chat bridge upstream returned non-JSON response".to_string())?;
    Ok(json_payload(status, chat_to_responses_json(&json)))
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

fn official_token<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
) -> Result<(String, Option<String>), String> {
    let paths = resolve_paths(app)?;
    let mut auth = read_json(&paths.current_auth)?;
    validate_auth(&auth)?;
    if token_expiring(&auth) {
        refresh_tokens(client, &mut auth)?;
        write_json_atomic(&paths.current_auth, &auth)?;
        if let Ok((_, _, _, id)) = account_fields(&auth) {
            let _ = write_managed_auth_if_changed(&paths, &id, &auth);
        }
    }
    let access_token = token_string(&auth, "access_token")
        .ok_or_else(|| "auth.json is missing tokens.access_token".to_string())?
        .to_string();
    let (_, _, account_id, id) = account_fields(&auth)?;
    if !managed_auth_path(&paths, &id).exists() {
        let _ = write_managed_auth_if_changed(&paths, &id, &auth);
    }
    Ok((access_token, account_id))
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
    ) || (skip_auth
        && matches!(
            name,
            "authorization" | "x-api-key" | "openai-api-key" | "api-key"
        ))
}

fn http_client() -> Result<Client, String> {
    Client::builder()
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
    Ok(UpstreamPayload {
        status,
        content_type,
        body: UpstreamBody::Streaming(Box::new(response)),
    })
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

fn is_responses_endpoint(path: &str) -> bool {
    matches!(
        path,
        "/responses" | "/v1/responses" | "/responses/compact" | "/v1/responses/compact"
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
        body: UpstreamBody::Buffered(serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec())),
    }
}

fn respond_payload(request: Request, payload: UpstreamPayload) {
    match payload.body {
        UpstreamBody::Buffered(body) => {
            let mut response =
                Response::from_data(body).with_status_code(StatusCode(payload.status));
            add_content_type(&mut response, payload.content_type.as_deref());
            let _ = request.respond(response);
        }
        UpstreamBody::Streaming(reader) => {
            let mut response =
                Response::new(StatusCode(payload.status), Vec::new(), reader, None, None);
            add_content_type(&mut response, payload.content_type.as_deref());
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

fn respond_error(request: Request, status: u16, message: String) {
    respond_payload(
        request,
        json_payload(status, json!({ "error": { "message": message } })),
    );
}

fn responses_to_chat_completions(body: &Value) -> Value {
    let mut messages = Vec::new();
    if let Some(instructions) = body.get("instructions").and_then(value_to_text) {
        if !instructions.trim().is_empty() {
            messages.push(json!({ "role": "system", "content": instructions }));
        }
    }
    if let Some(input) = body.get("input") {
        append_input_messages(input, &mut messages);
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
        "tool_choice",
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
    if let Some(tools) = body.get("tools").and_then(Value::as_array) {
        let tools = tools
            .iter()
            .filter_map(responses_tool_to_chat_tool)
            .collect::<Vec<_>>();
        if !tools.is_empty() {
            result["tools"] = Value::Array(tools);
        }
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

fn append_input_messages(input: &Value, messages: &mut Vec<Value>) {
    match input {
        Value::String(text) => messages.push(json!({ "role": "user", "content": text })),
        Value::Array(items) => {
            for item in items {
                append_input_messages(item, messages);
            }
        }
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("function_call_output") {
                if let Some(text) = map.get("output").and_then(value_to_text) {
                    messages.push(json!({ "role": "tool", "content": text }));
                }
                return;
            }
            let role = map
                .get("role")
                .and_then(Value::as_str)
                .map(normalize_chat_role)
                .unwrap_or("user");
            if let Some(content) = map.get("content").and_then(value_to_text) {
                messages.push(json!({ "role": role, "content": content }));
            }
        }
        _ => {}
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

fn responses_tool_to_chat_tool(tool: &Value) -> Option<Value> {
    let tool_type = tool.get("type").and_then(Value::as_str)?;
    match tool_type {
        "function" => {
            let name = tool.get("name").and_then(Value::as_str)?;
            Some(json!({
                "type": "function",
                "function": {
                    "name": name,
                    "description": tool.get("description").cloned().unwrap_or_else(|| json!("")),
                    "parameters": tool.get("parameters").or_else(|| tool.get("input_schema")).cloned().unwrap_or_else(|| json!({ "type": "object" }))
                }
            }))
        }
        "custom" => {
            let name = tool.get("name").and_then(Value::as_str)?;
            Some(json!({
                "type": "function",
                "function": {
                    "name": name,
                    "description": tool.get("description").cloned().unwrap_or_else(|| json!("Custom tool input")),
                    "parameters": {
                        "type": "object",
                        "properties": { "input": { "type": "string" } },
                        "required": ["input"]
                    }
                }
            }))
        }
        _ => None,
    }
}

fn chat_to_responses_json(chat: &Value) -> Value {
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
        for call in tool_calls {
            output.push(json!({
                "id": call.get("id").cloned().unwrap_or_else(|| json!(response_id())),
                "type": "function_call",
                "status": "completed",
                "call_id": call.get("id").cloned().unwrap_or_else(|| json!(response_id())),
                "name": call.pointer("/function/name").cloned().unwrap_or_else(|| json!("tool")),
                "arguments": call.pointer("/function/arguments").cloned().unwrap_or_else(|| json!("{}"))
            }));
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

struct ChatSseReader<R> {
    upstream: R,
    model: String,
    response_id: String,
    message_id: String,
    pending: Vec<u8>,
    pending_offset: usize,
    data_lines: Vec<String>,
    text: String,
    completed: bool,
}

impl<R: BufRead> ChatSseReader<R> {
    fn new(upstream: R, model: String) -> Self {
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
        if let Some(delta) = chat_stream_delta_text(&value) {
            if !delta.is_empty() {
                self.text.push_str(delta);
                self.push_pending(response_text_delta_sse(&self.message_id, delta));
            }
        }
    }

    fn finish(&mut self) {
        if self.completed {
            return;
        }
        self.push_pending(response_done_sse(
            &self.response_id,
            &self.message_id,
            &self.model,
            &self.text,
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

    output.push_str(&response_done_sse(&response_id, &message_id, model, &text));
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

fn response_done_sse(response_id: &str, message_id: &str, model: &str, text: &str) -> String {
    let mut output = String::new();
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
            "item": {
                "id": message_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{ "type": "output_text", "text": text, "annotations": [] }]
            }
        }),
    );
    push_sse(
        &mut output,
        "response.completed",
        json!({
            "type": "response.completed",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": unix_now(),
                "status": "completed",
                "model": model,
                "output": [{
                    "id": message_id,
                    "type": "message",
                    "status": "completed",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": text, "annotations": [] }]
                }]
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read};
    use std::sync::mpsc;

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
    fn chat_sse_reader_emits_incremental_response_events() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" done\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let mut reader = ChatSseReader::new(
            BufReader::new(Cursor::new(sse.as_bytes().to_vec())),
            "deepseek-chat".to_string(),
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
