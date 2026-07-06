use std::{fs, path::PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Runtime};
use url::Url;

use crate::{
    auth::validate_auth,
    models::{ProviderApiFormat, ProviderProfile, ProviderSummary},
    storage::{
        read_json, read_state, resolve_paths, sync_current_into_store, write_json_atomic,
        write_state, write_text_atomic, Paths,
    },
};

const PROVIDER_ROOT_START: &str = "# Codex Switch provider start";
const PROVIDER_ROOT_END: &str = "# Codex Switch provider end";
const PROVIDER_TABLE_START: &str = "# Codex Switch custom provider start";
const PROVIDER_TABLE_END: &str = "# Codex Switch custom provider end";
pub(crate) const LOCAL_PROXY_HOST: &str = "127.0.0.1";
pub(crate) const LOCAL_PROXY_PORT: u16 = 15722;
pub(crate) const LOCAL_PROXY_BASE_URL: &str = "http://127.0.0.1:15722/v1";
pub(crate) const LOCAL_PROXY_TOKEN: &str = "CODEX_SWITCH_LOCAL_PROXY";
const LOCAL_PROXY_PROVIDER_ID: &str = "codex-switch-local";
const LOCAL_PROXY_PROVIDER_NAME: &str = "Codex Switch Local Proxy";
const DEFAULT_OFFICIAL_MODEL: &str = "gpt-5-codex";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderInput {
    id: Option<String>,
    name: String,
    base_url: String,
    api_key: Option<String>,
    model: String,
    api_format: ProviderApiFormat,
}

#[tauri::command]
pub(crate) fn list_providers<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<ProviderSummary>, String> {
    let paths = resolve_paths(&app)?;
    let active_provider_id = read_state(&paths).active_provider_id;
    fs::create_dir_all(&paths.providers)
        .map_err(|error| format!("Failed to create provider store: {error}"))?;

    let mut providers = Vec::new();
    for entry in fs::read_dir(&paths.providers)
        .map_err(|error| format!("Failed to read provider store: {error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let provider = read_provider_file(entry.path())?;
        providers.push(provider_summary(
            &provider,
            active_provider_id.as_deref() == Some(&provider.id),
        ));
    }
    providers.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(providers)
}

#[tauri::command]
pub(crate) fn save_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    provider: ProviderInput,
) -> Result<ProviderSummary, String> {
    let paths = resolve_paths(&app)?;
    fs::create_dir_all(&paths.providers)
        .map_err(|error| format!("Failed to create provider store: {error}"))?;

    let existing = match provider.id.as_deref() {
        Some(id) => Some(read_provider(&paths, id)?),
        None => None,
    };
    let id = match provider.id {
        Some(id) => {
            validate_provider_id(&id)?;
            id
        }
        None => unique_provider_id(&paths, &provider.name, &provider.base_url, &provider.model),
    };
    let name = require_non_empty("Provider name", &provider.name)?;
    let base_url = normalize_base_url(&provider.base_url)?;
    let model = require_non_empty("Model", &provider.model)?;
    let supplied_key = provider.api_key.unwrap_or_default().trim().to_string();
    let api_key = if supplied_key.is_empty() {
        existing
            .as_ref()
            .map(|value| value.api_key.clone())
            .unwrap_or_default()
    } else {
        supplied_key
    };
    if api_key.is_empty() {
        return Err("API key is required for a new provider".to_string());
    }

    let profile = ProviderProfile {
        id,
        name,
        base_url,
        api_key,
        model,
        api_format: provider.api_format,
    };
    write_provider(&paths, &profile)?;

    let active_provider_id = read_state(&paths).active_provider_id;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(provider_summary(
        &profile,
        active_provider_id.as_deref() == Some(&profile.id),
    ))
}

