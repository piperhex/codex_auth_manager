use tauri::{
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime,
};

use crate::{
    commands,
    models::{AccountSummary, UsageWindow},
};

const TRAY_ID: &str = "main-tray";
const DASHBOARD_ID: &str = "tray:dashboard";
const QUIT_ID: &str = "tray:quit";
const ACCOUNT_PREFIX: &str = "tray:account:";

pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_menu(app.handle())?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Codex Switch")
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                show_dashboard(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

pub(crate) fn refresh_menu<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match build_menu(app) {
        Ok(menu) => {
            if let Err(error) = tray.set_menu(Some(menu)) {
                eprintln!("failed to refresh tray menu: {error}");
            }
        }
        Err(error) => eprintln!("failed to build tray menu: {error}"),
    }
}

pub(crate) fn show_dashboard<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == DASHBOARD_ID {
        show_dashboard(app);
        return;
    }
    if id == QUIT_ID {
        app.exit(0);
        return;
    }
    if let Some(account_id) = id.strip_prefix(ACCOUNT_PREFIX) {
        if let Err(error) = commands::switch_account(app.clone(), account_id.to_string()) {
            eprintln!("failed to switch account from tray: {error}");
        }
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let menu = Menu::new(app)?;

    match commands::list_accounts(app.clone()) {
        Ok(accounts) if accounts.is_empty() => {
            let empty = MenuItem::with_id(app, "tray:empty", "暂无节点", false, None::<&str>)?;
            menu.append(&empty)?;
        }
        Ok(accounts) => {
            for account in accounts {
                let item = CheckMenuItem::with_id(
                    app,
                    format!("{ACCOUNT_PREFIX}{}", account.id),
                    account_label(&account),
                    true,
                    account.active,
                    None::<&str>,
                )?;
                menu.append(&item)?;
            }
        }
        Err(error) => {
            let item = MenuItem::with_id(
                app,
                "tray:accounts-error",
                format!("节点读取失败: {error}"),
                false,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        DASHBOARD_ID,
        "仪表板",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        QUIT_ID,
        "退出程序",
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

fn account_label(account: &AccountSummary) -> String {
    format!(
        "{} | 5h {} | 1week {}",
        escape_menu_text(&account.email),
        remaining_label(account.usage.primary.as_ref()),
        remaining_label(account.usage.secondary.as_ref()),
    )
}

fn remaining_label(window: Option<&UsageWindow>) -> String {
    window
        .map(|window| format!("{}%", window.remaining_percent.round().clamp(0.0, 100.0)))
        .unwrap_or_else(|| "--".to_string())
}

fn escape_menu_text(text: &str) -> String {
    text.replace('&', "&&")
}
