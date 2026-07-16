use tauri::{
    webview::Color, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl,
    WebviewWindowBuilder, Window,
};

use crate::{
    commands,
    models::{AppSettings, BubbleResetDisplay, UsageWindow},
    providers,
    storage::{read_app_settings, write_app_settings},
};

pub(crate) const BUBBLE_LABEL: &str = "usage-bubble";
const COLLAPSED_WIDTH: f64 = 108.0;
const COLLAPSED_HEIGHT: f64 = 108.0;
const EXPANDED_WIDTH: f64 = 304.0;
const EXPANDED_HEIGHT: f64 = 298.0;
const SCREEN_MARGIN: f64 = 22.0;
const MENU_SCREEN_MARGIN: f64 = 8.0;
const MENU_EMAIL_CHARS: usize = 15;
const MENU_VERTICAL_ATTACH_RATIO: f64 = 0.58;
const BUBBLE_SIZE: f64 = 92.0;
const BUBBLE_EDGE_INSET: f64 = 8.0;
const HEX_COLOR_LEN: usize = 7;

pub(crate) fn setup<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let settings = read_app_settings(app)?;
    if settings.floating_bubble_enabled {
        create(app, &settings)?;
    }
    Ok(())
}

fn create<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let (x, y) = restored_or_default_position(app, settings);
    let window = WebviewWindowBuilder::new(
        app,
        BUBBLE_LABEL,
        WebviewUrl::App("index.html#bubble".into()),
    )
    .title("Codex Usage")
    .inner_size(COLLAPSED_WIDTH, COLLAPSED_HEIGHT)
    .position(x, y)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .decorations(false)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .build()
    .map_err(|error| error.to_string())?;
    window.on_menu_event(|window, event| {
        crate::system_tray::handle_menu_event(window.app_handle(), event);
    });
    Ok(())
}

fn restored_or_default_position<R: Runtime>(
    app: &AppHandle<R>,
    settings: &AppSettings,
) -> (f64, f64) {
    if let (Some(x), Some(y)) = (settings.bubble_x, settings.bubble_y) {
        if position_is_visible(app, x, y) {
            return (x, y);
        }
    }

    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return (SCREEN_MARGIN, SCREEN_MARGIN);
    };
    let area = monitor.work_area();
    let position = area.position.to_logical::<f64>(monitor.scale_factor());
    let size = area.size.to_logical::<f64>(monitor.scale_factor());
    (
        position.x + size.width - COLLAPSED_WIDTH - SCREEN_MARGIN,
        position.y + size.height - COLLAPSED_HEIGHT - SCREEN_MARGIN,
    )
}

fn position_is_visible<R: Runtime>(app: &AppHandle<R>, x: f64, y: f64) -> bool {
    app.available_monitors().is_ok_and(|monitors| {
        monitors.into_iter().any(|monitor| {
            let area = monitor.work_area();
            let position = area.position.to_logical::<f64>(monitor.scale_factor());
            let size = area.size.to_logical::<f64>(monitor.scale_factor());
            x + COLLAPSED_WIDTH > position.x
                && x < position.x + size.width
                && y + COLLAPSED_HEIGHT > position.y
                && y < position.y + size.height
        })
    })
}

#[tauri::command]
pub(crate) fn get_app_settings<R: Runtime>(app: AppHandle<R>) -> Result<AppSettings, String> {
    read_app_settings(&app)
}

