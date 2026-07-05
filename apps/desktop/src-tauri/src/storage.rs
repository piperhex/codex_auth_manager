use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde_json::Value;
use tauri::{Manager, Runtime};

use crate::{
    auth::{account_fields, validate_auth},
    models::{AppSettings, ManagerStateFile, UsageSummary},
};

#[derive(Clone)]
pub(crate) struct Paths {
    pub(crate) codex_home: PathBuf,
    pub(crate) current_auth: PathBuf,
    pub(crate) accounts: PathBuf,
    pub(crate) state_file: PathBuf,
}

pub(crate) fn resolve_paths<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Paths, String> {
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

pub(crate) fn read_json(path: &Path) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取 {} 失败：{error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{} 不是有效 JSON：{error}", path.display()))
}

pub(crate) fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标路径没有父目录".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("创建 {} 失败：{error}", parent.display()))?;
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|error| format!("序列化 JSON 失败：{error}"))?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temp, bytes).map_err(|error| format!("写入临时文件失败：{error}"))?;
    replace_file(&temp, path).map_err(|error| format!("提交 {} 失败：{error}", path.display()))
}

pub(crate) fn write_json_if_changed(path: &Path, value: &Value) -> Result<bool, String> {
    if let Ok(existing) = read_json(path) {
        if existing == *value {
            return Ok(false);
        }
    }
    write_json_atomic(path, value)?;
    Ok(true)
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

pub(crate) fn account_dir(paths: &Paths, id: &str) -> PathBuf {
    paths.accounts.join(id)
}

pub(crate) fn managed_auth_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("auth.json")
}

pub(crate) fn usage_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("usage.json")
}

pub(crate) fn note_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("note.txt")
}

pub(crate) fn expiration_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("expires-at.txt")
}

pub(crate) fn load_note(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

pub(crate) fn load_expiration(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

pub(crate) fn save_note(path: &Path, note: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The note path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;

    if note.is_empty() {
        if path.exists() {
            fs::remove_file(path)
                .map_err(|error| format!("Failed to remove {}: {error}", path.display()))?;
        }
        return Ok(());
    }

    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temp, note.as_bytes())
        .map_err(|error| format!("Failed to write account note: {error}"))?;
    replace_file(&temp, path).map_err(|error| format!("Failed to save {}: {error}", path.display()))
}

pub(crate) fn save_expiration(path: &Path, expires_at: &str) -> Result<(), String> {
    save_note(path, expires_at)
}

pub(crate) fn read_state(paths: &Paths) -> ManagerStateFile {
    fs::read(&paths.state_file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn write_state(paths: &Paths, state: &ManagerStateFile) -> Result<(), String> {
    let value = serde_json::to_value(state).map_err(|error| error.to_string())?;
    write_json_atomic(&paths.state_file, &value)
}

pub(crate) fn read_app_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<AppSettings, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("settings.json");
    Ok(fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default())
}

pub(crate) fn write_app_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &AppSettings,
) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("settings.json");
    let value = serde_json::to_value(settings).map_err(|error| error.to_string())?;
    write_json_atomic(&path, &value)
}

pub(crate) fn import_value<R: Runtime>(
    app: &tauri::AppHandle<R>,
    auth: Value,
    activate: bool,
) -> Result<String, String> {
    validate_auth(&auth)?;
    let paths = resolve_paths(app)?;
    let (_, _, _, id) = account_fields(&auth)?;
    write_json_if_changed(&managed_auth_path(&paths, &id), &auth)?;
    if activate {
        write_json_if_changed(&paths.current_auth, &auth)?;
        write_state(
            &paths,
            &ManagerStateFile {
                active_account_id: Some(id.clone()),
            },
        )?;
    }
    Ok(id)
}

pub(crate) fn sync_current_into_store<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let paths = resolve_paths(app)?;
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

pub(crate) fn load_usage(path: &Path) -> UsageSummary {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn save_usage(path: &Path, usage: &UsageSummary) -> Result<(), String> {
    let value = serde_json::to_value(usage).map_err(|error| error.to_string())?;
    write_json_atomic(path, &value)
}
