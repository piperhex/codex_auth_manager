mod account_archive;
mod auth;
mod cloud;
mod codex_api;
mod commands;
mod floating_bubble;
mod models;
mod oauth;
mod storage;
mod system_tray;
mod update;

use oauth::AppState;
use tauri::{LogicalSize, Manager, Runtime};

const MAIN_WINDOW_HEIGHT: f64 = 760.0;
const MAIN_WINDOW_WIDTH_RATIO: f64 = 0.8;

fn size_main_window_to_screen<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let Some(monitor) = window.current_monitor()?.or(app.primary_monitor()?) else {
        return Ok(());
    };
    let work_area = monitor.work_area();
    let screen_size = work_area.size.to_logical::<f64>(monitor.scale_factor());
    let width = (screen_size.width * MAIN_WINDOW_WIDTH_RATIO).max(960.0);

    window.set_size(LogicalSize::new(width, MAIN_WINDOW_HEIGHT))?;
    window.center()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            size_main_window_to_screen(app)?;
            system_tray::setup(app)?;
            floating_bubble::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            if window.label() == floating_bubble::BUBBLE_LABEL
                && matches!(event, tauri::WindowEvent::Moved(_))
            {
                floating_bubble::remember_position(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::open_managed_folder,
            commands::list_accounts,
            commands::import_auth_file,
            account_archive::export_accounts_archive,
            account_archive::import_accounts_archive,
            commands::switch_account,
            commands::update_account_note,
            commands::delete_account,
            commands::refresh_usage,
            commands::fetch_reset_credits,
            commands::restart_codex,
            update::check_for_update,
            floating_bubble::get_app_settings,
            floating_bubble::set_floating_bubble,
            floating_bubble::set_theme_color,
            floating_bubble::resize_floating_bubble,
            floating_bubble::drag_floating_bubble,
            floating_bubble::show_floating_bubble_menu,
            floating_bubble::show_dashboard_from_bubble,
            oauth::start_login,
            cloud::get_cloud_auth_state,
            cloud::set_cloud_base_url,
            cloud::cloud_login,
            cloud::cloud_logout,
            cloud::cloud_push_accounts,
            cloud::cloud_push_account,
            cloud::cloud_delete_account,
            cloud::cloud_sync_accounts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Switch");
}
