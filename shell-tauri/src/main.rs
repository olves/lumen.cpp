// lumen.exe: the Tauri shell. Starts the core (node.exe app/core-host.cjs) in a Job Object, serves the unchanged UI over the
// `lumen` protocol and bridges window.lumen (app/bridge-tauri.js) to the core. Spec: docs/superpowers/specs/2026-11-06-tauri-shell-bridge-design.md
//   lumen.exe [--ui-check] [--test-data=<dir>] [--remote-debugging-port=<n> (ui-check builds with --ui-check only)]
#![cfg_attr(not(test), windows_subsystem = "windows")]
mod core;
mod platform;
mod protocol;
mod window;

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

const BROWSER_ARGS_ENV: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

#[derive(Debug, PartialEq)]
struct Args {
    data: PathBuf,
    ui_check: bool,
    debug_port: Option<u16>,
}

#[cfg(feature = "ui-check")]
fn port_in(text: &str) -> Option<u16> {
    text.split_whitespace().find_map(|a| a.strip_prefix("--remote-debugging-port=")).and_then(|p| p.parse().ok()).filter(|p| *p != 0)
}

/// `test_dir`: LUMEN_TEST_DIR, `browser_args`: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, `local`: %LOCALAPPDATA%.
fn parse_args(argv: &[String], test_dir: Option<String>, browser_args: Option<String>, local: &Path) -> Args {
    let ui_check = argv.iter().any(|a| a == "--ui-check");
    let data = argv.iter().find_map(|a| a.strip_prefix("--test-data=")).map(PathBuf::from).or(test_dir.map(PathBuf::from)).unwrap_or_else(|| local.join("lumen.cpp"));
    // The debugging port exists only in builds made with the `ui-check` feature, and only with --ui-check.
    #[cfg(feature = "ui-check")]
    let debug_port = if ui_check { argv.iter().find_map(|a| port_in(a)).or_else(|| browser_args.as_deref().and_then(port_in)) } else { None };
    #[cfg(not(feature = "ui-check"))]
    let debug_port = {
        let _ = browser_args;
        None
    };
    Args { data, ui_check, debug_port }
}

pub struct Shell {
    pub core: Arc<core::Core>,
    pub app_dir: PathBuf,
    pub data: PathBuf,
    exiting: AtomicBool,
}

fn language_is_tr(data: &Path) -> bool {
    std::fs::read_to_string(data.join("desktop-preferences.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
        .map(|p| p["language"] == "tr")
        .unwrap_or(false)
}

fn fatal_message(tr: bool, timed_out: bool, restarting: bool) -> String {
    let (what, next) = if tr {
        (if timed_out { "Lumen'in çekirdeği zamanında başlamadı." } else { "Lumen'in çekirdeği beklenmedik şekilde durdu." }, if restarting { " Yeniden başlatılıyor…" } else { " Lumen'i yeniden başlatın." })
    } else {
        (if timed_out { "Lumen's core did not start in time." } else { "Lumen's core stopped unexpectedly." }, if restarting { " Restarting it…" } else { " Restart Lumen." })
    };
    format!("{what}{next}")
}

fn emit(app: &AppHandle, channel: &str, payload: Value) {
    let _ = app.emit_to(window::MAIN, "lumen-event", json!({"channel": channel, "payload": payload}));
}

/// Exit: hide the window, `shutdown` to the core, end it after 5 s (Job Object), then exit.
fn begin_exit(app: &AppHandle) {
    let shell = app.state::<Shell>();
    if shell.exiting.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(w) = app.get_webview_window(window::MAIN) {
        let _ = w.hide();
    }
    let core = shell.core.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        core.shutdown().await;
        app.exit(0);
    });
}

fn startup_failed(app: &AppHandle, data: &Path, message: &str) {
    window::append(&data.join("desktop-startup-error.log"), message);
    app.state::<Shell>().core.kill();
    app.exit(1);
}

async fn startup(app: AppHandle, args: Args) {
    let core = app.state::<Shell>().core.clone();
    if core.wait_ready(Duration::from_secs(45)).await.is_err() {
        return startup_failed(&app, &args.data, "Lumen's core did not start (see desktop-core.log).");
    }
    // The window background follows the saved design, as in Electron.
    let p = core.call("preferences".into(), vec![]).await.ok().flatten().unwrap_or(Value::Null);
    let background = match (p["colorMode"] == "light", p["layout"] == "studio") {
        (true, true) => tauri::window::Color(0xee, 0xf1, 0xf1, 0xff),
        (true, false) => tauri::window::Color(0xfa, 0xf8, 0xf4, 0xff),
        _ => tauri::window::Color(0x1c, 0x1c, 0x1b, 0xff),
    };
    let options = window::Options { data: args.data.clone(), ui_check: args.ui_check, background, debug_port: args.debug_port };
    if let Err(e) = window::create_main(&app, &options) {
        startup_failed(&app, &args.data, &format!("The window could not be created: {e}"));
    }
}