#[tauri::command]
pub(crate) async fn set_floating_bubble<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.floating_bubble_enabled = enabled;
    write_app_settings(&app, &settings)?;

    if enabled {
        create(&app, &settings)?;
    } else if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_privacy_mode<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.privacy_mode = enabled;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_bubble_reset_display<R: Runtime>(
    app: AppHandle<R>,
    display: BubbleResetDisplay,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.bubble_reset_display = display;
    write_app_settings(&app, &settings)?;
    let event_name = "bubble-reset-display-changed";
    let event_payload = settings.bubble_reset_display.clone();
    app.emit(event_name, event_payload.clone())
        .map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        window
            .emit(event_name, event_payload)
            .map_err(|error| error.to_string())?;
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_theme_color<R: Runtime>(
    app: AppHandle<R>,
    color: String,
) -> Result<AppSettings, String> {
    if !is_hex_color(&color) {
        return Err("theme color must be a #rrggbb hex value".to_string());
    }
    let normalized = color.to_ascii_lowercase();
    let mut settings = read_app_settings(&app)?;
    settings.theme_color = Some(normalized.clone());
    write_app_settings(&app, &settings)?;
    app.emit("theme-color-changed", normalized)
        .map_err(|error| error.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_app_language<R: Runtime>(
    app: AppHandle<R>,
    language: String,
) -> Result<(), String> {
    if !matches!(language.as_str(), "en" | "zh") {
        return Err("language must be en or zh".to_string());
    }
    let mut settings = read_app_settings(&app)?;
    settings.language = Some(language);
    write_app_settings(&app, &settings)?;
    crate::system_tray::refresh_menu(&app);
    Ok(())
}

fn is_hex_color(color: &str) -> bool {
    color.len() == HEX_COLOR_LEN
        && color.starts_with('#')
        && color.chars().skip(1).all(|char| char.is_ascii_hexdigit())
}

#[tauri::command]
pub(crate) fn resize_floating_bubble<R: Runtime>(
    app: AppHandle<R>,
    expanded: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window(BUBBLE_LABEL)
        .ok_or_else(|| "悬浮球窗口不存在".to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let anchor_x = position.x + size.width - COLLAPSED_WIDTH;
    let anchor_y = position.y + size.height - COLLAPSED_HEIGHT;
    let (width, height) = if expanded {
        (EXPANDED_WIDTH, EXPANDED_HEIGHT)
    } else {
        (COLLAPSED_WIDTH, COLLAPSED_HEIGHT)
    };

    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(LogicalPosition::new(
            anchor_x - (width - COLLAPSED_WIDTH),
            anchor_y - (height - COLLAPSED_HEIGHT),
        ))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn drag_floating_bubble<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.get_webview_window(BUBBLE_LABEL)
        .ok_or_else(|| "悬浮球窗口不存在".to_string())?
        .start_dragging()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn show_floating_bubble_menu<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window(BUBBLE_LABEL)
        .ok_or_else(|| "floating bubble window does not exist".to_string())?;
    let menu = crate::system_tray::build_menu(&app).map_err(|error| error.to_string())?;
    let position = floating_menu_position(&app, &window)?;
    window
        .popup_menu_at(&menu, position)
        .map_err(|error| error.to_string())
}

fn floating_menu_position<R: Runtime>(
    app: &AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) -> Result<LogicalPosition<f64>, String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let window_position = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let window_size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return Ok(LogicalPosition::new(0.0, 0.0));
    };
    let area = monitor.work_area();
    let area_position = area.position.to_logical::<f64>(monitor.scale_factor());
    let area_size = area.size.to_logical::<f64>(monitor.scale_factor());
    let (menu_width, menu_height) = estimated_floating_menu_size(app);
    let area_right = area_position.x + area_size.width;
    let area_bottom = area_position.y + area_size.height;

    let bubble_center_x =
        window_position.x + window_size.width - BUBBLE_EDGE_INSET - (BUBBLE_SIZE / 2.0);
    let bubble_top_y = window_position.y + window_size.height - BUBBLE_EDGE_INSET - BUBBLE_SIZE;
    let mut menu_screen_x = bubble_center_x - (menu_width / 2.0);
    let mut menu_screen_y = bubble_top_y - (menu_height * MENU_VERTICAL_ATTACH_RATIO);
    menu_screen_x = clamp_menu_axis(
        menu_screen_x,
        area_position.x + MENU_SCREEN_MARGIN,
        area_right - menu_width - MENU_SCREEN_MARGIN,
    );
    menu_screen_y = clamp_menu_axis(
        menu_screen_y,
        area_position.y + MENU_SCREEN_MARGIN,
        area_bottom - menu_height - MENU_SCREEN_MARGIN,
    );

    Ok(LogicalPosition::new(
        menu_screen_x - window_position.x,
        menu_screen_y - window_position.y,
    ))
}

fn clamp_menu_axis(value: f64, min: f64, max: f64) -> f64 {
    if max < min {
        min
    } else {
        value.clamp(min, max)
    }
}

fn estimated_floating_menu_size<R: Runtime>(app: &AppHandle<R>) -> (f64, f64) {
    let mut labels = match commands::list_accounts(app.clone()) {
        Ok(accounts) if accounts.is_empty() => vec!["No accounts".to_string()],
        Ok(accounts) => accounts
            .into_iter()
            .map(|account| {
                format!(
                    "{} | 5h {} | 1week {}",
                    truncate_menu_email(&account.email),
                    menu_remaining_label(account.usage.primary.as_ref()),
                    menu_remaining_label(account.usage.secondary.as_ref()),
                )
            })
            .collect::<Vec<_>>(),
        Err(error) => vec![format!("Accounts error: {error}")],
    };
    labels.push("Providers".to_string());
    match providers::list_providers(app.clone()) {
        Ok(providers) if providers.is_empty() => labels.push("No providers".to_string()),
        Ok(providers) => labels.extend(
            providers
                .into_iter()
                .map(|provider| crate::system_tray::provider_label(&provider)),
        ),
        Err(error) => labels.push(format!("Providers error: {error}")),
    }
    let max_chars = labels
        .iter()
        .map(|label| label.chars().count())
        .chain([9, 8, 8])
        .max()
        .unwrap_or(20);
    let width = ((max_chars as f64) * 8.8 + 92.0).clamp(230.0, 520.0);
    let height = ((labels.len() + 3) as f64) * 32.0 + 26.0;
    (width, height)
}

fn menu_remaining_label(window: Option<&UsageWindow>) -> String {
    window
        .map(|window| format!("{}%", window.remaining_percent.round().clamp(0.0, 100.0)))
        .unwrap_or_else(|| "--".to_string())
}

fn truncate_menu_email(text: &str) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(MENU_EMAIL_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

#[tauri::command]
pub(crate) fn show_dashboard_from_bubble<R: Runtime>(app: AppHandle<R>) {
    crate::system_tray::show_dashboard(&app);
}

pub(crate) fn remember_position<R: Runtime>(window: &Window<R>) {
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    let position = position.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    let Ok(mut settings) = read_app_settings(window.app_handle()) else {
        return;
    };
    settings.bubble_x = Some(position.x + size.width - COLLAPSED_WIDTH);
    settings.bubble_y = Some(position.y + size.height - COLLAPSED_HEIGHT);
    let _ = write_app_settings(window.app_handle(), &settings);
}