#[tauri::command]
pub(crate) fn switch_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let _ = sync_current_into_store(&app);
    let paths = resolve_paths(&app)?;
    let provider = read_provider(&paths, &id)?;
    ensure_not_local_proxy_base_url(&provider.base_url)?;
    let proxy_running = crate::local_proxy::is_running();
    if !proxy_running && provider.api_format != ProviderApiFormat::OpenaiResponses {
        return Err(
            "Chat Completions providers need a local Responses bridge. This build supports direct Responses-compatible providers only."
                .to_string(),
        );
    }
    if provider.api_key.trim().is_empty() {
        return Err("Provider API key is empty".to_string());
    }

    let mut state = read_state(&paths);
    backup_codex_config_if_needed(&paths, state.active_provider_id.is_none())?;
    if proxy_running {
        write_provider_local_proxy_config(&paths, &provider)?;
    } else {
        write_provider_config(&paths, &provider)?;
    }
    state.active_provider_id = Some(provider.id);
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn disable_provider<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let mut state = read_state(&paths);
    if crate::local_proxy::is_running() {
        backup_codex_config_if_needed(&paths, state.active_provider_id.is_none())?;
        write_official_local_proxy_config(&paths)?;
    } else {
        restore_official_config(&paths)?;
    }
    state.active_provider_id = None;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    validate_provider_id(&id)?;
    let mut state = read_state(&paths);
    if state.active_provider_id.as_deref() == Some(&id) {
        if crate::local_proxy::is_running() {
            write_official_local_proxy_config(&paths)?;
        } else {
            restore_official_config(&paths)?;
        }
        state.active_provider_id = None;
        write_state(&paths, &state)?;
    }
    let path = provider_path(&paths, &id);
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("Failed to delete provider: {error}"))?;
    }
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn apply_local_proxy_config_for_state<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    backup_codex_config_if_needed(&paths, state.active_provider_id.is_none())?;
    if let Some(id) = state.active_provider_id.as_deref() {
        let provider = read_provider(&paths, id)?;
        ensure_not_local_proxy_base_url(&provider.base_url)?;
        write_provider_local_proxy_config(&paths, &provider)
    } else {
        ensure_official_auth_for_local_proxy(&paths)?;
        write_official_local_proxy_config(&paths)
    }
}

pub(crate) fn cleanup_stale_local_proxy_config<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    if !paths.current_config.exists() {
        return Ok(());
    }
    let current = fs::read_to_string(&paths.current_config)
        .map_err(|error| format!("Failed to read Codex config: {error}"))?;
    if !config_contains_local_proxy(&current) {
        return Ok(());
    }
    restore_official_config(&paths)?;
    let mut state = read_state(&paths);
    state.active_provider_id = None;
    write_state(&paths, &state)
}

pub(crate) fn restore_official_config(paths: &Paths) -> Result<(), String> {
    if paths.config_backup.exists() {
        let backup = fs::read_to_string(&paths.config_backup)
            .map_err(|error| format!("Failed to read Codex config backup: {error}"))?;
        if backup.is_empty() {
            if paths.current_config.exists() {
                fs::remove_file(&paths.current_config)
                    .map_err(|error| format!("Failed to remove managed Codex config: {error}"))?;
            }
        } else {
            write_text_atomic(&paths.current_config, &backup)?;
        }
        fs::remove_file(&paths.config_backup)
            .map_err(|error| format!("Failed to clear Codex config backup: {error}"))?;
        return Ok(());
    }

    if paths.current_config.exists() {
        let current = fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?;
        let cleaned = remove_marked_blocks(&current);
        if cleaned.trim().is_empty() {
            fs::remove_file(&paths.current_config)
                .map_err(|error| format!("Failed to remove managed Codex config: {error}"))?;
        } else if cleaned != current {
            write_text_atomic(&paths.current_config, &cleaned)?;
        }
    }
    Ok(())
}

fn provider_path(paths: &Paths, id: &str) -> PathBuf {
    paths.providers.join(format!("{id}.json"))
}

pub(crate) fn read_provider(paths: &Paths, id: &str) -> Result<ProviderProfile, String> {
    validate_provider_id(id)?;
    read_provider_file(provider_path(paths, id))
}

fn read_provider_file(path: PathBuf) -> Result<ProviderProfile, String> {
    let value = read_json(&path)?;
    serde_json::from_value(value)
        .map_err(|error| format!("Provider profile {} is invalid: {error}", path.display()))
}

fn write_provider(paths: &Paths, provider: &ProviderProfile) -> Result<(), String> {
    let value = serde_json::to_value(provider).map_err(|error| error.to_string())?;
    write_json_atomic(&provider_path(paths, &provider.id), &value)
}