#[tauri::command]
async fn lumen_call(webview: tauri::Webview, shell: tauri::State<'_, Shell>, channel: String, args: Vec<Value>) -> Result<Value, String> {
    if webview.label() != window::MAIN {
        return Err("Invalid IPC sender".into());
    }
    let core = shell.core.clone();
    // {value} keeps the core's `undefined` (no key) apart from `null`.
    match core.call(channel, args).await? {
        Some(value) => Ok(json!({ "value": value })),
        None => Ok(json!({})),
    }
}

#[tauri::command]
fn window_action(webview: tauri::Webview, action: String) -> Result<(), String> {
    if webview.label() != window::MAIN {
        return Err("Invalid IPC sender".into());
    }
    window::action(webview.app_handle(), &action)
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let local = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default());
    let args = parse_args(&argv, std::env::var("LUMEN_TEST_DIR").ok(), std::env::var(BROWSER_ARGS_ENV).ok(), &local);
    // WebView2 would honour this variable on its own (a debugging port among others): it never reaches the webview.
    std::env::remove_var(BROWSER_ARGS_ENV);

    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_default();
    let mut builder = tauri::Builder::default();
    if !args.ui_check {
        // Test runs use separate data folders and may run side by side (as in Electron); core.lock still guards each folder.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| window::focus_main(app)));
    }
    let app = builder
        .register_asynchronous_uri_scheme_protocol("lumen", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let allowed = ctx.webview_label() == window::MAIN && request.method() == tauri::http::Method::GET;
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn(async move {
                let shell = app.state::<Shell>();
                responder.respond(protocol::serve(&shell.core, &shell.app_dir, &shell.data, allowed, &path).await);
            });
        })
        .invoke_handler(tauri::generate_handler![lumen_call, window_action])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == window::MAIN {
                    api.prevent_close();
                    begin_exit(window.app_handle());
                }
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let data = args.data.clone();
            let notify_app = handle.clone();
            let notify_data = data.clone();
            let notify = Box::new(move |notice: core::Notice| match notice {
                core::Notice::Event { channel, payload } => emit(&notify_app, &channel, payload),
                core::Notice::Platform { id, method, args } => {
                    let app = notify_app.clone();
                    tauri::async_runtime::spawn(async move {
                        let (answer, quit) = platform::handle(&app, &method, &args);
                        app.state::<Shell>().core.answer(id, answer);
                        if quit {
                            begin_exit(&app);
                        }
                    });
                }
                core::Notice::Fatal { timed_out, restarting } => {
                    let message = fatal_message(language_is_tr(&notify_data), timed_out, restarting);
                    emit(&notify_app, "engine-event", json!({"type": "fatal", "data": {"message": message}}));
                }
            });
            let core = core::Core::new(
                core::Config {
                    node: exe_dir.join("node.exe"),
                    script: exe_dir.join("app").join("core-host.cjs"),
                    data: data.clone(),
                    app_root: exe_dir.clone(),
                    ui_check: args.ui_check,
                    log: data.join("desktop-core.log"),
                },
                notify,
            );
            app.manage(Shell { core: core.clone(), app_dir: exe_dir.join("app"), data: data.clone(), exiting: AtomicBool::new(false) });
            if let Err(e) = core.spawn() {
                startup_failed(&handle, &data, &format!("Lumen's core could not be started: {e}"));
                return Ok(());
            }
            tauri::async_runtime::spawn(startup(handle, Args { data, ui_check: args.ui_check, debug_port: args.debug_port }));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Lumen");
    app.run(|app, event| match event {
        RunEvent::ExitRequested { code: None, api, .. } => {
            api.prevent_exit();
            begin_exit(app);
        }
        RunEvent::Exit => {
            if let Some(shell) = app.try_state::<Shell>() {
                shell.core.kill();
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn data_folder() {
        let local = Path::new("L");
        assert_eq!(parse_args(&argv(&[]), None, None, local).data, PathBuf::from("L").join("lumen.cpp"));
        assert_eq!(parse_args(&argv(&["--test-data=C:\\t\\d"]), None, None, local).data, PathBuf::from("C:\\t\\d"));
        assert_eq!(parse_args(&argv(&[]), Some("E".into()), None, local).data, PathBuf::from("E"));
    }

    #[test]
    fn debugging_port_needs_the_feature_and_ui_check() {
        let local = Path::new("L");
        let with = parse_args(&argv(&["--ui-check", "--remote-debugging-port=9333"]), None, None, local);
        let from_env = parse_args(&argv(&["--ui-check"]), None, Some("--foo --remote-debugging-port=9444".into()), local);
        let without = parse_args(&argv(&["--remote-debugging-port=9333"]), None, Some("--remote-debugging-port=9444".into()), local);
        assert_eq!(without.debug_port, None);
        if cfg!(feature = "ui-check") {
            assert_eq!(with.debug_port, Some(9333));
            assert_eq!(from_env.debug_port, Some(9444));
        } else {
            assert_eq!(with.debug_port, None);
            assert_eq!(from_env.debug_port, None);
        }
    }

    #[test]
    fn fatal_texts_in_both_languages() {
        assert_eq!(fatal_message(false, false, true), "Lumen's core stopped unexpectedly. Restarting it…");
        assert_eq!(fatal_message(true, true, false), "Lumen'in çekirdeği zamanında başlamadı. Lumen'i yeniden başlatın.");
    }
}
