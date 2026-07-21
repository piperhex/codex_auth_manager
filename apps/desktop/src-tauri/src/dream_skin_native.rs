use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{ImageFormat, ImageReader};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};
use tungstenite::{client, Message, WebSocket};
use url::Url;
use uuid::Uuid;

#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::process::Command;

use crate::dream_skin::{
    state_root, DreamSkinImportOptions, DreamSkinStatus, DreamSkinThemeSummary,
};

const NATIVE_RUNTIME_VERSION: &str = "2.0.0";
const SKIN_VERSION: &str = "1.2.0";
const DEFAULT_CDP_PORT: u16 = 9335;
const CDP_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ART_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ART_DIMENSION: u32 = 16_384;
const MAX_ART_PIXELS: u64 = 50_000_000;
const BUILT_IN_THEME_IDS: [&str; 57] = [
    "preset-gothic-void-crusade",
    "preset-rose-reverie",
    "preset-fortune-at-work",
    "preset-coral-horizon",
    "preset-sage-daylight",
    "preset-spark-studio",
    "preset-cosmic-violet",
    "preset-aqua-resonance",
    "preset-midnight-gold",
    "preset-celadon-sword-lord",
    "preset-bamboo-flute-scholar",
    "preset-crimson-cloud-general",
    "preset-white-fox-scholar",
    "preset-jade-dragon-prince",
    "preset-lantern-night-guard",
    "preset-snow-crane-swordsman",
    "preset-lotus-spring-healer",
    "preset-tea-mountain-youth",
    "preset-dunhuang-lotus-dancer",
    "preset-white-fox-maiden",
    "preset-bamboo-qin-muse",
    "preset-campus-cardigan-girl",
    "preset-bookstore-spring-girl",
    "preset-cafe-strawberry-girl",
    "preset-film-camera-girl",
    "preset-west-lake-morning",
    "preset-guilin-cloud-sea",
    "preset-huangshan-sunrise",
    "preset-jiangnan-rain-town",
    "preset-ultraman-tiga-sky",
    "preset-ultraman-zero-cosmos",
    "preset-ultraman-mebius-dawn",
    "preset-ultraman-z-starlight",
    "preset-doraemon-anywhere-door",
    "preset-doraemon-bamboo-copter",
    "preset-doraemon-time-machine",
    "preset-doraemon-nobita-night",
    "preset-tom-jerry-kitchen-chase",
    "preset-tom-jerry-piano-duet",
    "preset-tom-jerry-garden-picnic",
    "preset-tom-jerry-starry-night",
    "preset-spongebob-patrick-jellyfish",
    "preset-spongebob-patrick-pineapple",
    "preset-spongebob-patrick-krusty-krab",
    "preset-spongebob-patrick-starry-sea",
    "preset-boonie-bears-forest-day",
    "preset-boonie-bears-snow-adventure",
    "preset-boonie-bears-treehouse",
    "preset-boonie-bears-spring-picnic",
    "preset-pleasant-goat-grassland",
    "preset-pleasant-goat-wolffy-chase",
    "preset-pleasant-goat-lantern-night",
    "preset-pleasant-goat-friends-picnic",
    "preset-qin-moon-tianming-shaoyu",
    "preset-qin-moon-gai-nie",
    "preset-qin-moon-wei-zhuang",
    "preset-qin-moon-shaosiming",
];
const RETIRED_THEME_IDS: [&str; 1] = ["preset-arina-hashimoto"];

static OPERATION_LOCK: Mutex<()> = Mutex::new(());
static MONITOR: OnceLock<Arc<MonitorControl>> = OnceLock::new();
static SKIN_LAUNCHING: AtomicBool = AtomicBool::new(false);

#[derive(Clone)]
struct RuntimePaths {
    bundled_root: PathBuf,
}

struct MonitorControl {
    paths: Mutex<Option<RuntimePaths>>,
    wake: Condvar,
}

struct SkinLaunchGuard;

impl SkinLaunchGuard {
    fn acquire() -> Self {
        SKIN_LAUNCHING.store(true, Ordering::Release);
        Self
    }
}

impl Drop for SkinLaunchGuard {
    fn drop(&mut self) {
        SKIN_LAUNCHING.store(false, Ordering::Release);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSessionState {
    schema_version: u32,
    runtime_version: String,
    session: String,
    port: Option<u16>,
    codex_executable: Option<String>,
}

impl Default for NativeSessionState {
    fn default() -> Self {
        Self {
            schema_version: 1,
            runtime_version: NATIVE_RUNTIME_VERSION.to_string(),
            session: "ready".to_string(),
            port: None,
            codex_executable: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallationMarker {
    schema_version: u32,
    runtime: String,
    version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CdpTarget {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    url: String,
    web_socket_debugger_url: String,
}

#[derive(Clone)]
struct LoadedPayload {
    source: String,
    revision: String,
}

struct LoadedTheme {
    document: Value,
    image_path: PathBuf,
    image_bytes: Vec<u8>,
    mime: &'static str,
}

#[derive(Clone)]
struct CodexInstall {
    executable: PathBuf,
    #[cfg(target_os = "windows")]
    app_user_model_id: Option<String>,
}

#[derive(Clone)]
struct InjectedTarget {
    revision: String,
    early_script_id: Option<String>,
}

fn marker_path() -> Result<PathBuf, String> {
    Ok(state_root()?.join("native-runtime.json"))
}

fn session_path() -> Result<PathBuf, String> {
    Ok(state_root()?.join("native-session.json"))
}

fn active_theme_root() -> Result<PathBuf, String> {
    Ok(state_root()?.join("active-theme"))
}

fn themes_root() -> Result<PathBuf, String> {
    Ok(state_root()?.join("themes"))
}

fn pause_path() -> Result<PathBuf, String> {
    Ok(state_root()?.join("paused"))
}

fn bundled_root(app: &AppHandle) -> Result<PathBuf, String> {
    let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dream-skin");
    let mut candidates = vec![manifest_root];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.insert(0, resource_dir.join("dream-skin"));
        candidates.insert(1, resource_dir.join("resources").join("dream-skin"));
    }
    candidates
        .into_iter()
        .find(|path| {
            path.join("assets")
                .join("windows")
                .join("renderer-inject.js")
                .is_file()
                && path
                    .join("assets")
                    .join("macos")
                    .join("renderer-inject.js")
                    .is_file()
                && path.join("presets").is_dir()
        })
        .ok_or_else(|| "The bundled Dream Skin assets are missing.".to_string())
}

fn built_in_theme_directory(root: &Path, theme_id: &str) -> Result<PathBuf, String> {
    if !BUILT_IN_THEME_IDS.contains(&theme_id) {
        return Err(format!("Unknown built-in theme: {theme_id}"));
    }
    let directory = root.join("presets").join(theme_id);
    if !directory.is_dir() {
        return Err(format!("Bundled theme is missing: {theme_id}"));
    }
    Ok(directory)
}

fn valid_theme_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn validate_name(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 || value.chars().any(char::is_control) {
        Err("Theme name must contain 1 to 80 visible characters.".to_string())
    } else {
        Ok(value)
    }
}

#[cfg(target_os = "windows")]
fn ensure_no_reparse_points(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

    let mut current = Some(path);
    while let Some(candidate) = current {
        match fs::symlink_metadata(candidate) {
            Ok(metadata) if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 => {
                return Err(format!(
                    "Managed Dream Skin path contains a link or junction: {}",
                    candidate.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Failed to inspect {}: {error}",
                    candidate.display()
                ));
            }
        }
        current = candidate.parent();
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn ensure_no_reparse_points(path: &Path) -> Result<(), String> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        match fs::symlink_metadata(candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "Managed Dream Skin path contains a symbolic link: {}",
                    candidate.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Failed to inspect {}: {error}",
                    candidate.display()
                ));
            }
        }
        current = candidate.parent();
    }
    Ok(())
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    ensure_no_reparse_points(path)?;
    fs::create_dir_all(path)
        .map_err(|error| format!("Failed to create {}: {error}", path.display()))?;
    ensure_no_reparse_points(path)?;
    if !path.is_dir() {
        return Err(format!(
            "Managed path is not a directory: {}",
            path.display()
        ));
    }
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    ensure_directory(parent)?;
    ensure_no_reparse_points(path)?;
    let temporary = parent.join(format!(".dream-tmp-{}.json", Uuid::new_v4().simple()));
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Failed to write {}: {error}", temporary.display()))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Failed to replace {}: {error}", path.display()))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("Failed to publish {}: {error}", path.display()))
}