fn provider_summary(provider: &ProviderProfile, active: bool) -> ProviderSummary {
    ProviderSummary {
        id: provider.id.clone(),
        name: provider.name.clone(),
        base_url: provider.base_url.clone(),
        model: provider.model.clone(),
        api_format: provider.api_format,
        active,
        has_api_key: !provider.api_key.trim().is_empty(),
        supports_direct_switch: provider.api_format == ProviderApiFormat::OpenaiResponses
            || crate::local_proxy::is_running(),
    }
}

fn require_non_empty(label: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(trimmed.to_string())
    }
}

fn normalize_base_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL is required".to_string());
    }
    let url = Url::parse(trimmed).map_err(|error| format!("Base URL is invalid: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Base URL must be an http:// or https:// URL with a host".to_string());
    }
    if is_local_proxy_url(&url) {
        return Err("Provider Base URL must be an upstream API endpoint, not the Codex Switch local proxy endpoint".to_string());
    }
    Ok(trimmed.to_string())
}

pub(crate) fn ensure_not_local_proxy_base_url(base_url: &str) -> Result<(), String> {
    let url = Url::parse(base_url).map_err(|error| format!("Base URL is invalid: {error}"))?;
    if is_local_proxy_url(&url) {
        Err("Provider Base URL must be an upstream API endpoint, not the Codex Switch local proxy endpoint".to_string())
    } else {
        Ok(())
    }
}

fn is_local_proxy_url(url: &Url) -> bool {
    if url.scheme() != "http" {
        return false;
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    matches!(host.as_str(), LOCAL_PROXY_HOST | "localhost" | "::1")
        && url.port_or_known_default() == Some(LOCAL_PROXY_PORT)
}

fn ensure_official_auth_for_local_proxy(paths: &Paths) -> Result<(), String> {
    let auth = read_json(&paths.current_auth)?;
    validate_auth(&auth).map_err(|error| {
        format!(
            "Official Codex local proxy requires a ChatGPT auth.json with tokens.access_token. Activate a third-party Provider or switch to a signed-in official Codex account before starting proxy: {error}"
        )
    })
}

fn validate_provider_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Provider id is invalid".to_string());
    }
    Ok(())
}

fn unique_provider_id(paths: &Paths, name: &str, base_url: &str, model: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(name.trim().to_lowercase().as_bytes());
    hasher.update(b"\0");
    hasher.update(base_url.trim().to_lowercase().as_bytes());
    hasher.update(b"\0");
    hasher.update(model.trim().as_bytes());
    let digest = hasher.finalize();
    let base = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let mut id = base.clone();
    let mut suffix = 2;
    while provider_path(paths, &id).exists() {
        id = format!("{base}-{suffix}");
        suffix += 1;
    }
    id
}

fn backup_codex_config_if_needed(paths: &Paths, entering_provider: bool) -> Result<(), String> {
    if !entering_provider || paths.config_backup.exists() {
        return Ok(());
    }
    let backup = if paths.current_config.exists() {
        fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?
    } else {
        String::new()
    };
    write_text_atomic(&paths.config_backup, &backup)
}

fn write_provider_config(paths: &Paths, provider: &ProviderProfile) -> Result<(), String> {
    let existing = if paths.current_config.exists() {
        fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?
    } else {
        String::new()
    };
    let merged = merge_provider_config(&existing, provider);
    write_text_atomic(&paths.current_config, &merged)
}

pub(crate) fn write_official_local_proxy_config(paths: &Paths) -> Result<(), String> {
    let model = preferred_official_model(paths);
    write_local_proxy_config(paths, LOCAL_PROXY_PROVIDER_NAME, Some(&model))
}

fn write_provider_local_proxy_config(
    paths: &Paths,
    provider: &ProviderProfile,
) -> Result<(), String> {
    write_local_proxy_config(paths, &provider.name, Some(&provider.model))
}

fn write_local_proxy_config(paths: &Paths, name: &str, model: Option<&str>) -> Result<(), String> {
    let existing = if paths.current_config.exists() {
        fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?
    } else {
        String::new()
    };
    let merged = merge_local_proxy_config(&existing, name, model);
    write_text_atomic(&paths.current_config, &merged)
}

