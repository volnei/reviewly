use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray.png");

pub const TRAY_ID: &str = "main";

/// Quick-nav entries: (menu id `go:<route>`, label, route). Clicking one brings
/// the window forward and tells the frontend to navigate there.
const NAV: &[(&str, &str, &str)] = &[
    ("go:/", "Dashboard", "/"),
    ("go:/prs", "Pull requests", "/prs"),
    ("go:/notifications", "Notifications", "/notifications"),
    ("go:/dependabot", "Dependabot", "/dependabot"),
    ("go:/settings", "Settings", "/settings"),
];

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Reviewly", true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, NAV[0].0, NAV[0].1, true, None::<&str>)?;
    let prs = MenuItem::with_id(app, NAV[1].0, NAV[1].1, true, None::<&str>)?;
    let notifs = MenuItem::with_id(app, NAV[2].0, NAV[2].1, true, None::<&str>)?;
    let deps = MenuItem::with_id(app, NAV[3].0, NAV[3].1, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, NAV[4].0, NAV[4].1, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Reviewly", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open, &sep1, &dashboard, &prs, &notifs, &deps, &settings, &sep2, &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "open" => bring_to_front(app),
                "quit" => app.exit(0),
                _ => {
                    if let Some(route) = NAV.iter().find(|(mid, _, _)| *mid == id).map(|(_, _, r)| *r)
                    {
                        bring_to_front(app);
                        let _ = app.emit("tray:navigate", route);
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                bring_to_front(tray.app_handle());
            }
        });

    if let Ok(img) = Image::from_bytes(TRAY_ICON_BYTES) {
        builder = builder.icon(img);
        builder = builder.icon_as_template(true);
    } else if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn bring_to_front(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn tray_set_title(app: AppHandle, title: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let t = if title.is_empty() { None } else { Some(title.as_str()) };
        tray.set_title(t).map_err(|e| e.to_string())?;
    }
    Ok(())
}
