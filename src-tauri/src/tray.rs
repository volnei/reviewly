use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const TRAY_ID: &str = "main";
pub const TRAY_WINDOW: &str = "tray";
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");
const PANEL_WIDTH: f64 = 300.0;
const PANEL_HEIGHT: f64 = 354.0;
static INBOX_COUNT: AtomicU64 = AtomicU64::new(0);

/// Linux does not emit tray click events, so it keeps this compact native menu.
const NAV: &[(&str, &str, &str)] = &[
    ("go:/", "Home", "/"),
    ("go:/inbox", "Inbox", "/inbox"),
    ("go:/prs", "Pull requests", "/prs"),
    ("go:/mentions", "Mentions", "/mentions"),
    ("go:/health", "Health", "/health"),
    ("go:/settings", "Settings", "/settings"),
];

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let menu = fallback_menu(app)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "open" => open(app, None),
                "quit" => app.exit(0),
                _ => {
                    if let Some(route) = NAV
                        .iter()
                        .find(|(mid, _, _)| *mid == id)
                        .map(|(_, _, route)| *route)
                    {
                        open(app, Some(route));
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            #[cfg(target_os = "macos")]
            if let tauri::tray::TrayIconEvent::Click {
                position,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                toggle_panel(tray.app_handle(), position);
            }
            #[cfg(not(target_os = "macos"))]
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                bring_to_front(tray.app_handle());
            }
        });

    // macOS gets the branded Reviewly popover. Other platforms keep their
    // native menu because tray placement and click support differ by shell.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.menu(&menu);
    }
    #[cfg(target_os = "macos")]
    let _ = menu;

    if let Ok(icon) = tauri::image::Image::from_bytes(TRAY_ICON) {
        builder = builder.icon(icon).icon_as_template(true);
    }
    builder.build(app)?;
    Ok(())
}

fn build_panel(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, TRAY_WINDOW, WebviewUrl::App("tray.html".into()))
        .title("Reviewly")
        .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    Ok(())
}

fn fallback_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", "Open Reviewly", true, None::<&str>)?;
    let home = MenuItem::with_id(app, NAV[0].0, NAV[0].1, true, None::<&str>)?;
    let inbox = MenuItem::with_id(app, NAV[1].0, NAV[1].1, true, None::<&str>)?;
    let prs = MenuItem::with_id(app, NAV[2].0, NAV[2].1, true, None::<&str>)?;
    let mentions = MenuItem::with_id(app, NAV[3].0, NAV[3].1, true, None::<&str>)?;
    let health = MenuItem::with_id(app, NAV[4].0, NAV[4].1, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, NAV[5].0, NAV[5].1, true, None::<&str>)?;
    let first_separator = PredefinedMenuItem::separator(app)?;
    let second_separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Reviewly", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &open,
            &first_separator,
            &home,
            &inbox,
            &prs,
            &mentions,
            &health,
            &settings,
            &second_separator,
            &quit,
        ],
    )
}

fn toggle_panel(app: &AppHandle, position: PhysicalPosition<f64>) {
    // Building this transparent secondary WebView alongside the main window
    // during startup terminates their shared WebContent process on macOS 26.
    // Create it on the first tray click, after the main WebView is established.
    let panel = match app.get_webview_window(TRAY_WINDOW) {
        Some(panel) => panel,
        None => {
            if let Err(error) = build_panel(app) {
                tracing::warn!("tray panel build failed: {error}");
                return;
            }
            let Some(panel) = app.get_webview_window(TRAY_WINDOW) else {
                return;
            };
            panel
        }
    };
    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();
        return;
    }
    let scale = panel.scale_factor().unwrap_or(1.0);
    let size = panel.outer_size().unwrap_or_default();
    let x = (position.x - f64::from(size.width) / 2.0).round() as i32;
    let y = (position.y + 14.0 * scale).round() as i32;
    let _ = panel.set_position(PhysicalPosition::new(x, y));
    let _ = panel.show();
    let _ = panel.set_focus();
}

fn bring_to_front(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn open(app: &AppHandle, route: Option<&str>) {
    if let Some(panel) = app.get_webview_window(TRAY_WINDOW) {
        let _ = panel.hide();
    }
    bring_to_front(app);
    if let Some(route) = route {
        let _ = app.emit("tray:navigate", route);
    }
}

#[derive(Serialize)]
pub struct TrayStatus {
    inbox: u64,
}

#[tauri::command]
pub fn tray_open(app: AppHandle, route: Option<String>) {
    open(&app, route.as_deref());
}

#[tauri::command]
pub fn tray_quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn tray_status() -> TrayStatus {
    TrayStatus {
        inbox: INBOX_COUNT.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub fn tray_set_inbox_count(app: AppHandle, count: u64) {
    INBOX_COUNT.store(count, Ordering::Relaxed);
    let _ = app.emit("tray:status", count);
}

#[tauri::command]
pub fn tray_set_title(app: AppHandle, title: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let title = if title.is_empty() {
            None
        } else {
            Some(title.as_str())
        };
        tray.set_title(title).map_err(|error| error.to_string())?;
    }
    Ok(())
}