fn read_session() -> NativeSessionState {
    session_path()
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_session(state: &NativeSessionState) -> Result<(), String> {
    write_json(&session_path()?, state)
}

fn image_details(path: &Path) -> Result<(&'static str, u32, u32), String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("Theme image must be a non-empty file.".to_string());
    }
    if metadata.len() > MAX_ART_BYTES {
        return Err("Theme image exceeds the 16 MB limit.".to_string());
    }
    let reader = ImageReader::open(path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?
        .with_guessed_format()
        .map_err(|error| format!("Failed to identify {}: {error}", path.display()))?;
    let format = reader
        .format()
        .ok_or_else(|| "Unsupported theme image format.".to_string())?;
    let mime = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::WebP => "image/webp",
        _ => return Err("Only PNG, JPEG and WebP theme images are supported.".to_string()),
    };
    let (width, height) = reader
        .into_dimensions()
        .map_err(|error| format!("Invalid image metadata in {}: {error}", path.display()))?;
    if width == 0
        || height == 0
        || width > MAX_ART_DIMENSION
        || height > MAX_ART_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_ART_PIXELS
    {
        return Err("Theme image exceeds the 16384 px / 50 MP safety limit.".to_string());
    }
    Ok((mime, width, height))
}

fn normalize_theme_document(mut document: Value, fallback_id: &str) -> Result<Value, String> {
    let object = document
        .as_object_mut()
        .ok_or_else(|| "Theme metadata root must be an object.".to_string())?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    if !valid_theme_id(id) {
        return Err("Theme id is invalid.".to_string());
    }
    object.insert("id".to_string(), Value::String(id.to_string()));

    let name = object
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Codex Dream Skin");
    if name.trim().is_empty() || name.chars().count() > 120 || name.chars().any(char::is_control) {
        return Err("Theme name is invalid.".to_string());
    }
    object.insert("name".to_string(), Value::String(name.to_string()));

    let appearance = object
        .get("appearance")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    if !matches!(appearance, "auto" | "light" | "dark") {
        return Err("Theme appearance is invalid.".to_string());
    }
    object.insert(
        "appearance".to_string(),
        Value::String(appearance.to_string()),
    );

    let art = object
        .entry("art")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| "Theme art settings must be an object.".to_string())?;
    for key in ["focusX", "focusY"] {
        if let Some(value) = art.get(key).filter(|value| !value.is_null()) {
            let number = value
                .as_f64()
                .filter(|number| number.is_finite() && (0.0..=1.0).contains(number))
                .ok_or_else(|| format!("Theme {key} must be between 0 and 1."))?;
            art.insert(key.to_string(), json!(number));
        }
    }
    let safe_area = art
        .get("safeArea")
        .and_then(Value::as_str)
        .unwrap_or("auto")
        .to_string();
    if !matches!(
        safe_area.as_str(),
        "auto" | "left" | "right" | "center" | "none"
    ) {
        return Err("Theme safe area is invalid.".to_string());
    }
    let task_mode = art
        .get("taskMode")
        .and_then(Value::as_str)
        .unwrap_or("auto")
        .to_string();
    if !matches!(task_mode.as_str(), "auto" | "ambient" | "banner" | "off") {
        return Err("Theme task mode is invalid.".to_string());
    }
    art.insert("safeArea".to_string(), Value::String(safe_area));
    art.insert("taskMode".to_string(), Value::String(task_mode));
    object
        .entry("palette")
        .or_insert_with(|| Value::Object(Map::new()));
    Ok(document)
}

fn load_theme(directory: &Path) -> Result<LoadedTheme, String> {
    ensure_no_reparse_points(directory)?;
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {}: {error}", directory.display()))?;
    let theme_path = canonical_directory.join("theme.json");
    ensure_no_reparse_points(&theme_path)?;
    let bytes = fs::read(&theme_path)
        .map_err(|error| format!("Failed to read {}: {error}", theme_path.display()))?;
    let raw: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Invalid {}: {error}", theme_path.display()))?;
    let fallback_id = canonical_directory
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| valid_theme_id(name))
        .unwrap_or("custom");
    let mut document = normalize_theme_document(raw, fallback_id)?;
    let image_name = document
        .get("image")
        .and_then(Value::as_str)
        .ok_or_else(|| "Theme image must be a relative file name.".to_string())?;
    let image_component = Path::new(image_name);
    if image_component.is_absolute()
        || image_component.components().count() != 1
        || image_component.file_name().and_then(|name| name.to_str()) != Some(image_name)
    {
        return Err("Theme image must be a relative file name.".to_string());
    }
    let image_path = canonical_directory.join(image_component);
    ensure_no_reparse_points(&image_path)?;
    let canonical_image = image_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {}: {error}", image_path.display()))?;
    if !canonical_image.starts_with(&canonical_directory) {
        return Err("Theme image escapes its theme directory.".to_string());
    }
    let (mime, width, height) = image_details(&canonical_image)?;
    let image_bytes = fs::read(&canonical_image)
        .map_err(|error| format!("Failed to read {}: {error}", canonical_image.display()))?;
    let ratio = f64::from(width) / f64::from(height);
    let aspect = if ratio >= 2.25 {
        "ultrawide"
    } else if ratio >= 1.45 {
        "wide"
    } else if ratio >= 1.08 {
        "landscape"
    } else if ratio >= 0.9 {
        "square"
    } else {
        "portrait"
    };
    document.as_object_mut().unwrap().insert(
        "artMetadata".to_string(),
        json!({
            "width": width,
            "height": height,
            "ratio": ratio,
            "wide": ratio >= 1.75,
            "aspect": aspect,
            "taskMode": if ratio >= 2.25 { "banner" } else { "ambient" }
        }),
    );
    Ok(LoadedTheme {
        document,
        image_path: canonical_image,
        image_bytes,
        mime,
    })
}

