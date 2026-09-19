//! Windows/macOS/Linux: tray icon + window, local stack (HyperHDR, tasks, scripts).

use crate::stack;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::MacosLauncher;

const TRAY_OK: &[u8] = include_bytes!("../icons/tray-ok-32.png");
const TRAY_WARN: &[u8] = include_bytes!("../icons/tray-warn-32.png");
const TRAY_DOWN: &[u8] = include_bytes!("../icons/tray-down-32.png");

struct TrayItems {
    status: MenuItem<Wry>,
    movie: CheckMenuItem<Wry>,
    music: CheckMenuItem<Wry>,
    off: CheckMenuItem<Wry>,
    capture: CheckMenuItem<Wry>,
}

#[derive(Default)]
pub(crate) struct State {
    pub(crate) mode: Mutex<String>,
    pub(crate) last: Mutex<Option<stack::Health>>,
}

fn icon_for(state: &str) -> Image<'static> {
    let bytes = match state {
        "ok" => TRAY_OK,
        "down" => TRAY_DOWN,
        _ => TRAY_WARN,
    };
    Image::from_bytes(bytes).expect("tray png")
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

use crate::err;

// ---------------------------------------------------------------- commands (window -> rust)

#[tauri::command]
async fn health() -> stack::Health {
    stack::health()
}

#[tauri::command]
async fn tasks() -> Vec<stack::TaskState> {
    stack::task_states()
}

#[tauri::command]
async fn task_action(name: String, action: String) -> Result<(), String> {
    err(match action.as_str() {
        "start" => stack::task_start(&name),
        "stop" => stack::task_stop(&name),
        _ => stack::task_restart(&name),
    })
}

#[tauri::command]
async fn tail_log(name: String, lines: Option<usize>) -> Result<String, String> {
    err(stack::tail_log(&name, lines.unwrap_or(200)))
}

#[tauri::command]
async fn open_path(what: String) -> Result<(), String> {
    err(stack::open_path(&what))
}

#[tauri::command]
async fn settings_get() -> Result<Value, String> {
    err(stack::read_settings())
}

#[tauri::command]
async fn settings_set(patch: Value) -> Result<Value, String> {
    err(stack::write_settings(patch))
}

#[tauri::command]
async fn ambilight_configure() -> Result<String, String> {
    err(stack::ambilight_configure())
}

#[tauri::command]
async fn hyper_instances() -> Result<Vec<stack::HyperInstance>, String> {
    err(stack::hyper_instances())
}

/// Raw JSON-API to one or all instances; the UI builds the command objects
/// (effect, color, clear, componentstate, adjustment) from a small vocabulary.
#[tauri::command]
async fn hyper_send(commands: Vec<Value>, instances: Option<Vec<u32>>) -> Result<Vec<String>, String> {
    let inst = instances.unwrap_or_else(|| stack::HYPER_INSTANCES.to_vec());
    Ok(stack::hyper_all(&commands, &inst))
}

#[tauri::command]
async fn ambilight_mode(app: AppHandle, mode: String) -> Result<(), String> {
    set_mode(&app, &mode)
}

#[tauri::command]
async fn pc_action(action: String, value: Option<i64>) -> Result<String, String> {
    err(stack::pc_action(&action, value))
}

#[tauri::command]
async fn ha_call(domain: String, service: String, data: Value) -> Result<Value, String> {
    err(stack::ha_post(&format!("services/{domain}/{service}"), data))
}

#[tauri::command]
async fn vmui_get(path: String) -> Result<Value, String> {
    err(stack::vmui_get(&path))
}

#[tauri::command]
async fn vmui_send(method: String, path: String, body: Value) -> Result<Value, String> {
    err(stack::vmui_send(&method, &path, body))
}

#[tauri::command]
async fn devices_list() -> Result<Value, String> {
    err(stack::pi_get("/api/devices", 8))
}

