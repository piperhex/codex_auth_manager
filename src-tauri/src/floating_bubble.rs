use tauri::{
    webview::Color, AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl,
    WebviewWindowBuilder, Window,
};

use crate::{
    models::AppSettings,
    storage::{read_app_settings, write_app_settings},
};

pub(crate) const BUBBLE_LABEL: &str = "usage-bubble";
const COLLAPSED_WIDTH: f64 = 96.0;
const COLLAPSED_HEIGHT: f64 = 96.0;
const EXPANDED_WIDTH: f64 = 304.0;
const EXPANDED_HEIGHT: f64 = 224.0;
const SCREEN_MARGIN: f64 = 22.0;

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
    WebviewWindowBuilder::new(
        app,
        BUBBLE_LABEL,
        WebviewUrl::App("index.html?window=bubble".into()),
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