fn copy_theme_to_active(source: &Path) -> Result<(), String> {
    let loaded = load_theme(source)?;
    let active = active_theme_root()?;
    ensure_directory(&active)?;
    let extension = match loaded.mime {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let image_name = format!("art-{}.{}", Uuid::new_v4().simple(), extension);
    let target = active.join(&image_name);
    fs::write(&target, &loaded.image_bytes)
        .map_err(|error| format!("Failed to write {}: {error}", target.display()))?;
    image_details(&target)?;

    let old_image = load_theme(&active).ok().map(|theme| theme.image_path);
    let mut document = loaded.document;
    document
        .as_object_mut()
        .unwrap()
        .insert("image".to_string(), Value::String(image_name));
    write_json(&active.join("theme.json"), &document)?;
    if let Some(old_image) = old_image.filter(|path| path != &target && path.starts_with(&active)) {
        let _ = fs::remove_file(old_image);
    }
    Ok(())
}

fn save_current_theme(name: &str) -> Result<String, String> {
    let name = validate_name(name)?;
    let active = load_theme(&active_theme_root()?)?;
    let id = format!(
        "{}-{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let destination = themes_root()?.join(&id);
    ensure_directory(&destination)?;
    let extension = match active.mime {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let image_name = format!("art.{extension}");
    fs::write(destination.join(&image_name), &active.image_bytes)
        .map_err(|error| format!("Failed to save theme image: {error}"))?;
    let mut document = active.document;
    let object = document.as_object_mut().unwrap();
    object.insert("id".to_string(), Value::String(id.clone()));
    object.insert("name".to_string(), Value::String(name.to_string()));
    object.insert("image".to_string(), Value::String(image_name));
    write_json(&destination.join("theme.json"), &document)?;
    Ok(id)
}

fn saved_theme_directory(theme_id: &str) -> Result<PathBuf, String> {
    if !valid_theme_id(theme_id) {
        return Err("Theme id is invalid.".to_string());
    }
    let root = themes_root()?;
    let directory = root.join(theme_id);
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {}: {error}", root.display()))?;
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| format!("Theme does not exist: {theme_id}: {error}"))?;
    if !canonical_directory.starts_with(&canonical_root) {
        return Err("Theme directory escapes the managed theme library.".to_string());
    }
    Ok(canonical_directory)
}

fn initialize_store(root: &Path) -> Result<(), String> {
    let state = state_root()?;
    ensure_directory(&state)?;
    ensure_directory(&active_theme_root()?)?;
    ensure_directory(&themes_root()?)?;
    let active = load_theme(&active_theme_root()?).ok();
    let retired_active = active.as_ref().is_some_and(|theme| {
        theme
            .document
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| RETIRED_THEME_IDS.contains(&id))
    });
    if active.is_none() || retired_active {
        copy_theme_to_active(&built_in_theme_directory(root, "preset-rose-reverie")?)?;
    }
    Ok(())
}

fn load_payload(paths: &RuntimePaths) -> Result<LoadedPayload, String> {
    let theme = load_theme(&active_theme_root()?)?;
    #[cfg(target_os = "windows")]
    let platform = "windows";
    #[cfg(target_os = "macos")]
    let platform = "macos";
    let assets = paths.bundled_root.join("assets").join(platform);
    let css = fs::read_to_string(assets.join("dream-skin.css"))
        .map_err(|error| format!("Failed to read Dream Skin CSS: {error}"))?;
    let template = fs::read_to_string(assets.join("renderer-inject.js"))
        .map_err(|error| format!("Failed to read Dream Skin renderer: {error}"))?;
    let art_data_url = format!(
        "data:{};base64,{}",
        theme.mime,
        BASE64.encode(&theme.image_bytes)
    );
    render_payload(&template, &css, &art_data_url, &theme.document)
}

#[cfg(target_os = "windows")]
fn render_payload(
    template: &str,
    css: &str,
    art_data_url: &str,
    theme: &Value,
) -> Result<LoadedPayload, String> {
    let css_json = serde_json::to_string(&css).map_err(|error| error.to_string())?;
    let art_json = serde_json::to_string(&art_data_url).map_err(|error| error.to_string())?;
    let theme_json = serde_json::to_string(theme).map_err(|error| error.to_string())?;
    let source = template
        .replace("__DREAM_CSS_JSON__", &css_json)
        .replace("__DREAM_ART_JSON__", &art_json)
        .replace("__DREAM_THEME_JSON__", &theme_json);
    if source.contains("__DREAM_CSS_JSON__")
        || source.contains("__DREAM_ART_JSON__")
        || source.contains("__DREAM_THEME_JSON__")
    {
        return Err("Dream Skin renderer template contains unresolved placeholders.".to_string());
    }
    let mut hasher = Sha256::new();
    hasher.update(source.as_bytes());
    let revision = format!("{:x}", hasher.finalize());
    Ok(LoadedPayload { source, revision })
}

#[cfg(target_os = "macos")]
fn render_payload(
    template: &str,
    css: &str,
    art_data_url: &str,
    theme: &Value,
) -> Result<LoadedPayload, String> {
    let css_json = serde_json::to_string(&css).map_err(|error| error.to_string())?;
    let art_json = serde_json::to_string(&art_data_url).map_err(|error| error.to_string())?;
    let theme_json = serde_json::to_string(theme).map_err(|error| error.to_string())?;

    let mut style_hasher = Sha256::new();
    style_hasher.update(css.as_bytes());
    let style_revision = format!("{:x}", style_hasher.finalize())[..20].to_string();

    let mut payload_hasher = Sha256::new();
    payload_hasher.update(SKIN_VERSION.as_bytes());
    payload_hasher.update(css.as_bytes());
    payload_hasher.update(template.as_bytes());
    payload_hasher.update(theme_json.as_bytes());
    let revision = format!("{:x}", payload_hasher.finalize())[..20].to_string();

    let version_json = serde_json::to_string(SKIN_VERSION).map_err(|error| error.to_string())?;
    let style_revision_json =
        serde_json::to_string(&style_revision).map_err(|error| error.to_string())?;
    let revision_json = serde_json::to_string(&revision).map_err(|error| error.to_string())?;
    let replacements = [
        ("__DREAM_SKIN_CSS_JSON__", css_json.as_str()),
        ("__DREAM_SKIN_ART_JSON__", art_json.as_str()),
        ("__DREAM_SKIN_THEME_JSON__", theme_json.as_str()),
        ("__DREAM_SKIN_VERSION_JSON__", version_json.as_str()),
        (
            "__DREAM_SKIN_STYLE_REVISION_JSON__",
            style_revision_json.as_str(),
        ),
        (
            "__DREAM_SKIN_PAYLOAD_REVISION_JSON__",
            revision_json.as_str(),
        ),
    ];
    let mut source = template.to_string();
    for (placeholder, value) in replacements {
        source = source.replace(placeholder, value);
    }
    if replacements
        .iter()
        .any(|(placeholder, _)| source.contains(placeholder))
    {
        return Err("Dream Skin renderer template contains unresolved placeholders.".to_string());
    }
    Ok(LoadedPayload { source, revision })
}

fn early_payload(payload: &LoadedPayload) -> String {
    let generation = serde_json::to_string(&payload.revision).unwrap();
    format!(
        r#"(() => {{
          const generationKey = "__CODEX_DREAM_SKIN_EARLY_GENERATION__";
          const appliedKey = "__CODEX_DREAM_SKIN_EARLY_APPLIED__";
          const generation = {generation};
          window[generationKey] = generation;
          let observer = null;
          let timeout = null;
          const stop = () => {{ observer?.disconnect(); observer = null; if (timeout) clearTimeout(timeout); timeout = null; }};
          const install = () => {{
            if (window[generationKey] !== generation) {{ stop(); return true; }}
            if (!document.documentElement || !document.body) return false;
            if (!document.querySelector('main.main-surface') || !document.querySelector('aside.app-shell-left-panel')) return false;
            stop();
            {};
            window[appliedKey] = generation;
            return true;
          }};
          if (install()) return;
          if (typeof MutationObserver === "function" && document.documentElement) {{
            observer = new MutationObserver(install);
            observer.observe(document.documentElement, {{ childList: true, subtree: true }});
          }}
          timeout = setTimeout(stop, 60000);
        }})()"#,
        payload.source
    )
}

const REMOVE_PAYLOAD: &str = r#"(() => {
  window.__CODEX_DREAM_SKIN_DISABLED__ = true;
  const state = window.__CODEX_DREAM_SKIN_STATE__;
  if (state?.cleanup) return state.cleanup();
  document.documentElement?.classList.remove(
    'codex-dream-skin', 'dream-theme-light', 'dream-theme-dark',
    'dream-art-wide', 'dream-art-standard', 'dream-focus-left',
    'dream-focus-center', 'dream-focus-right', 'dream-safe-left',
    'dream-safe-center', 'dream-safe-right', 'dream-safe-none',
    'dream-task-ambient', 'dream-task-banner', 'dream-task-off'
  );
  for (const property of [
    '--dream-art', '--dream-art-position', '--dream-focus-x', '--dream-focus-y',
    '--dream-accent', '--dream-accent-ink', '--dream-image-luma'
  ]) document.documentElement?.style.removeProperty(property);
  document.querySelectorAll('.dream-home,.dream-task,.dream-home-shell').forEach((node) => {
    node.classList.remove('dream-home', 'dream-task', 'dream-home-shell');
  });
  document.getElementById('codex-dream-skin-style')?.remove();
  document.getElementById('codex-dream-skin-chrome')?.remove();
  delete window.__CODEX_DREAM_SKIN_STATE__;
  return true;
})()"#;

const VERIFY_PAYLOAD: &str = r#"(() => {
  const result = {
    installed: document.documentElement.classList.contains('codex-dream-skin'),
    version: window.__CODEX_DREAM_SKIN_STATE__?.version ?? null,
    expectedVersion: '1.2.0',
    stylePresent: Boolean(document.getElementById('codex-dream-skin-style')),
    chromePresent: Boolean(document.getElementById('codex-dream-skin-chrome')),
    sidebarPresent: Boolean(document.querySelector('aside.app-shell-left-panel')),
    composerPresent: Boolean(document.querySelector('.composer-surface-chrome')),
  };
  result.pass = result.installed && result.version === result.expectedVersion &&
    result.stylePresent && result.chromePresent && result.sidebarPresent && result.composerPresent;
  return result;
})()"#;