#[tauri::command]
async fn devices_op(op: String, id: String, code: Option<String>, name: Option<String>) -> Result<(), String> {
    let mut body = json!({"op": op, "id": id});
    if let Some(c) = code { body["code"] = json!(c); }
    if let Some(n) = name { body["name"] = json!(n); }
    let v = err(stack::pi_post("/api/devices", body))?;
    if v["ok"].as_bool() == Some(true) { Ok(()) } else { Err(v["error"].as_str().unwrap_or("eroare").to_string()) }
}

#[tauri::command]
async fn app_info() -> Value {
    json!({
        "root": stack::root().to_string_lossy(),
        "vmui": stack::VMUI,
        "haUrl": stack::creds().get("HA_URL").cloned().unwrap_or_default(),
        "displayUrl": format!("{}/display?k={}", stack::VMUI, stack::vmui_token()),
        "version": env!("CARGO_PKG_VERSION"),
    })
}

// ---------------------------------------------------------------- shared actions (tray + window)

pub(crate) fn set_mode(app: &AppHandle, mode: &str) -> Result<(), String> {
    let script = match mode {
        "movie" => "movie_mode_on",
        "music" => "music_mode",
        "off" => "movie_mode_off",
        _ => return Err("unknown mode".into()),
    };
    err(stack::ha_post(&format!("services/script/{script}"), json!({})).inspect_err(|e| stack::log(&format!("mode {mode}: {e}"))))?;
    *app.state::<State>().mode.lock().unwrap() = mode.to_string();
    let _ = app.emit("mode", mode);
    Ok(())
}

fn toggle_capture(app: &AppHandle) {
    let cur = app.state::<State>().last.lock().unwrap().as_ref().and_then(|h| h.grabber).unwrap_or(false);
    // Instance 0 (strip behind the Odyssey) always follows the screen; this is the case (1) and the room bulbs (2, 3).
    let errs = stack::hyper_all(&[json!({"command":"componentstate","componentstate":{"component":"SYSTEMGRABBER","state":!cur}})], &[1, 2, 3]);
    if !errs.is_empty() {
        let _ = app.emit("toast", json!({"kind":"error","text":errs.join("; ")}));
    }
    refresh(app);
}

