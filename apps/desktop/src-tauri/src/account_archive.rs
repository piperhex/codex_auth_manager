use std::{
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use chrono::Utc;
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Runtime};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::{
    auth::{account_fields, canonicalize_chatgpt_auth, validate_auth},
    models::{ProviderProfile, ProviderSyncPayload, UsageSummary},
    storage::{
        expiration_path, load_expiration, load_note, load_or_init_last_modified, load_usage,
        managed_auth_path, note_path, parse_last_modified, read_json, read_state, resolve_paths,
        save_account_last_modified, save_expiration, save_note, save_usage, usage_path,
        write_json_if_changed, write_managed_auth_if_changed, write_state,
    },
};

const ARCHIVE_PAYLOAD_FILE: &str = "accounts.payload";
const ARCHIVE_MAGIC: &[u8] = b"CSARCHIVE1";
const ARCHIVE_KEY: [u8; 32] = *b"CodexSwitchLocalBackupKeyV1!2026";
const NONCE_LENGTH: usize = 12;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountArchivePayload {
    format_version: u16,
    exported_at: String,
    active_account_id: Option<String>,
    #[serde(default)]
    active_provider_id: Option<String>,
    accounts: Vec<AccountArchiveEntry>,
    #[serde(default)]
    providers: Vec<ProviderSyncPayload>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountArchiveEntry {
    id: String,
    auth: Value,
    note: String,
    expires_at: String,
    usage: UsageSummary,
    #[serde(default)]
    last_modified_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountArchiveImportResult {
    imported: usize,
    account_ids: Vec<String>,
    active_account_id: Option<String>,
    providers_imported: usize,
    provider_ids: Vec<String>,
    active_provider_id: Option<String>,
}

#[tauri::command]
pub(crate) fn export_accounts_archive<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<String, String> {
    let payload = collect_accounts(&app)?;
    if payload.accounts.is_empty() && payload.providers.is_empty() {
        return Err("No local accounts or providers to export".to_string());
    }

    let output_path = normalize_archive_path(Path::new(&path));
    let archive = encode_archive(&payload)?;
    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    fs::write(&output_path, archive)
        .map_err(|error| format!("Failed to write {}: {error}", output_path.display()))?;
    Ok(output_path.display().to_string())
}

#[tauri::command]
pub(crate) fn import_accounts_archive<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<AccountArchiveImportResult, String> {
    let payload = decode_archive(Path::new(&path))?;
    let result = apply_archive(&app, payload)?;
    if !result.account_ids.is_empty() {
        app.emit("accounts-changed", ())
            .map_err(|error| error.to_string())?;
    }
    if !result.provider_ids.is_empty() {
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
    }
    crate::system_tray::refresh_menu(&app);
    Ok(result)
}

fn collect_accounts<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<AccountArchivePayload, String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    let active_account_id = state.active_account_id;
    let active_provider_id = state.active_provider_id;
    let mut accounts = Vec::new();
    if paths.accounts.exists() {
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
            let (_, _, _, id) = account_fields(&auth)?;
            if repaired {
                write_managed_auth_if_changed(&paths, &id, &auth)?;
            }
            let last_modified_at = Some(load_or_init_last_modified(&paths, &id)?.to_rfc3339());
            accounts.push(AccountArchiveEntry {
                note: load_note(&note_path(&paths, &id)),
                expires_at: load_expiration(&expiration_path(&paths, &id)),
                usage: load_usage(&usage_path(&paths, &id)),
                last_modified_at,
                id,
                auth,
            });
        }
    }
    accounts.sort_by(|left, right| left.id.cmp(&right.id));
    let providers = collect_providers(&paths)?;
    Ok(AccountArchivePayload {
        format_version: 2,
        exported_at: Utc::now().to_rfc3339(),
        active_account_id,
        active_provider_id,
        accounts,
        providers,
    })
}

