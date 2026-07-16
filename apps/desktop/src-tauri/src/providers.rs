use std::{fs, path::PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};
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
pub(crate) const DEFAULT_OFFICIAL_MODEL: &str = "gpt-5-codex";
const MODEL_CATALOG_FILENAME: &str = "codex-switch-model-catalog.json";
const DEFAULT_MODEL_CONTEXT_WINDOW: u64 = 128_000;

fn emit_providers_changed<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(app);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderInput {
    id: Option<String>,
    name: String,
    base_url: String,
    api_key: Option<String>,
    model: String,
    #[serde(default)]
    models: Vec<String>,
    #[serde(default)]
    model_selection_controlled_by_codex: bool,
    api_format: ProviderApiFormat,
}

#[tauri::command]
pub(crate) fn list_providers<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<ProviderSummary>, String> {
    let paths = resolve_paths(&app)?;
    let active_provider_id = read_state(&paths).active_provider_id;
    let mut providers = list_provider_profiles(&paths)?
        .into_iter()
        .map(|provider| {
            provider_summary(
                &provider,
                active_provider_id.as_deref() == Some(&provider.id),
            )
        })
        .collect::<Vec<_>>();
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
    let (model, models) = normalize_model_selection(&provider.model, provider.models)?;
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
        models,
        model_selection_controlled_by_codex: provider.model_selection_controlled_by_codex,
        api_format: provider.api_format,
    };
    write_provider(&paths, &profile)?;

    let active_provider_id = read_state(&paths).active_provider_id;
    if active_provider_id.as_deref() == Some(&profile.id) {
        write_active_provider_config(&paths, &profile)?;
    }
    emit_providers_changed(&app)?;
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
    state.active_account_id = None;
    write_state(&paths, &state)?;
    emit_providers_changed(&app)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn switch_provider_model<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    model: String,
) -> Result<ProviderSummary, String> {
    let paths = resolve_paths(&app)?;
    let mut provider = read_provider(&paths, &id)?;
    let selected_model = require_non_empty("Model", &model)?;
    if !provider.models.iter().any(|value| value == &selected_model) {
        provider.models.push(selected_model.clone());
    }
    provider.model = selected_model;
    provider = normalize_provider_profile(provider)?;
    write_provider(&paths, &provider)?;

    let active_provider_id = read_state(&paths).active_provider_id;
    let active = active_provider_id.as_deref() == Some(&provider.id);
    if active {
        write_active_provider_config(&paths, &provider)?;
    }
    emit_providers_changed(&app)?;
    Ok(provider_summary(&provider, active))
}

#[tauri::command]
pub(crate) fn set_provider_model_control<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    controlled_by_codex: bool,
) -> Result<ProviderSummary, String> {
    let paths = resolve_paths(&app)?;
    let mut provider = read_provider(&paths, &id)?;
    provider.model_selection_controlled_by_codex = controlled_by_codex;
    write_provider(&paths, &provider)?;

    let active_provider_id = read_state(&paths).active_provider_id;
    let active = active_provider_id.as_deref() == Some(&provider.id);
    if active {
        write_active_provider_config(&paths, &provider)?;
    }
    emit_providers_changed(&app)?;
    Ok(provider_summary(&provider, active))
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
    emit_providers_changed(&app)?;
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
    emit_providers_changed(&app)?;
    Ok(())
}

pub(crate) fn apply_local_proxy_config_for_state<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    apply_local_proxy_config_for_paths(&paths)
}

pub(crate) fn apply_local_proxy_config_for_paths(paths: &Paths) -> Result<(), String> {
    let state = read_state(paths);
    backup_codex_config_if_needed(paths, state.active_provider_id.is_none())?;
    if let Some(id) = state.active_provider_id.as_deref() {
        let provider = read_provider(paths, id)?;
        ensure_not_local_proxy_base_url(&provider.base_url)?;
        write_provider_local_proxy_config(paths, &provider)
    } else {
        ensure_official_auth_for_local_proxy(paths)?;
        write_official_local_proxy_config(paths)
    }
}

pub(crate) fn activate_provider_for_sync(paths: &Paths, id: &str) -> Result<bool, String> {
    let provider = read_provider(paths, id)?;
    ensure_not_local_proxy_base_url(&provider.base_url)?;
    if provider.api_key.trim().is_empty() {
        return Ok(false);
    }
    let proxy_running = crate::local_proxy::is_running();
    if !proxy_running && provider.api_format != ProviderApiFormat::OpenaiResponses {
        return Ok(false);
    }

    let mut state = read_state(paths);
    backup_codex_config_if_needed(paths, state.active_provider_id.is_none())?;
    if proxy_running {
        write_provider_local_proxy_config(paths, &provider)?;
    } else {
        write_provider_config(paths, &provider)?;
    }
    state.active_provider_id = Some(provider.id);
    state.active_account_id = None;
    write_state(paths, &state)?;
    Ok(true)
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
    state.local_proxy_enabled = false;
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

pub(crate) fn list_provider_profiles(paths: &Paths) -> Result<Vec<ProviderProfile>, String> {
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
        providers.push(read_provider_file(entry.path())?);
    }
    providers.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(providers)
}

