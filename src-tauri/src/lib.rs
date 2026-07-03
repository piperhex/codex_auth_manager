mod auth;
mod codex_api;
mod commands;
mod floating_bubble;
mod models;
mod oauth;
mod storage;
mod system_tray;
mod update;

use oauth::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
            commands::list_accounts,
            commands::import_auth_file,
            commands::switch_account,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Switch");
}