const CODEX_PROBE_PAYLOAD: &str = r#"(() => ({
  codex: Boolean(
    document.querySelector('main.main-surface') &&
    document.querySelector('aside.app-shell-left-panel')
  )
}))()"#;

struct CdpSession {
    socket: WebSocket<TcpStream>,
    next_id: u64,
}

fn cdp_command_remaining(deadline: Instant, method: &str) -> Result<Duration, String> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        Err(format!("CDP command timed out: {method}"))
    } else {
        Ok(remaining)
    }
}

impl CdpSession {
    fn connect(target: &CdpTarget, port: u16) -> Result<Self, String> {
        validate_target(target, port)?;
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
            .map_err(|error| format!("Failed to connect to Codex CDP: {error}"))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .map_err(|error| format!("Failed to configure CDP timeout: {error}"))?;
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .map_err(|error| format!("Failed to configure CDP timeout: {error}"))?;
        let (socket, _) = client(target.web_socket_debugger_url.as_str(), stream)
            .map_err(|error| format!("Failed to open Codex CDP WebSocket: {error}"))?;
        Ok(Self { socket, next_id: 1 })
    }

    fn send(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.send_with_timeout(method, params, CDP_COMMAND_TIMEOUT)
    }

    fn send_with_timeout(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let deadline = Instant::now() + timeout;
        self.socket
            .send(Message::Text(
                json!({ "id": id, "method": method, "params": params })
                    .to_string()
                    .into(),
            ))
            .map_err(|error| format!("Failed to send CDP command {method}: {error}"))?;
        loop {
            let remaining = cdp_command_remaining(deadline, method)?;
            self.socket
                .get_mut()
                .set_read_timeout(Some(remaining))
                .map_err(|error| format!("Failed to configure CDP timeout: {error}"))?;
            let message = match self.socket.read() {
                Ok(message) => message,
                Err(tungstenite::Error::Io(error))
                    if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) =>
                {
                    return Err(format!("CDP command timed out: {method}"));
                }
                Err(error) => {
                    return Err(format!("Failed to read CDP response for {method}: {error}"));
                }
            };
            let Message::Text(text) = message else {
                continue;
            };
            let value: Value = serde_json::from_str(text.as_str())
                .map_err(|error| format!("Invalid CDP response: {error}"))?;
            if value.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = value.get("error") {
                return Err(format!("CDP command {method} failed: {error}"));
            }
            return Ok(value.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    fn enable(&mut self) -> Result<(), String> {
        self.send("Runtime.enable", json!({}))?;
        self.send("Page.enable", json!({}))?;
        Ok(())
    }

    fn evaluate(&mut self, expression: &str) -> Result<Value, String> {
        let response = self.send(
            "Runtime.evaluate",
            json!({
                "expression": expression,
                "awaitPromise": true,
                "returnByValue": true,
                "userGesture": false
            }),
        )?;
        if let Some(exception) = response.get("exceptionDetails") {
            return Err(format!("Renderer evaluation failed: {exception}"));
        }
        Ok(response
            .get("result")
            .and_then(|result| result.get("value"))
            .cloned()
            .unwrap_or(Value::Null))
    }

    fn register_early(&mut self, source: &str) -> Result<Option<String>, String> {
        let result = self.send(
            "Page.addScriptToEvaluateOnNewDocument",
            json!({ "source": source }),
        )?;
        Ok(result
            .get("identifier")
            .and_then(Value::as_str)
            .map(str::to_string))
    }

    fn remove_early(&mut self, identifier: &str) {
        let _ = self.send(
            "Page.removeScriptToEvaluateOnNewDocument",
            json!({ "identifier": identifier }),
        );
    }
}

fn validate_target(target: &CdpTarget, port: u16) -> Result<(), String> {
    if target.kind != "page"
        || !target.url.starts_with("app://")
        || target.id.is_empty()
        || target.id.len() > 200
        || !target
            .id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err("Rejected an invalid Codex CDP page target.".to_string());
    }
    let parsed = Url::parse(&target.web_socket_debugger_url)
        .map_err(|error| format!("Invalid CDP WebSocket URL: {error}"))?;
    let host_ok = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    let expected_path = format!("/devtools/page/{}", target.id);
    if parsed.scheme() != "ws"
        || !host_ok
        || parsed.port() != Some(port)
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != expected_path
    {
        return Err("Rejected a CDP WebSocket outside the local Codex endpoint.".to_string());
    }
    Ok(())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(|error| format!("Failed to create CDP client: {error}"))
}

fn list_targets(port: u16) -> Result<Vec<CdpTarget>, String> {
    let response = http_client()?
        .get(format!("http://127.0.0.1:{port}/json/list"))
        .send()
        .map_err(|error| format!("Codex CDP is unavailable on port {port}: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Codex CDP target request failed: {error}"))?;
    let targets: Vec<CdpTarget> = response
        .json()
        .map_err(|error| format!("Invalid Codex CDP target list: {error}"))?;
    Ok(targets
        .into_iter()
        .filter(|target| validate_target(target, port).is_ok())
        .collect())
}

fn wait_for_codex_probe(session: &mut CdpSession, timeout: Duration) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    loop {
        let probe = session.evaluate(CODEX_PROBE_PAYLOAD)?;
        if probe.get("codex").and_then(Value::as_bool) == Some(true) {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn inject_target(
    target: &CdpTarget,
    port: u16,
    payload: &LoadedPayload,
    previous_script: Option<&str>,
) -> Result<InjectedTarget, String> {
    let mut session = CdpSession::connect(target, port)?;
    session.enable()?;
    if let Some(identifier) = previous_script {
        session.remove_early(identifier);
    }
    let early = early_payload(payload);
    let early_script_id = session.register_early(&early)?;
    let result = (|| -> Result<bool, String> {
        session.evaluate(&early)?;
        if !wait_for_codex_probe(&mut session, Duration::from_millis(1800))? {
            return Ok(false);
        }

        let revision_json =
            serde_json::to_string(&payload.revision).map_err(|error| error.to_string())?;
        let early_applied = session.evaluate(&format!(
            "window.__CODEX_DREAM_SKIN_EARLY_APPLIED__ === {revision_json}"
        ))?;
        if early_applied.as_bool() != Some(true) {
            let fallback_generation =
                serde_json::to_string(&format!("fallback:{}", payload.revision))
                    .map_err(|error| error.to_string())?;
            session.evaluate(&format!(
                "window.__CODEX_DREAM_SKIN_EARLY_GENERATION__ = {fallback_generation}"
            ))?;
            session.evaluate(&payload.source)?;
        }

        let verification = session.evaluate(VERIFY_PAYLOAD)?;
        if verification.get("pass").and_then(Value::as_bool) != Some(true) {
            return Err(format!(
                "Dream Skin target verification failed: {}",
                serde_json::to_string(&verification).unwrap_or_default()
            ));
        }
        Ok(true)
    })();

    match result {
        Ok(true) => Ok(InjectedTarget {
            revision: payload.revision.clone(),
            early_script_id,
        }),
        Ok(false) => {
            if let Some(identifier) = early_script_id.as_deref() {
                session.remove_early(identifier);
            }
            Ok(InjectedTarget {
                revision: payload.revision.clone(),
                early_script_id: None,
            })
        }
        Err(error) => {
            if let Some(identifier) = early_script_id.as_deref() {
                session.remove_early(identifier);
            }
            Err(error)
        }
    }
}

fn remove_target(
    target: &CdpTarget,
    port: u16,
    previous_script: Option<&str>,
) -> Result<(), String> {
    let mut session = CdpSession::connect(target, port)?;
    session.enable()?;
    if let Some(identifier) = previous_script {
        session.remove_early(identifier);
    }
    session.evaluate(REMOVE_PAYLOAD)?;
    Ok(())
}

fn monitor_iteration(
    paths: &RuntimePaths,
    injected: &mut HashMap<String, InjectedTarget>,
    last_port: &mut Option<u16>,
    unavailable_iterations: &mut u8,
) -> Result<(), String> {
    if !marker_path()?.is_file() {
        injected.clear();
        *last_port = None;
        *unavailable_iterations = 0;
        return Ok(());
    }
    let state = read_session();
    let Some(port) = state.port else {
        injected.clear();
        *last_port = None;
        *unavailable_iterations = 0;
        return Ok(());
    };
    if *last_port != Some(port) {
        injected.clear();
        *last_port = Some(port);
    }
    let paused = pause_path()?.is_file();
    let payload = if paused {
        None
    } else {
        Some(load_payload(paths)?)
    };
    let targets = match list_targets(port) {
        Ok(targets) => {
            *unavailable_iterations = 0;
            targets
        }
        Err(error) if error.contains("CDP is unavailable") => {
            if SKIN_LAUNCHING.load(Ordering::Acquire) {
                *unavailable_iterations = 0;
                return Ok(());
            }
            *unavailable_iterations = unavailable_iterations.saturating_add(1);
            // A manually started ChatGPT process has no remote-debugging port,
            // so it cannot receive the renderer payload.  Take it over as soon
            // as the process appears; SKIN_LAUNCHING already prevents this path
            // from racing a managed launch.  Pausing the skin remains an
            // explicit opt out, and closing ChatGPT does not relaunch it because
            // no process is detected.
            if *unavailable_iterations >= 1 && has_running_codex_install() {
                *unavailable_iterations = 0;
                if let Err(restart_error) = recover_running_codex(paths) {
                    eprintln!(
                        "Dream Skin could not recover a manual ChatGPT restart: {restart_error}"
                    );
                }
            }
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    injected.retain(|id, _| targets.iter().any(|target| &target.id == id));
    for target in targets {
        let current = injected.get(&target.id).cloned();
        if paused {
            if current
                .as_ref()
                .is_none_or(|entry| entry.revision != "paused")
            {
                remove_target(
                    &target,
                    port,
                    current
                        .as_ref()
                        .and_then(|entry| entry.early_script_id.as_deref()),
                )?;
                injected.insert(
                    target.id,
                    InjectedTarget {
                        revision: "paused".to_string(),
                        early_script_id: None,
                    },
                );
            }
        } else if let Some(payload) = &payload {
            let needs_injection = current
                .as_ref()
                .is_none_or(|entry| entry.revision != payload.revision);
            if needs_injection {
                match inject_target(
                    &target,
                    port,
                    payload,
                    current
                        .as_ref()
                        .and_then(|entry| entry.early_script_id.as_deref()),
                ) {
                    Ok(next) => {
                        injected.insert(target.id, next);
                    }
                    Err(error) => {
                        eprintln!("Dream Skin target {}: {error}", target.id);
                    }
                }
            }
        }
    }
    Ok(())
}

fn recover_running_codex(paths: &RuntimePaths) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    if SKIN_LAUNCHING.load(Ordering::Acquire) {
        return Ok(());
    }
    // A normal launch can leave renderer/helper processes alive after its
    // shell exits.  Ensure the old instance is completely gone before asking
    // the OS to start the managed instance with the debugging arguments.
    crate::commands::stop_chatgpt_processes()?;
    crate::commands::wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    restart_with_skin(paths)
}

fn monitor_loop(control: Arc<MonitorControl>) {
    let mut injected = HashMap::new();
    let mut last_port = None;
    let mut unavailable_iterations = 0;
    loop {
        let paths = {
            let guard = control
                .paths
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let (guard, _) = control
                .wake
                .wait_timeout(guard, Duration::from_millis(250))
                .unwrap_or_else(|error| error.into_inner());
            guard.clone()
        };
        let Some(paths) = paths else {
            continue;
        };
        if let Err(error) = monitor_iteration(
            &paths,
            &mut injected,
            &mut last_port,
            &mut unavailable_iterations,
        ) {
            if !error.contains("CDP is unavailable") {
                eprintln!("Dream Skin native monitor: {error}");
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn has_running_codex_install() -> bool {
    // ChatGPT's bootstrap executable can exit shortly after handing control
    // to the persistent `codex.exe` process.  Looking only for ChatGPT.exe
    // therefore misses a manually started client before recovery begins.
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system.processes().values().any(|process| {
        let name = process.name().to_string_lossy();
        matches!(
            name.as_ref().to_ascii_lowercase().as_str(),
            "chatgpt" | "chatgpt.exe" | "codex" | "codex.exe"
        )
    })
}

#[cfg(not(target_os = "windows"))]
fn has_running_codex_install() -> bool {
    false
}

fn ensure_monitor(paths: RuntimePaths) {
    let control = MONITOR.get_or_init(|| {
        let control = Arc::new(MonitorControl {
            paths: Mutex::new(None),
            wake: Condvar::new(),
        });
        let background = Arc::clone(&control);
        thread::Builder::new()
            .name("dream-skin-native-monitor".to_string())
            .spawn(move || monitor_loop(background))
            .expect("failed to start Dream Skin native monitor");
        control
    });
    *control
        .paths
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(paths);
    control.wake.notify_all();
}

fn wake_monitor() {
    if let Some(control) = MONITOR.get() {
        control.wake.notify_all();
    }
}

fn wait_for_targets(port: u16, timeout: Duration) -> Result<Vec<CdpTarget>, String> {
    let deadline = Instant::now() + timeout;
    let mut last_error = String::new();
    while Instant::now() < deadline {
        match list_targets(port) {
            Ok(targets) if !targets.is_empty() => return Ok(targets),
            Ok(_) => last_error = "no Codex renderer target was published".to_string(),
            Err(error) => last_error = error,
        }
        thread::sleep(Duration::from_millis(300));
    }
    Err(format!(
        "Codex did not expose a renderer on 127.0.0.1:{port}: {last_error}"
    ))
}

fn verification_succeeded(results: &[Value]) -> bool {
    results.iter().any(|entry| {
        entry
            .get("result")
            .and_then(|result| result.get("pass"))
            .and_then(Value::as_bool)
            == Some(true)
    })
}

fn wait_for_verified(port: u16, timeout: Duration) -> Result<Vec<Value>, String> {
    let deadline = Instant::now() + timeout;
    let mut last_results = Vec::new();
    let mut last_error = String::new();
    while Instant::now() < deadline {
        match list_targets(port) {
            Ok(targets) => {
                last_results.clear();
                for target in targets {
                    match CdpSession::connect(&target, port).and_then(|mut session| {
                        session.enable()?;
                        session.evaluate(VERIFY_PAYLOAD)
                    }) {
                        Ok(value) => {
                            last_results.push(json!({ "targetId": target.id, "result": value }))
                        }
                        Err(error) => last_error = error,
                    }
                }
                if verification_succeeded(&last_results) {
                    return Ok(last_results);
                }
            }
            Err(error) => last_error = error,
        }
        thread::sleep(Duration::from_millis(400));
    }
    Err(format!(
        "Dream Skin verification timed out: {}; last result: {}",
        last_error,
        serde_json::to_string(&last_results).unwrap_or_default()
    ))
}

fn select_port() -> Result<u16, String> {
    for port in DEFAULT_CDP_PORT..=DEFAULT_CDP_PORT + 100 {
        if TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok() {
            return Ok(port);
        }
    }
    Err("No free local CDP port was found between 9335 and 9435.".to_string())
}

fn path_eq(left: &Path, right: &Path) -> bool {
    #[cfg(target_os = "windows")]
    return left
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy());
    #[cfg(not(target_os = "windows"))]
    return left == right;
}

fn same_install(left: &CodexInstall, right: &CodexInstall) -> bool {
    path_eq(&left.executable, &right.executable)
}

fn stop_codex(install: &CodexInstall) -> Result<(), String> {
    let expected = install
        .executable
        .canonicalize()
        .unwrap_or_else(|_| install.executable.clone());
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);
        let mut found = false;
        for process in system.processes().values() {
            let Some(executable) = process.exe() else {
                continue;
            };
            let executable = executable
                .canonicalize()
                .unwrap_or_else(|_| executable.to_path_buf());
            if path_eq(&executable, &expected) {
                found = true;
                let _ = process.kill();
            }
        }
        if !found {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("Codex could not be stopped safely.".to_string());
        }
        thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(target_os = "windows")]
fn find_codex_installs() -> Result<Vec<((u16, u16, u16, u16), CodexInstall)>, String> {
    use windows::{
        core::HSTRING,
        Management::Deployment::PackageManager,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };

    struct RuntimeGuard;
    impl Drop for RuntimeGuard {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
        .map_err(|error| format!("Failed to initialize the Windows package runtime: {error}"))?;
    let _runtime = RuntimeGuard;
    let manager = PackageManager::new()
        .map_err(|error| format!("Failed to open the Windows package manager: {error}"))?;
    let packages = manager
        .FindPackagesByUserSecurityId(&HSTRING::new())
        .map_err(|error| format!("Failed to enumerate installed Windows packages: {error}"))?;
    let mut matches = Vec::new();
    for package in packages {
        let id = package
            .Id()
            .map_err(|error| format!("Failed to inspect a package id: {error}"))?;
        if id.Name().map(|name| name.to_string()).unwrap_or_default() != "OpenAI.Codex"
            || package.IsDevelopmentMode().unwrap_or(true)
            || package.SignatureKind().ok()
                != Some(windows::ApplicationModel::PackageSignatureKind::Store)
        {
            continue;
        }
        let executable = PathBuf::from(
            package
                .InstalledLocation()
                .and_then(|folder| folder.Path())
                .map_err(|error| format!("Failed to resolve the Codex package path: {error}"))?
                .to_string(),
        )
        .join("app")
        .join("ChatGPT.exe");
        if !executable.is_file() {
            continue;
        }
        let entries = package
            .GetAppListEntries()
            .map_err(|error| format!("Failed to read Codex application identity: {error}"))?;
        for index in 0..entries
            .Size()
            .map_err(|error| format!("Failed to read Codex application identity: {error}"))?
        {
            let aumid = entries
                .GetAt(index)
                .and_then(|entry| entry.AppUserModelId())
                .map_err(|error| format!("Failed to read Codex application identity: {error}"))?
                .to_string();
            if aumid.starts_with(&format!("{}!", id.FamilyName().unwrap_or_default())) {
                let version = id.Version().unwrap_or_default();
                matches.push((
                    (
                        version.Major,
                        version.Minor,
                        version.Build,
                        version.Revision,
                    ),
                    CodexInstall {
                        executable: executable.clone(),
                        app_user_model_id: Some(aumid),
                    },
                ));
            }
        }
    }
    if matches.is_empty() {
        return Err(
            "The official OpenAI Codex Microsoft Store package is not installed.".to_string(),
        );
    }
    Ok(matches)
}

#[cfg(target_os = "windows")]
fn find_running_codex_install() -> Option<CodexInstall> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    for process in system.processes().values() {
        let Some(executable) = process.exe() else {
            continue;
        };
        if !executable
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("ChatGPT.exe"))
        {
            continue;
        }
        let executable = executable
            .canonicalize()
            .unwrap_or_else(|_| executable.to_path_buf());
        let is_codex_shell = executable.parent().is_some_and(|app_dir| {
            app_dir
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("app"))
                && app_dir.join("resources").join("codex.exe").is_file()
        });
        if is_codex_shell {
            return Some(CodexInstall {
                executable,
                app_user_model_id: None,
            });
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn find_default_codex_install() -> Result<CodexInstall, String> {
    let mut installs = find_codex_installs()?;
    installs.sort_by_key(|(version, _)| *version);
    installs.pop().map(|(_, install)| install).ok_or_else(|| {
        "The official OpenAI Codex Microsoft Store package is not installed.".to_string()
    })
}

#[cfg(target_os = "windows")]
fn find_codex_install() -> Result<CodexInstall, String> {
    if let Some(running) = find_running_codex_install() {
        return Ok(running);
    }
    find_default_codex_install()
}

fn remembered_codex_install() -> Option<CodexInstall> {
    let executable = read_session().codex_executable.map(PathBuf::from)?;
    if !executable.is_file() {
        return None;
    }
    #[cfg(target_os = "windows")]
    return Some(CodexInstall {
        executable,
        app_user_model_id: None,
    });
    #[cfg(target_os = "macos")]
    Some(CodexInstall { executable })
}

fn find_skin_launch_install() -> Result<CodexInstall, String> {
    remembered_codex_install()
        .map(Ok)
        .unwrap_or_else(find_codex_install)
}

#[cfg(target_os = "windows")]
fn launch_codex(install: &CodexInstall, arguments: &str) -> Result<u32, String> {
    use windows::{
        core::HSTRING,
        Win32::{
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_LOCAL_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{ApplicationActivationManager, IApplicationActivationManager, AO_NONE},
        },
    };

    if let Some(app_user_model_id) = &install.app_user_model_id {
        struct ComGuard;
        impl Drop for ComGuard {
            fn drop(&mut self) {
                unsafe { CoUninitialize() };
            }
        }

        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
            .ok()
            .map_err(|error| format!("Failed to initialize Windows app activation: {error}"))?;
        let _com = ComGuard;
        let manager: IApplicationActivationManager = unsafe {
            CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)
        }
        .map_err(|error| format!("Failed to create Windows app activation manager: {error}"))?;
        return unsafe {
            manager.ActivateApplication(
                &HSTRING::from(app_user_model_id),
                &HSTRING::from(arguments),
                AO_NONE,
            )
        }
        .map_err(|error| format!("Failed to launch Codex: {error}"));
    }

    let mut command = Command::new(&install.executable);
    for argument in arguments.split_whitespace() {
        command.arg(argument);
    }
    command.spawn().map(|child| child.id()).map_err(|error| {
        format!(
            "Failed to launch Codex from {}: {error}",
            install.executable.display()
        )
    })
}

#[cfg(target_os = "macos")]
fn find_macos_codex_install_in(applications_dir: &Path) -> Option<CodexInstall> {
    [
        applications_dir
            .join("ChatGPT.app")
            .join("Contents")
            .join("MacOS")
            .join("ChatGPT"),
        applications_dir
            .join("Codex.app")
            .join("Contents")
            .join("MacOS")
            .join("Codex"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .map(|executable| CodexInstall { executable })
}

#[cfg(target_os = "macos")]
fn find_codex_install() -> Result<CodexInstall, String> {
    let mut applications_dirs = vec![PathBuf::from("/Applications")];
    if let Some(home) = dirs::home_dir() {
        applications_dirs.insert(0, home.join("Applications"));
    }
    applications_dirs
        .into_iter()
        .find_map(|directory| find_macos_codex_install_in(&directory))
        .ok_or_else(|| {
            "The official ChatGPT/Codex app is not installed in Applications.".to_string()
        })
}

#[cfg(target_os = "macos")]
fn find_default_codex_install() -> Result<CodexInstall, String> {
    find_codex_install()
}

#[cfg(target_os = "macos")]
fn launch_codex(install: &CodexInstall, arguments: &str) -> Result<u32, String> {
    let mut command = Command::new(&install.executable);
    for argument in arguments.split_whitespace() {
        command.arg(argument);
    }
    command
        .spawn()
        .map(|child| child.id())
        .map_err(|error| format!("Failed to launch Codex: {error}"))
}

fn start_with_skin(paths: &RuntimePaths, install: &CodexInstall) -> Result<(), String> {
    let _launch = SkinLaunchGuard::acquire();
    stop_codex(&install)?;
    let port = select_port()?;
    let arguments = format!("--remote-debugging-address=127.0.0.1 --remote-debugging-port={port}");
    let mut state = read_session();
    state.session = "active".to_string();
    state.port = Some(port);
    state.codex_executable = Some(install.executable.display().to_string());
    write_session(&state)?;
    launch_codex(&install, &arguments)?;
    ensure_monitor(paths.clone());
    wake_monitor();
    wait_for_targets(port, Duration::from_secs(30))?;
    wake_monitor();
    wait_for_verified(port, Duration::from_secs(30))?;
    Ok(())
}

fn restart_with_skin(paths: &RuntimePaths) -> Result<(), String> {
    // The current process is often already gone on a normal restart.  Prefer
    // the executable that originally activated the skin instead of falling
    // back to whichever Store installation happens to be discoverable.
    let install = find_skin_launch_install()?;
    let fallback = find_default_codex_install()
        .ok()
        .filter(|fallback| !same_install(&install, fallback));
    match start_with_skin(paths, &install) {
        Ok(()) => Ok(()),
        Err(primary_error) if fallback.is_some() => {
            let _ = stop_codex(&install);
            let fallback = fallback.expect("checked above");
            start_with_skin(paths, &fallback).map_err(|fallback_error| {
                format!(
                    "Dream Skin could not start from the running ChatGPT path ({}): {primary_error}; fallback path ({}) also failed: {fallback_error}",
                    install.executable.display(),
                    fallback.executable.display(),
                )
            })
        }
        Err(error) => Err(error),
    }
}

pub(crate) fn setup(app: &AppHandle) -> Result<(), String> {
    if !marker_path()?.is_file() {
        return Ok(());
    }
    let root = bundled_root(app)?;
    initialize_store(&root)?;
    ensure_monitor(RuntimePaths { bundled_root: root });
    Ok(())
}

pub(crate) fn restart_active_session() -> Result<bool, String> {
    if !marker_path()?.is_file() || pause_path()?.is_file() {
        return Ok(false);
    }
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let paths = MONITOR
        .get()
        .and_then(|control| {
            control
                .paths
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone()
        })
        .ok_or_else(|| "Dream Skin runtime is not initialized.".to_string())?;
    restart_with_skin(&paths)?;
    Ok(true)
}

fn install_unlocked(app: &AppHandle, restart_chatgpt: bool) -> Result<(), String> {
    let root = bundled_root(app)?;
    initialize_store(&root)?;
    write_json(
        &marker_path()?,
        &InstallationMarker {
            schema_version: 1,
            runtime: "rust-native".to_string(),
            version: NATIVE_RUNTIME_VERSION.to_string(),
        },
    )?;
    if !session_path()?.is_file() {
        write_session(&NativeSessionState::default())?;
    }
    let paths = RuntimePaths { bundled_root: root };
    if restart_chatgpt {
        restart_with_skin(&paths)
    } else {
        ensure_monitor(paths);
        Ok(())
    }
}

pub(crate) fn install(app: &AppHandle) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    install_unlocked(app, true)
}

fn ensure_installed(app: &AppHandle) -> Result<RuntimePaths, String> {
    if !marker_path()?.is_file() {
        install_unlocked(app, false)?;
    }
    let paths = RuntimePaths {
        bundled_root: bundled_root(app)?,
    };
    initialize_store(&paths.bundled_root)?;
    ensure_monitor(paths.clone());
    Ok(paths)
}

pub(crate) fn apply_theme(app: &AppHandle, theme_id: &str) -> Result<(), String> {
    if !valid_theme_id(theme_id) {
        return Err("Theme id is invalid.".to_string());
    }
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let paths = ensure_installed(app)?;
    let directory = if BUILT_IN_THEME_IDS.contains(&theme_id) {
        built_in_theme_directory(&paths.bundled_root, theme_id)?
    } else {
        saved_theme_directory(theme_id)?
    };
    copy_theme_to_active(&directory)?;
    let _ = fs::remove_file(pause_path()?);
    restart_with_skin(&paths)
}

fn validate_import_options(options: &DreamSkinImportOptions) -> Result<(), String> {
    validate_name(&options.name)?;
    if !matches!(options.appearance.as_str(), "auto" | "light" | "dark") {
        return Err("Theme appearance is invalid.".to_string());
    }
    if !matches!(
        options.safe_area.as_str(),
        "auto" | "left" | "right" | "center" | "none"
    ) {
        return Err("Theme safe area is invalid.".to_string());
    }
    if !matches!(
        options.task_mode.as_str(),
        "auto" | "ambient" | "banner" | "off"
    ) {
        return Err("Theme task mode is invalid.".to_string());
    }
    for focus in [options.focus_x, options.focus_y].into_iter().flatten() {
        if !focus.is_finite() || !(0.0..=1.0).contains(&focus) {
            return Err("Theme focus coordinates must be between 0 and 1.".to_string());
        }
    }
    Ok(())
}

pub(crate) fn import_image(
    app: &AppHandle,
    path: &str,
    options: &DreamSkinImportOptions,
) -> Result<(), String> {
    validate_import_options(options)?;
    let source = PathBuf::from(path);
    image_details(&source)?;
    ensure_no_reparse_points(&source)?;
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let paths = ensure_installed(app)?;
    let staging = state_root()?.join("import-staging");
    ensure_directory(&staging)?;
    let (mime, _, _) = image_details(&source)?;
    let extension = match mime {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let image_name = format!("art.{extension}");
    fs::copy(&source, staging.join(&image_name))
        .map_err(|error| format!("Failed to import theme image: {error}"))?;
    let document = json!({
        "schemaVersion": 1,
        "id": "custom",
        "name": options.name.trim(),
        "brandSubtitle": "CODEX DREAM SKIN",
        "tagline": "Make something wonderful.",
        "projectPrefix": "Select project - ",
        "projectLabel": "Select project",
        "statusText": "DREAM SKIN ONLINE",
        "quote": "MAKE SOMETHING WONDERFUL",
        "image": image_name,
        "appearance": options.appearance,
        "art": {
            "focusX": options.focus_x,
            "focusY": options.focus_y,
            "safeArea": options.safe_area,
            "taskMode": options.task_mode
        },
        "palette": {}
    });
    write_json(&staging.join("theme.json"), &document)?;
    copy_theme_to_active(&staging)?;
    save_current_theme(&options.name)?;
    let _ = fs::remove_file(pause_path()?);
    restart_with_skin(&paths)
}

pub(crate) fn save_theme(app: &AppHandle, name: &str) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    ensure_installed(app)?;
    save_current_theme(name)?;
    Ok(())
}

pub(crate) fn set_appearance(app: &AppHandle, appearance: &str) -> Result<(), String> {
    if !matches!(appearance, "auto" | "light" | "dark") {
        return Err("Theme appearance is invalid.".to_string());
    }
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let paths = ensure_installed(app)?;
    let active_root = active_theme_root()?;
    let mut document = load_theme(&active_root)?.document;
    let object = document
        .as_object_mut()
        .ok_or_else(|| "Theme metadata root must be an object.".to_string())?;
    object.remove("artMetadata");
    object.insert(
        "appearance".to_string(),
        Value::String(appearance.to_string()),
    );
    write_json(&active_root.join("theme.json"), &document)?;
    ensure_monitor(paths);
    wake_monitor();
    Ok(())
}

pub(crate) fn set_paused(app: &AppHandle, paused: bool) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let paths = ensure_installed(app)?;
    if paused {
        fs::write(pause_path()?, b"paused\n")
            .map_err(|error| format!("Failed to pause Dream Skin: {error}"))?;
        let state = read_session();
        if let Some(port) = state.port {
            if let Ok(targets) = list_targets(port) {
                for target in targets {
                    let _ = remove_target(&target, port, None);
                }
            }
        }
        let mut state = state;
        state.session = "paused".to_string();
        write_session(&state)?;
        wake_monitor();
        Ok(())
    } else {
        let _ = fs::remove_file(pause_path()?);
        restart_with_skin(&paths)
    }
}

pub(crate) fn reapply(app: &AppHandle) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let paths = ensure_installed(app)?;
    let _ = fs::remove_file(pause_path()?);
    restart_with_skin(&paths)
}

pub(crate) fn verify(app: &AppHandle) -> Result<String, String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    ensure_installed(app)?;
    let state = read_session();
    let port = state.port.ok_or_else(|| {
        "Dream Skin is installed but Codex has not been launched with it.".to_string()
    })?;
    let targets = wait_for_verified(port, Duration::from_secs(10))?;
    serde_json::to_string_pretty(&json!({
        "pass": true,
        "runtime": "rust-native",
        "runtimeVersion": NATIVE_RUNTIME_VERSION,
        "skinVersion": SKIN_VERSION,
        "port": port,
        "targets": targets
    }))
    .map_err(|error| format!("Failed to serialize verification result: {error}"))
}

pub(crate) fn restore(app: &AppHandle) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    if !marker_path()?.is_file() {
        return Err("Dream Skin is not installed.".to_string());
    }
    let state = read_session();
    if let Some(port) = state.port {
        if let Ok(targets) = list_targets(port) {
            for target in targets {
                let _ = remove_target(&target, port, None);
            }
        }
    }
    let install = find_codex_install()?;
    stop_codex(&install)?;
    for path in [marker_path()?, session_path()?, pause_path()?] {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Failed to remove {}: {error}", path.display())),
        }
    }
    launch_codex(&install, "")?;
    wake_monitor();
    let _ = app;
    Ok(())
}

fn list_saved_themes() -> Vec<DreamSkinThemeSummary> {
    let Ok(root) = themes_root() else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut themes = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let Ok(theme) = load_theme(&entry.path()) else {
            continue;
        };
        let Some(id) = theme
            .document
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| valid_theme_id(id))
        else {
            continue;
        };
        if RETIRED_THEME_IDS.contains(&id) {
            continue;
        }
        let name = theme
            .document
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(id);
        themes.push(DreamSkinThemeSummary {
            id: id.to_string(),
            name: name.to_string(),
        });
    }
    themes.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    themes
}