pub(crate) fn read_provider(paths: &Paths, id: &str) -> Result<ProviderProfile, String> {
    validate_provider_id(id)?;
    read_provider_file(provider_path(paths, id))
}

fn read_provider_file(path: PathBuf) -> Result<ProviderProfile, String> {
    let value = read_json(&path)?;
    let profile: ProviderProfile = serde_json::from_value(value)
        .map_err(|error| format!("Provider profile {} is invalid: {error}", path.display()))?;
    normalize_provider_profile(profile)
        .map_err(|error| format!("Provider profile {} is invalid: {error}", path.display()))
}

fn write_provider(paths: &Paths, provider: &ProviderProfile) -> Result<(), String> {
    let value = serde_json::to_value(provider).map_err(|error| error.to_string())?;
    write_json_atomic(&provider_path(paths, &provider.id), &value)
}

pub(crate) fn write_synced_provider(
    paths: &Paths,
    provider: ProviderProfile,
) -> Result<ProviderProfile, String> {
    let profile = normalize_synced_provider(provider)?;
    write_provider(paths, &profile)?;
    Ok(profile)
}

pub(crate) fn provider_modified_at(
    paths: &Paths,
    id: &str,
) -> Result<chrono::DateTime<chrono::Utc>, String> {
    let path = provider_path(paths, id);
    fs::metadata(&path)
        .and_then(|metadata| metadata.modified())
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map_err(|error| {
            format!(
                "Failed to read provider modified time {}: {error}",
                path.display()
            )
        })
}