fn apply_archive<R: Runtime>(
    app: &tauri::AppHandle<R>,
    payload: AccountArchivePayload,
) -> Result<AccountArchiveImportResult, String> {
    if payload.format_version == 0 || payload.format_version > 2 {
        return Err(format!(
            "Unsupported account archive version: {}",
            payload.format_version
        ));
    }
    if payload.accounts.is_empty() && payload.providers.is_empty() {
        return Err("The selected archive does not contain any accounts or providers".to_string());
    }

    let paths = resolve_paths(app)?;
    fs::create_dir_all(&paths.accounts)
        .map_err(|error| format!("Failed to create account store: {error}"))?;
    fs::create_dir_all(&paths.providers)
        .map_err(|error| format!("Failed to create provider store: {error}"))?;

    let mut validated_accounts = Vec::new();
    for mut account in payload.accounts {
        canonicalize_chatgpt_auth(&mut account.auth)?;
        validate_auth(&account.auth)?;
        let (_, _, _, computed_id) = account_fields(&account.auth)?;
        if computed_id != account.id {
            return Err(format!(
                "Archive account {} does not match its auth.json identity",
                account.id
            ));
        }
        validated_accounts.push(account);
    }

    let mut account_ids = Vec::new();
    let mut active_account: Option<(String, Value)> = None;
    for account in validated_accounts {
        let auth_path = managed_auth_path(&paths, &account.id);
        let local_auth = read_json(&auth_path).ok();
        let local_usable = local_auth.as_ref().is_some_and(|auth| {
            validate_auth(auth).is_ok()
                && matches!(account_fields(auth), Ok((_, _, _, local_id)) if local_id == account.id)
        });
        let local_modified_at = if local_usable {
            Some(load_or_init_last_modified(&paths, &account.id)?)
        } else {
            None
        };
        let archive_modified_at = account
            .last_modified_at
            .as_deref()
            .and_then(parse_last_modified);
        let should_apply_archive = !local_usable
            || match (local_modified_at.as_ref(), archive_modified_at.as_ref()) {
                (Some(local), Some(archive)) => archive > local,
                (None, _) => true,
                (Some(_), None) => false,
            };
        let account_auth = if should_apply_archive {
            write_json_if_changed(&auth_path, &account.auth)?;
            save_note(&note_path(&paths, &account.id), &account.note)?;
            save_expiration(&expiration_path(&paths, &account.id), &account.expires_at)?;
            save_usage(&usage_path(&paths, &account.id), &account.usage)?;
            save_account_last_modified(
                &paths,
                &account.id,
                archive_modified_at.unwrap_or_else(Utc::now),
            )?;
            account.auth.clone()
        } else {
            local_auth.unwrap_or_else(|| account.auth.clone())
        };

        if payload.active_account_id.as_deref() == Some(&account.id) {
            active_account = Some((account.id.clone(), account_auth));
        }
        if !account_ids.contains(&account.id) {
            account_ids.push(account.id);
        }
    }

    let active_account_id = if let Some((id, auth)) = active_account {
        let can_activate = crate::local_proxy::is_running()
            || crate::commands::sync_current_auth_if_client_stopped(&paths, &auth)?;
        if !can_activate {
            None
        } else {
            let mut state = read_state(&paths);
            state.active_account_id = Some(id.clone());
            write_state(&paths, &state)?;
            if crate::local_proxy::is_running() {
                crate::providers::apply_local_proxy_config_for_paths(&paths)?;
            }
            Some(id)
        }
    } else {
        None
    };

    let mut provider_ids = Vec::new();
    for provider in payload.providers {
        let profile = provider_payload_to_profile(&provider)?;
        let local_profile = crate::providers::read_provider(&paths, &provider.id).ok();
        let local_modified_at = local_profile
            .as_ref()
            .and_then(|_| crate::providers::provider_modified_at(&paths, &provider.id).ok());
        let archive_modified_at = parse_last_modified(&provider.last_modified_at);
        let should_apply_archive = local_profile.is_none()
            || match (local_modified_at.as_ref(), archive_modified_at.as_ref()) {
                (Some(local), Some(archive)) => archive > local,
                (None, _) => true,
                (Some(_), None) => false,
            };

        if should_apply_archive {
            crate::providers::write_synced_provider(&paths, profile)?;
        }
        if !provider_ids.contains(&provider.id) {
            provider_ids.push(provider.id);
        }
    }

    let active_provider_id = if let Some(id) = payload.active_provider_id.as_deref() {
        if provider_ids.iter().any(|provider_id| provider_id == id)
            && crate::providers::activate_provider_for_sync(&paths, id)?
        {
            Some(id.to_string())
        } else {
            None
        }
    } else {
        None
    };

    Ok(AccountArchiveImportResult {
        imported: account_ids.len(),
        account_ids,
        active_account_id,
        providers_imported: provider_ids.len(),
        provider_ids,
        active_provider_id,
    })
}