pub(crate) fn status(platform: &str) -> DreamSkinStatus {
    let installed = marker_path().is_ok_and(|path| path.is_file());
    let paused = pause_path().is_ok_and(|path| path.is_file());
    let session_state = read_session();
    let active = active_theme_root()
        .ok()
        .and_then(|path| load_theme(&path).ok());
    let session = if !installed {
        "notInstalled"
    } else if paused || session_state.session == "paused" {
        "paused"
    } else if session_state.port.is_some() && session_state.session == "active" {
        "active"
    } else {
        "ready"
    };
    DreamSkinStatus {
        supported: true,
        platform: platform.to_string(),
        installed,
        runtime_installed: installed,
        session: session.to_string(),
        active_theme_id: active
            .as_ref()
            .and_then(|theme| theme.document.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string),
        active_theme_name: active
            .as_ref()
            .and_then(|theme| theme.document.get("name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        active_theme_appearance: active
            .as_ref()
            .and_then(|theme| theme.document.get("appearance"))
            .and_then(Value::as_str)
            .map(str::to_string),
        engine_path: marker_path().ok().map(|path| path.display().to_string()),
        saved_themes: list_saved_themes(),
    }
}

pub(crate) fn theme_preview(theme_id: &str) -> Result<Option<String>, String> {
    if !valid_theme_id(theme_id) {
        return Err("Theme id is invalid.".to_string());
    }
    if BUILT_IN_THEME_IDS.contains(&theme_id) {
        return Ok(None);
    }
    let theme = load_theme(&saved_theme_directory(theme_id)?)?;
    Ok(Some(format!(
        "data:{};base64,{}",
        theme.mime,
        BASE64.encode(theme.image_bytes)
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_theme_ids() {
        assert!(valid_theme_id("preset-rose-reverie"));
        assert!(valid_theme_id("20260719-120000-deadbeef"));
        assert!(!valid_theme_id("../escape"));
        assert!(!valid_theme_id(""));
    }

    #[test]
    fn native_marker_identifies_rust_runtime() {
        let marker = InstallationMarker {
            schema_version: 1,
            runtime: "rust-native".to_string(),
            version: NATIVE_RUNTIME_VERSION.to_string(),
        };
        let value = serde_json::to_value(marker).unwrap();
        assert_eq!(value["runtime"], "rust-native");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_payload_replaces_all_renderer_placeholders() {
        let template = include_str!("../resources/dream-skin/assets/macos/renderer-inject.js");
        let payload = render_payload(
            template,
            "html { color: red; }",
            "data:image/png;base64,AA==",
            &json!({ "id": "test-theme" }),
        )
        .unwrap();

        for placeholder in [
            "__DREAM_SKIN_CSS_JSON__",
            "__DREAM_SKIN_ART_JSON__",
            "__DREAM_SKIN_THEME_JSON__",
            "__DREAM_SKIN_VERSION_JSON__",
            "__DREAM_SKIN_STYLE_REVISION_JSON__",
            "__DREAM_SKIN_PAYLOAD_REVISION_JSON__",
        ] {
            assert!(!payload.source.contains(placeholder));
        }
        assert_eq!(payload.revision.len(), 20);
        assert!(payload.source.contains("test-theme"));
    }

    #[test]
    fn cdp_target_rejects_remote_hosts() {
        let target = CdpTarget {
            id: "page-1".to_string(),
            kind: "page".to_string(),
            url: "app://codex/".to_string(),
            web_socket_debugger_url: "ws://example.com:9335/devtools/page/page-1".to_string(),
        };
        assert!(validate_target(&target, 9335).is_err());
    }

    #[test]
    fn cdp_command_deadline_is_absolute() {
        let error = cdp_command_remaining(Instant::now(), "Runtime.enable").unwrap_err();
        assert!(error.contains("CDP command timed out: Runtime.enable"));
        assert!(
            cdp_command_remaining(Instant::now() + Duration::from_secs(1), "Runtime.enable")
                .is_ok()
        );
    }

    #[test]
    fn verification_accepts_one_primary_target_among_auxiliary_targets() {
        let auxiliary = json!({ "result": { "pass": false } });
        let primary = json!({ "result": { "pass": true } });

        assert!(verification_succeeded(&[auxiliary.clone(), primary]));
        assert!(!verification_succeeded(&[auxiliary]));
        assert!(!verification_succeeded(&[]));
    }

    #[test]
    fn bundled_themes_are_loadable() {
        let bundled_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dream-skin");
        for theme_id in BUILT_IN_THEME_IDS {
            let directory = built_in_theme_directory(&bundled_root, theme_id)
                .unwrap_or_else(|error| panic!("{theme_id} directory is invalid: {error}"));
            let theme = load_theme(&directory)
                .unwrap_or_else(|error| panic!("{theme_id} failed to load: {error}"));
            assert_eq!(theme.document["id"], theme_id);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_discovers_current_and_legacy_app_names() {
        let applications_dir = std::env::temp_dir().join(format!(
            "codex-switch-macos-install-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let chatgpt = applications_dir
            .join("ChatGPT.app")
            .join("Contents")
            .join("MacOS")
            .join("ChatGPT");
        let codex = applications_dir
            .join("Codex.app")
            .join("Contents")
            .join("MacOS")
            .join("Codex");
        fs::create_dir_all(chatgpt.parent().unwrap()).unwrap();
        fs::create_dir_all(codex.parent().unwrap()).unwrap();
        fs::write(&chatgpt, b"").unwrap();
        fs::write(&codex, b"").unwrap();

        let current = find_macos_codex_install_in(&applications_dir).unwrap();
        assert_eq!(current.executable, chatgpt);

        fs::remove_file(&chatgpt).unwrap();
        let legacy = find_macos_codex_install_in(&applications_dir).unwrap();
        assert_eq!(legacy.executable, codex);

        fs::remove_dir_all(applications_dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires the official ChatGPT/Codex application"]
    fn discovers_official_codex_application() {
        let install = find_default_codex_install()
            .expect("official ChatGPT/Codex application should be discoverable");
        assert!(
            install
                .executable
                .ends_with("ChatGPT.app/Contents/MacOS/ChatGPT")
                || install
                    .executable
                    .ends_with("Codex.app/Contents/MacOS/Codex")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "requires the official Codex Store package"]
    fn discovers_official_codex_package() {
        let install =
            find_default_codex_install().expect("official Codex package should be discoverable");
        assert!(install.executable.ends_with("app\\ChatGPT.exe"));
        assert!(install.app_user_model_id.is_some_and(|id| id.contains('!')));
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "restarts the locally installed Codex app"]
    fn launches_and_injects_with_native_runtime() {
        let bundled_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dream-skin");
        initialize_store(&bundled_root).expect("theme store should initialize");
        write_json(
            &marker_path().unwrap(),
            &InstallationMarker {
                schema_version: 1,
                runtime: "rust-native".to_string(),
                version: NATIVE_RUNTIME_VERSION.to_string(),
            },
        )
        .unwrap();
        write_session(&NativeSessionState::default()).unwrap();
        restart_with_skin(&RuntimePaths { bundled_root })
            .expect("native runtime should launch and inject Codex");
    }
}