fn merge_provider_config(existing: &str, provider: &ProviderProfile) -> String {
    let cleaned = remove_provider_conflicts(&remove_marked_blocks(existing));
    let mut config = String::new();
    config.push_str(PROVIDER_ROOT_START);
    config.push('\n');
    config.push_str("model_provider = \"custom\"\n");
    config.push_str(&format!("model = {}\n", toml_string(&provider.model)));
    config.push_str("disable_response_storage = true\n");
    config.push_str(PROVIDER_ROOT_END);
    config.push_str("\n\n");

    let cleaned = cleaned.trim();
    if !cleaned.is_empty() {
        config.push_str(cleaned);
        config.push_str("\n\n");
    }

    config.push_str(PROVIDER_TABLE_START);
    config.push('\n');
    config.push_str("[model_providers.custom]\n");
    config.push_str(&format!("name = {}\n", toml_string(&provider.name)));
    config.push_str(&format!("base_url = {}\n", toml_string(&provider.base_url)));
    config.push_str("wire_api = \"responses\"\n");
    config.push_str("requires_openai_auth = true\n");
    config.push_str(&format!(
        "experimental_bearer_token = {}\n",
        toml_string(&provider.api_key)
    ));
    config.push_str(PROVIDER_TABLE_END);
    config.push('\n');
    config
}

fn merge_local_proxy_config(existing: &str, name: &str, model: Option<&str>) -> String {
    let cleaned = remove_provider_conflicts(&remove_marked_blocks(existing));
    let model = model.map(str::trim).filter(|value| !value.is_empty());
    let mut config = String::new();
    config.push_str(PROVIDER_ROOT_START);
    config.push('\n');
    config.push_str(&format!(
        "model_provider = {}\n",
        toml_string(LOCAL_PROXY_PROVIDER_ID)
    ));
    if let Some(model) = model {
        config.push_str(&format!("model = {}\n", toml_string(model)));
    }
    config.push_str("disable_response_storage = true\n");
    config.push_str(PROVIDER_ROOT_END);
    config.push_str("\n\n");

    let cleaned = cleaned.trim();
    if !cleaned.is_empty() {
        config.push_str(cleaned);
        config.push_str("\n\n");
    }

    config.push_str(PROVIDER_TABLE_START);
    config.push('\n');
    config.push_str(&format!("[model_providers.{LOCAL_PROXY_PROVIDER_ID}]\n"));
    config.push_str(&format!("name = {}\n", toml_string(name)));
    config.push_str(&format!(
        "base_url = {}\n",
        toml_string(LOCAL_PROXY_BASE_URL)
    ));
    config.push_str("wire_api = \"responses\"\n");
    config.push_str("requires_openai_auth = true\n");
    config.push_str(&format!(
        "experimental_bearer_token = {}\n",
        toml_string(LOCAL_PROXY_TOKEN)
    ));
    config.push_str(PROVIDER_TABLE_END);
    config.push('\n');
    config
}

fn remove_marked_blocks(config: &str) -> String {
    let mut output = Vec::new();
    let mut skipping = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed == PROVIDER_ROOT_START || trimmed == PROVIDER_TABLE_START {
            skipping = true;
            continue;
        }
        if skipping && (trimmed == PROVIDER_ROOT_END || trimmed == PROVIDER_TABLE_END) {
            skipping = false;
            continue;
        }
        if !skipping {
            output.push(line);
        }
    }
    output.join("\n")
}

fn remove_provider_conflicts(config: &str) -> String {
    let mut output = Vec::new();
    let mut in_root = true;
    let mut removing_custom_provider = false;
    let local_proxy_provider_header = format!("[model_providers.{LOCAL_PROXY_PROVIDER_ID}]");

    for line in config.lines() {
        let trimmed = line.trim();
        if removing_custom_provider {
            if is_table_header(trimmed) {
                removing_custom_provider = false;
            } else {
                continue;
            }
        }

        if is_table_header(trimmed) {
            in_root = false;
            if trimmed == "[model_providers.custom]"
                || trimmed == local_proxy_provider_header.as_str()
            {
                removing_custom_provider = true;
                continue;
            }
            output.push(line);
            continue;
        }

        if in_root && is_provider_root_key(trimmed) {
            continue;
        }
        output.push(line);
    }

    output.join("\n")
}

fn config_contains_local_proxy(config: &str) -> bool {
    config.contains(LOCAL_PROXY_BASE_URL)
        || config.contains(LOCAL_PROXY_TOKEN)
        || config.contains(&format!("[model_providers.{LOCAL_PROXY_PROVIDER_ID}]"))
}