fn provider_summary(provider: &ProviderProfile, active: bool) -> ProviderSummary {
    ProviderSummary {
        id: provider.id.clone(),
        name: provider.name.clone(),
        base_url: provider.base_url.clone(),
        model: provider.model.clone(),
        models: provider.models.clone(),
        model_selection_controlled_by_codex: provider.model_selection_controlled_by_codex,
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

fn normalize_model_selection(
    model: &str,
    models: Vec<String>,
) -> Result<(String, Vec<String>), String> {
    let selected = require_non_empty("Model", model)?;
    let mut normalized = Vec::new();
    push_model_once(&mut normalized, selected.clone());
    for model in models {
        push_model_once(&mut normalized, model);
    }
    Ok((selected, normalized))
}

fn normalize_provider_profile(mut provider: ProviderProfile) -> Result<ProviderProfile, String> {
    let (model, models) = normalize_model_selection(&provider.model, provider.models)?;
    provider.model = model;
    provider.models = models;
    Ok(provider)
}

fn normalize_synced_provider(mut provider: ProviderProfile) -> Result<ProviderProfile, String> {
    validate_provider_id(&provider.id)?;
    provider.name = require_non_empty("Provider name", &provider.name)?;
    provider.base_url = normalize_base_url(&provider.base_url)?;
    provider.api_key = provider.api_key.trim().to_string();
    if provider.api_key.is_empty() {
        return Err("Provider API key is empty".to_string());
    }
    normalize_provider_profile(provider)
}

fn push_model_once(models: &mut Vec<String>, model: String) {
    let trimmed = model.trim();
    if trimmed.is_empty() || models.iter().any(|value| value == trimmed) {
        return;
    }
    models.push(trimmed.to_string());
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
    if provider.model_selection_controlled_by_codex {
        write_provider_model_catalog(paths, provider)?;
    }
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
    write_local_proxy_config(paths, LOCAL_PROXY_PROVIDER_NAME, Some(&model), false)
}

fn write_provider_local_proxy_config(
    paths: &Paths,
    provider: &ProviderProfile,
) -> Result<(), String> {
    if provider.model_selection_controlled_by_codex {
        write_provider_model_catalog(paths, provider)?;
    }
    write_local_proxy_config(
        paths,
        &provider.name,
        Some(&provider.model),
        provider.model_selection_controlled_by_codex,
    )
}

fn write_active_provider_config(paths: &Paths, provider: &ProviderProfile) -> Result<(), String> {
    if crate::local_proxy::is_running() {
        write_provider_local_proxy_config(paths, provider)
    } else {
        write_provider_config(paths, provider)
    }
}

fn write_provider_model_catalog(paths: &Paths, provider: &ProviderProfile) -> Result<(), String> {
    let value = provider_model_catalog(provider);
    write_json_atomic(&paths.codex_home.join(MODEL_CATALOG_FILENAME), &value)
}

fn provider_model_catalog(provider: &ProviderProfile) -> Value {
    model_catalog_for_models(&provider.models)
}

pub(crate) fn model_catalog_for_models(models: &[String]) -> Value {
    let entries = models
        .iter()
        .enumerate()
        .map(|(index, model)| provider_model_catalog_entry(model, index))
        .collect::<Vec<_>>();
    json!({ "models": entries })
}

fn provider_model_catalog_entry(model: &str, index: usize) -> Value {
    json!({
        "slug": model,
        "display_name": model,
        "description": model,
        "base_instructions": "You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user's goals.",
        "default_reasoning_level": "high",
        "supported_reasoning_levels": [
            { "effort": "none", "description": "Disable Thinking" },
            { "effort": "high", "description": "Enabled Thinking" }
        ],
        "shell_type": "shell_command",
        "visibility": "list",
        "supported_in_api": true,
        "priority": 1000 + index,
        "supports_reasoning_summaries": true,
        "default_reasoning_summary": "none",
        "support_verbosity": false,
        "default_verbosity": null,
        "apply_patch_tool_type": null,
        "web_search_tool_type": "text",
        "truncation_policy": { "mode": "bytes", "limit": 10000 },
        "supports_parallel_tool_calls": false,
        "supports_image_detail_original": false,
        "context_window": DEFAULT_MODEL_CONTEXT_WINDOW,
        "max_context_window": DEFAULT_MODEL_CONTEXT_WINDOW,
        "auto_compact_token_limit": null,
        "comp_hash": null,
        "effective_context_window_percent": 95,
        "experimental_supported_tools": [],
        "input_modalities": ["text"],
        "supports_search_tool": false,
        "use_responses_lite": false,
        "auto_review_model_override": null,
        "tool_mode": null,
        "multi_agent_version": null,
        "additional_speed_tiers": [],
        "service_tiers": [],
        "default_service_tier": null,
        "availability_nux": null,
        "upgrade": null
    })
}

fn write_local_proxy_config(
    paths: &Paths,
    name: &str,
    model: Option<&str>,
    include_model_catalog: bool,
) -> Result<(), String> {
    let existing = if paths.current_config.exists() {
        fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?
    } else {
        String::new()
    };
    let merged = merge_local_proxy_config(&existing, name, model, include_model_catalog);
    write_text_atomic(&paths.current_config, &merged)
}

fn merge_provider_config(existing: &str, provider: &ProviderProfile) -> String {
    let cleaned = remove_provider_conflicts(&remove_marked_blocks(existing));
    let mut config = String::new();
    config.push_str(PROVIDER_ROOT_START);
    config.push('\n');
    config.push_str("model_provider = \"custom\"\n");
    config.push_str(&format!("model = {}\n", toml_string(&provider.model)));
    if provider.model_selection_controlled_by_codex {
        config.push_str(&format!(
            "model_catalog_json = {}\n",
            toml_string(MODEL_CATALOG_FILENAME)
        ));
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
    config.push_str("[model_providers.custom]\n");
    config.push_str(&format!("name = {}\n", toml_string(&provider.name)));
    config.push_str(&format!("base_url = {}\n", toml_string(&provider.base_url)));
    config.push_str("wire_api = \"responses\"\n");
    config.push_str(&format!(
        "experimental_bearer_token = {}\n",
        toml_string(&provider.api_key)
    ));
    config.push_str(PROVIDER_TABLE_END);
    config.push('\n');
    config
}

fn merge_local_proxy_config(
    existing: &str,
    name: &str,
    model: Option<&str>,
    include_model_catalog: bool,
) -> String {
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
    if include_model_catalog {
        config.push_str(&format!(
            "model_catalog_json = {}\n",
            toml_string(MODEL_CATALOG_FILENAME)
        ));
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

pub(crate) fn preferred_official_model(paths: &Paths) -> String {
    let current = fs::read_to_string(&paths.current_config).ok();
    let backup = fs::read_to_string(&paths.config_backup).ok();
    preferred_official_model_from_configs(current.as_deref(), backup.as_deref())
}

fn preferred_official_model_from_configs(current: Option<&str>, backup: Option<&str>) -> String {
    backup
        .and_then(extract_root_model)
        .or_else(|| {
            current.and_then(|config| {
                let cleaned = remove_marked_blocks(config);
                extract_root_model(&cleaned)
            })
        })
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
            models: vec!["gpt-4.1".to_string()],
            model_selection_controlled_by_codex: false,
            api_format: ProviderApiFormat::OpenaiResponses,
        }
    }

    #[test]
    fn local_proxy_config_points_codex_to_local_responses() {
        let merged =
            merge_local_proxy_config("model = \"old\"", "Proxy", Some("deepseek-chat"), true);
        assert!(merged.contains("model_provider = \"codex-switch-local\""));
        assert!(merged.contains("model = \"deepseek-chat\""));
        assert!(merged.contains("model_catalog_json = \"codex-switch-model-catalog.json\""));
        assert!(merged.contains("base_url = \"http://127.0.0.1:15722/v1\""));
        assert!(merged.contains("requires_openai_auth = true"));
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
        assert!(!merged.contains("model_catalog_json"));
        assert!(!merged.contains("requires_openai_auth"));
        assert!(merged.contains("approval_policy = \"on-request\""));
        assert!(merged.contains("[profiles.default]"));
        assert!(!merged.contains("https://old.example.com"));
    }

    #[test]
    fn provider_config_adds_model_catalog_when_codex_controls_models() {
        let mut provider = provider();
        provider.model_selection_controlled_by_codex = true;

        let merged = merge_provider_config("", &provider);

        assert!(merged.contains("model_catalog_json = \"codex-switch-model-catalog.json\""));
    }

    #[test]
    fn normalize_provider_profile_keeps_legacy_model_as_model_list() {
        let profile = normalize_provider_profile(ProviderProfile {
            id: "p".to_string(),
            name: "Gateway".to_string(),
            base_url: "https://gateway.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4.1".to_string(),
            models: Vec::new(),
            model_selection_controlled_by_codex: false,
            api_format: ProviderApiFormat::OpenaiResponses,
        })
        .unwrap();

        assert_eq!(profile.model, "gpt-4.1");
        assert_eq!(profile.models, vec!["gpt-4.1"]);
    }

    #[test]
    fn normalize_model_selection_trims_and_deduplicates_models() {
        let (model, models) = normalize_model_selection(
            " deepseek-chat ",
            vec![
                "deepseek-chat".to_string(),
                " deepseek-reasoner ".to_string(),
                String::new(),
                "deepseek-chat".to_string(),
            ],
        )
        .unwrap();

        assert_eq!(model, "deepseek-chat");
        assert_eq!(models, vec!["deepseek-chat", "deepseek-reasoner"]);
    }

    #[test]
    fn provider_model_catalog_contains_codex_visible_models() {
        let mut provider = provider();
        provider.models = vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()];
        let catalog = provider_model_catalog(&provider);
        let models = catalog["models"].as_array().unwrap();

        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["slug"], "deepseek-chat");
        assert_eq!(models[0]["display_name"], "deepseek-chat");
        assert!(models[0]["base_instructions"]
            .as_str()
            .unwrap()
            .contains("You are Codex"));
        assert!(models[0].get("default_verbosity").is_some());
        assert!(models[0].get("apply_patch_tool_type").is_some());
        assert_eq!(models[0]["use_responses_lite"], false);
        assert!(models[0].get("tool_mode").is_some());
        assert!(models[0].get("multi_agent_version").is_some());
        assert_eq!(models[1]["slug"], "deepseek-reasoner");
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

    #[test]
    fn official_local_proxy_uses_backed_up_official_model_after_provider() {
        let backup = r#"
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
"#;
        let provider_proxy =
            merge_local_proxy_config(backup, "DeepSeek", Some("deepseek-v4-flash"), true);

        assert_eq!(
            preferred_official_model_from_configs(Some(&provider_proxy), Some(backup)),
            "gpt-5.5"
        );

        let official_model =
            preferred_official_model_from_configs(Some(&provider_proxy), Some(backup));
        let official_proxy = merge_local_proxy_config(
            &provider_proxy,
            LOCAL_PROXY_PROVIDER_NAME,
            Some(&official_model),
            false,
        );
        let first_model = extract_root_model(&official_proxy).unwrap();

        assert_eq!(first_model, "gpt-5.5");
        assert!(!official_proxy.contains("deepseek-v4-flash"));
    }

    #[test]
    fn official_model_does_not_reuse_managed_provider_model_without_backup() {
        let provider_proxy = merge_local_proxy_config(
            r#"model = "gpt-5.5""#,
            "DeepSeek",
            Some("deepseek-v4-flash"),
            true,
        );

        assert_eq!(
            preferred_official_model_from_configs(Some(&provider_proxy), None),
            DEFAULT_OFFICIAL_MODEL
        );
    }

    #[test]
    fn official_model_uses_plain_current_config_without_backup() {
        assert_eq!(
            preferred_official_model_from_configs(Some(r#"model = "gpt-5.5""#), None),
            "gpt-5.5"
        );
    }
}
