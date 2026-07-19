mod account_archive;
mod auth;
mod cloud;
mod codex_api;
mod commands;
mod floating_bubble;
mod local_proxy;
mod models;
mod oauth;
mod providers;
mod storage;
mod system_proxy;
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
            match local_proxy::restore_local_proxy_if_enabled(app.handle()) {
                Ok(true) => {}
                Ok(false) => providers::cleanup_stale_local_proxy_config(app.handle())?,
                Err(error) => {
                    eprintln!("failed to restore local proxy: {error}");
                    providers::cleanup_stale_local_proxy_config(app.handle())?;
                }
            }
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
            if window.label() == local_proxy::TOKEN_USAGE_WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.destroy();
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
            commands::import_compatible_json_file,
            account_archive::export_accounts_archive,
            account_archive::import_accounts_archive,
            commands::switch_account,
            commands::set_account_auto_switch_enabled,
            commands::update_account_note,
            commands::delete_account,
            commands::refresh_usage,
            commands::fetch_reset_credits,
            commands::consume_reset_credit,
            commands::restart_chatgpt,
            commands::sync_direct_conversations,
            providers::list_providers,
            providers::save_provider,
            providers::switch_provider,
            providers::switch_provider_model,
            providers::set_provider_model_control,
            providers::disable_provider,
            providers::delete_provider,
            local_proxy::get_local_proxy_status,
            local_proxy::export_diagnostic_logs,
            local_proxy::list_token_usage_entries,
            local_proxy::show_token_usage_window,
            local_proxy::start_local_proxy,
            local_proxy::stop_local_proxy,
            local_proxy::set_auto_switch_on_quota_exhaustion,
            local_proxy::set_auto_disable_unreachable_accounts,
            update::check_for_update,
            floating_bubble::get_app_settings,
            floating_bubble::set_floating_bubble,
            floating_bubble::set_privacy_mode,
            floating_bubble::set_bubble_reset_display,
            floating_bubble::set_theme_color,
            floating_bubble::set_app_language,
            floating_bubble::resize_floating_bubble,
            floating_bubble::drag_floating_bubble,
            floating_bubble::show_floating_bubble_menu,
            floating_bubble::show_dashboard_from_bubble,
            oauth::start_login,
            cloud::get_cloud_auth_state,
            cloud::fetch_cloud_announcement,
            cloud::report_announcement_click,
            cloud::submit_feedback,
            cloud::report_first_installation,
            cloud::report_base_url_change,
            cloud::set_cloud_base_url,
            cloud::cloud_login,
            cloud::cloud_request_registration_code,
            cloud::cloud_register,
            cloud::cloud_change_password,
            cloud::cloud_logout,
            cloud::cloud_push_accounts,
            cloud::cloud_push_account,
            cloud::cloud_push_providers,
            cloud::cloud_push_provider,
            cloud::cloud_delete_account,
            cloud::cloud_delete_provider,
            cloud::cloud_sync_accounts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Switch");
}