fn collect_providers(paths: &crate::storage::Paths) -> Result<Vec<ProviderSyncPayload>, String> {
    crate::providers::list_provider_profiles(paths)?
        .into_iter()
        .map(|provider| {
            let last_modified_at =
                crate::providers::provider_modified_at(paths, &provider.id)?.to_rfc3339();
            Ok(provider_payload_from_profile(provider, last_modified_at))
        })
        .collect()
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

fn provider_payload_to_profile(provider: &ProviderSyncPayload) -> Result<ProviderProfile, String> {
    Ok(ProviderProfile {
        id: provider.id.clone(),
        name: provider.name.clone(),
        base_url: provider.base_url.clone(),
        api_key: provider.api_key.clone(),
        model: provider.model.clone(),
        models: provider.models.clone(),
        model_selection_controlled_by_codex: provider.model_selection_controlled_by_codex,
        api_format: provider.api_format,
    })
}

fn normalize_archive_path(path: &Path) -> PathBuf {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cs"))
    {
        path.to_path_buf()
    } else {
        path.with_extension("cs")
    }
}

fn encode_archive(payload: &AccountArchivePayload) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    let compressed = gzip(&json)?;
    let encrypted = encrypt_payload(&compressed)?;

    let cursor = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    zip.start_file(ARCHIVE_PAYLOAD_FILE, options)
        .map_err(|error| format!("Failed to create archive payload: {error}"))?;
    zip.write_all(&encrypted)
        .map_err(|error| format!("Failed to write archive payload: {error}"))?;
    let cursor = zip
        .finish()
        .map_err(|error| format!("Failed to finalize archive: {error}"))?;
    Ok(cursor.into_inner())
}

fn decode_archive(path: &Path) -> Result<AccountArchivePayload, String> {
    let file =
        File::open(path).map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let mut zip = ZipArchive::new(file)
        .map_err(|error| format!("The selected file is not a valid .cs archive: {error}"))?;
    let mut encrypted = Vec::new();
    zip.by_name(ARCHIVE_PAYLOAD_FILE)
        .map_err(|_| "The selected archive is missing its encrypted account payload".to_string())?
        .read_to_end(&mut encrypted)
        .map_err(|error| format!("Failed to read archive payload: {error}"))?;
    let compressed = decrypt_payload(&encrypted)?;
    let json = gunzip(&compressed)?;
    let payload: AccountArchivePayload = serde_json::from_slice(&json)
        .map_err(|error| format!("Account archive payload is invalid: {error}"))?;
    Ok(payload)
}

fn gzip(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(bytes)
        .map_err(|error| format!("Failed to compress account archive: {error}"))?;
    encoder
        .finish()
        .map_err(|error| format!("Failed to finish account archive compression: {error}"))
}

fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut decoded = Vec::new();
    decoder
        .read_to_end(&mut decoded)
        .map_err(|error| format!("Failed to decompress account archive: {error}"))?;
    Ok(decoded)
}