fn preferred_official_model(paths: &Paths) -> String {
    [
        paths.current_config.as_path(),
        paths.config_backup.as_path(),
    ]
    .into_iter()
    .filter_map(|path| fs::read_to_string(path).ok())
    .find_map(|config| extract_root_model(&config))
    .unwrap_or_else(|| DEFAULT_OFFICIAL_MODEL.to_string())
}

fn extract_root_model(config: &str) -> Option<String> {
    let mut in_root = true;
    for line in config.lines() {
        let trimmed = line.trim();
        if is_table_header(trimmed) {
            in_root = false;
            continue;
        }
        if !in_root || !trimmed.starts_with("model") {
            continue;
        }
        let Some(rest) = trimmed.strip_prefix("model") else {
            continue;
        };
        let rest = rest.trim_start();
        if !rest.starts_with('=') {
            continue;
        }
        let value = rest[1..].trim();
        return parse_toml_string_literal(value);
    }
    None
}

fn parse_toml_string_literal(value: &str) -> Option<String> {
    let quote = value.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let mut escaped = false;
    let mut output = String::new();
    for ch in value[quote.len_utf8()..].chars() {
        if quote == '"' && escaped {
            let decoded = match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '"' => '"',
                '\\' => '\\',
                other => other,
            };
            output.push(decoded);
            escaped = false;
            continue;
        }
        if quote == '"' && ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == quote {
            return Some(output);
        }
        output.push(ch);
    }
    None
}

fn is_table_header(value: &str) -> bool {
    value.starts_with('[') && value.ends_with(']')
}

fn is_provider_root_key(value: &str) -> bool {
    [
        "model_provider",
        "model",
        "disable_response_storage",
        "model_catalog_json",
    ]
    .iter()
    .any(|key| value.starts_with(key) && value[key.len()..].trim_start().starts_with('='))
}

fn toml_string(value: &str) -> String {
    let mut output = String::from("\"");
    for ch in value.chars() {
        match ch {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            ch if ch.is_control() => {
                let code = ch as u32;
                if code <= 0xFFFF {
                    output.push_str(&format!("\\u{code:04X}"));
                } else {
                    output.push_str(&format!("\\U{code:08X}"));
                }
            }
            ch => output.push(ch),
        }
    }
    output.push('"');
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider() -> ProviderProfile {
        ProviderProfile {
            id: "p".to_string(),
            name: "Gateway".to_string(),
            base_url: "https://gateway.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4.1".to_string(),
            api_format: ProviderApiFormat::OpenaiResponses,
        }
    }

    #[test]
    fn local_proxy_config_points_codex_to_local_responses() {
        let merged = merge_local_proxy_config("model = \"old\"", "Proxy", Some("deepseek-chat"));
        assert!(merged.contains("model_provider = \"codex-switch-local\""));
        assert!(merged.contains("model = \"deepseek-chat\""));
        assert!(merged.contains("base_url = \"http://127.0.0.1:15722/v1\""));
        assert!(merged.contains("experimental_bearer_token = \"CODEX_SWITCH_LOCAL_PROXY\""));
        assert!(!merged.contains("model = \"old\""));
    }

    #[test]
    fn provider_config_replaces_conflicting_root_keys_and_custom_provider() {
        let existing = r#"
model = "old"
approval_policy = "on-request"

[model_providers.custom]
base_url = "https://old.example.com"

[profiles.default]
sandbox_mode = "workspace-write"
"#;

        let merged = merge_provider_config(existing, &provider());
        assert!(merged.contains("model_provider = \"custom\""));
        assert!(merged.contains("model = \"gpt-4.1\""));
        assert!(merged.contains("approval_policy = \"on-request\""));
        assert!(merged.contains("[profiles.default]"));
        assert!(!merged.contains("https://old.example.com"));
    }

    #[test]
    fn toml_string_escapes_secret_characters() {
        assert_eq!(toml_string("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }

    #[test]
    fn provider_base_url_rejects_local_proxy_endpoint() {
        assert!(normalize_base_url("http://127.0.0.1:15722/v1")
            .unwrap_err()
            .contains("local proxy"));
        assert!(normalize_base_url("http://localhost:15722/v1")
            .unwrap_err()
            .contains("local proxy"));
        assert!(normalize_base_url("https://api.deepseek.com/v1").is_ok());
    }
}