fn refresh(app: &AppHandle) {
    let h = stack::health();
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.status.set_text(format!("vmui · {}", h.detail));
        let _ = items.capture.set_checked(h.grabber == Some(true));
        let mode = app.state::<State>().mode.lock().unwrap().clone();
        let _ = items.movie.set_checked(mode == "movie");
        let _ = items.music.set_checked(mode == "music");
        let _ = items.off.set_checked(mode == "off");
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(icon_for(&h.state)));
        let _ = tray.set_tooltip(Some(format!("vmui — {}", h.detail)));
    }
    let _ = app.emit("health", &h);
    *app.state::<State>().last.lock().unwrap() = Some(h);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "vmui · pornire…", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Deschide vmui", true, Some("Ctrl+Shift+V"))?;
    let movie = CheckMenuItem::with_id(app, "mode:movie", "Mod film", true, false, None::<&str>)?;
    let music = CheckMenuItem::with_id(app, "mode:music", "Mod muzică", true, false, None::<&str>)?;
    let off = CheckMenuItem::with_id(app, "mode:off", "Lumini stinse", true, false, None::<&str>)?;
    let capture = CheckMenuItem::with_id(app, "capture", "Captură ecran (carcasă + cameră)", true, false, None::<&str>)?;
    let clear = MenuItem::with_id(app, "clear", "Șterge efectele", true, None::<&str>)?;
    let scenes = Submenu::with_id_and_items(
        app,
        "scenes",
        "Scene",
        true,
        &[
            &MenuItem::with_id(app, "scene:ambilight_all", "Ambilight peste tot", true, None::<&str>)?,
            &MenuItem::with_id(app, "scene:pc_wake", "Trezește PC-ul", true, None::<&str>)?,
            &MenuItem::with_id(app, "scene:notify_flash", "Flash de test", true, None::<&str>)?,
        ],
    )?;
    let pc = Submenu::with_id_and_items(
        app,
        "pc",
        "PC",
        true,
        &[
            &MenuItem::with_id(app, "pc:lock", "Blochează", true, None::<&str>)?,
            &MenuItem::with_id(app, "pc:display_off", "Stinge monitoarele", true, None::<&str>)?,
            &MenuItem::with_id(app, "pc:sleep", "Sleep", true, None::<&str>)?,
        ],
    )?;
    let devices = Submenu::with_id_and_items(app, "devices", "Dispozitive noi", true, &[&MenuItem::with_id(app, "devices:none", "Nicio cerere", false, None::<&str>)?])?;
    app.manage(crate::devices::DevicesMenu { sub: devices.clone(), items: Mutex::new(Vec::new()) });
    let restart = MenuItem::with_id(app, "restart", "Repornește stack-ul ambilight", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Ieșire", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &PredefinedMenuItem::separator(app)?,
            &movie,
            &music,
            &off,
            &PredefinedMenuItem::separator(app)?,
            &capture,
            &clear,
            &scenes,
            &pc,
            &devices,
            &PredefinedMenuItem::separator(app)?,
            &restart,
            &quit,
        ],
    )?;
    app.manage(TrayItems { status, movie, music, off, capture });

    TrayIconBuilder::with_id("main")
        .icon(icon_for("warn"))
        .tooltip("vmui — pornire…")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| {
            let id = ev.id().as_ref().to_string();
            let app = app.clone();
            std::thread::spawn(move || {
                match id.as_str() {
                    "open" => show_main(&app),
                    "capture" => toggle_capture(&app),
                    "clear" => {
                        stack::hyper_all(&[json!({"command":"clear","priority":40})], &stack::HYPER_INSTANCES);
                    }
                    "restart" => {
                        for t in stack::AMBILIGHT_TASKS {
                            let _ = stack::task_restart(t);
                        }
                        refresh(&app);
                    }
                    "quit" => app.exit(0),
                    m if m.starts_with("mode:") => {
                        if let Err(e) = set_mode(&app, &m[5..]) {
                            let _ = app.emit("toast", json!({"kind":"error","text":e}));
                        }
                        refresh(&app);
                    }
                    s if s.starts_with("scene:") => {
                        if let Err(e) = stack::ha_post(&format!("services/script/{}", &s[6..]), json!({})) {
                            stack::log(&format!("scene {}: {e}", &s[6..]));
                        }
                    }
                    p if p.starts_with("pc:") => {
                        if let Err(e) = stack::pc_action(&p[3..], None) {
                            stack::log(&format!("pc {}: {e}", &p[3..]));
                        }
                    }
                    d if crate::devices::handle_menu(&app, d) => {}
                    _ => {}
                }
            });
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE).build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_notification::init())
        .manage(State::default())
        .setup(|app| {
            build_tray(app.handle())?;
            // closing the window hides it; the tray owns the process
            if let Some(w) = app.get_webview_window("main") {
                let wh = w.clone();
                w.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        let _ = wh.hide();
                    }
                });
                // window-state restores visibility on its own; `--hidden`
                // (the logon task) must win, so hide explicitly after it ran.
                if std::env::args().any(|a| a == "--hidden") {
                    let _ = w.hide();
                } else {
                    let _ = w.show();
                }
            }
            let h = app.handle().clone();
            std::thread::spawn(move || loop {
                refresh(&h);
                std::thread::sleep(Duration::from_secs(15));
            });
            // phone -> Pi (MQTT) -> this PC
            let a = app.handle().clone();
            std::thread::spawn(move || crate::agent::run(a));
            // pairing requests on the Pi -> toast + tray entry here
            let d = app.handle().clone();
            std::thread::spawn(move || crate::devices::run(d));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health,
            tasks,
            devices_list,
            devices_op,
            task_action,
            tail_log,
            open_path,
            settings_get,
            settings_set,
            ambilight_configure,
            hyper_instances,
            hyper_send,
            ambilight_mode,
            pc_action,
            ha_call,
            vmui_get,
            vmui_send,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("vmui desktop");
}