fn encrypt_payload(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(&ARCHIVE_KEY)
        .map_err(|error| format!("Failed to initialize account archive encryption: {error}"))?;
    let nonce_bytes: [u8; NONCE_LENGTH] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: bytes,
                aad: ARCHIVE_MAGIC,
            },
        )
        .map_err(|_| "Failed to encrypt account archive payload".to_string())?;
    let mut output = Vec::with_capacity(ARCHIVE_MAGIC.len() + NONCE_LENGTH + ciphertext.len());
    output.extend_from_slice(ARCHIVE_MAGIC);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

fn decrypt_payload(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() <= ARCHIVE_MAGIC.len() + NONCE_LENGTH {
        return Err("The encrypted account archive payload is incomplete".to_string());
    }
    if &bytes[..ARCHIVE_MAGIC.len()] != ARCHIVE_MAGIC {
        return Err("The selected file is not a Codex Switch account archive".to_string());
    }
    let nonce_start = ARCHIVE_MAGIC.len();
    let nonce_end = nonce_start + NONCE_LENGTH;
    let nonce = Nonce::from_slice(&bytes[nonce_start..nonce_end]);
    let ciphertext = &bytes[nonce_end..];
    let cipher = Aes256Gcm::new_from_slice(&ARCHIVE_KEY)
        .map_err(|error| format!("Failed to initialize account archive encryption: {error}"))?;
    cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: ARCHIVE_MAGIC,
            },
        )
        .map_err(|_| "Failed to decrypt account archive payload".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ProviderApiFormat;
    use serde_json::json;

    #[test]
    fn archive_keeps_payload_encrypted_inside_plain_zip() {
        let payload = AccountArchivePayload {
            format_version: 2,
            exported_at: "2026-07-04T00:00:00Z".to_string(),
            active_account_id: Some("account-1".to_string()),
            active_provider_id: Some("provider-1".to_string()),
            accounts: vec![AccountArchiveEntry {
                id: "account-1".to_string(),
                auth: json!({
                    "tokens": {
                        "access_token": "plain-secret-access-token",
                    }
                }),
                note: "plain-secret-note".to_string(),
                expires_at: "2026-12-31".to_string(),
                usage: UsageSummary::default(),
                last_modified_at: Some("2026-07-04T00:00:00Z".to_string()),
            }],
            providers: vec![ProviderSyncPayload {
                id: "provider-1".to_string(),
                name: "Gateway".to_string(),
                base_url: "https://gateway.example.com/v1".to_string(),
                api_key: "plain-secret-provider-key".to_string(),
                model: "gpt-4.1".to_string(),
                models: vec!["gpt-4.1".to_string()],
                model_selection_controlled_by_codex: false,
                api_format: ProviderApiFormat::OpenaiResponses,
                last_modified_at: "2026-07-04T00:00:00Z".to_string(),
            }],
        };

        let archive = encode_archive(&payload).expect("archive should encode");
        let archive_text = String::from_utf8_lossy(&archive);
        assert!(archive_text.contains(ARCHIVE_PAYLOAD_FILE));
        assert!(!archive_text.contains("plain-secret-access-token"));
        assert!(!archive_text.contains("plain-secret-provider-key"));
        assert!(!archive_text.contains("plain-secret-note"));

        let mut zip = ZipArchive::new(Cursor::new(archive)).expect("archive should be a plain zip");
        let mut encrypted = Vec::new();
        zip.by_name(ARCHIVE_PAYLOAD_FILE)
            .expect("zip should contain encrypted payload file")
            .read_to_end(&mut encrypted)
            .expect("payload should read");
        assert!(encrypted.starts_with(ARCHIVE_MAGIC));
        assert!(!String::from_utf8_lossy(&encrypted).contains("plain-secret-note"));
        assert!(!String::from_utf8_lossy(&encrypted).contains("plain-secret-provider-key"));

        let compressed = decrypt_payload(&encrypted).expect("payload should decrypt");
        let json = gunzip(&compressed).expect("payload should decompress");
        let restored: AccountArchivePayload =
            serde_json::from_slice(&json).expect("payload should decode");
        assert_eq!(restored.accounts[0].note, "plain-secret-note");
        assert_eq!(restored.providers[0].api_key, "plain-secret-provider-key");
    }
}
