// The main window: frameless, the UI from http://lumen.localhost/, no outside navigation, no new windows, permissions denied,
// renderer crashes logged (the Electron window's rules, shell-electron.cjs).
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const MAIN: &str = "main";
/// The window is shown when the first page load finishes, or after this long at the latest.
const SHOW_FALLBACK: Duration = Duration::from_secs(10);
const BRIDGE: &str = include_str!("../../app/bridge-tauri.js");
// wry's defaults, which additional_browser_args replaces.
const DEFAULT_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

pub struct Options {
    pub data: PathBuf,
    pub ui_check: bool,
    pub background: tauri::window::Color,
    /// WebView2 remote debugging port (test builds with --ui-check only; always None in production builds).
    pub debug_port: Option<u16>,
}

/// Only the app's own origin may load in the main window.
pub fn is_app_url(url: &tauri::Url) -> bool {
    (url.scheme() == "http" && url.host_str() == Some("lumen.localhost") && url.port().is_none())
        || (url.scheme() == "lumen" && url.host_str() == Some("localhost"))
}

fn browser_args(_debug_port: Option<u16>) -> String {
    #[allow(unused_mut)]
    let mut args = DEFAULT_BROWSER_ARGS.to_string();
    #[cfg(feature = "ui-check")]
    if let Some(port) = _debug_port {
        args.push_str(&format!(" --remote-debugging-port={port}"));
    }
    args
}

pub fn create_main(app: &AppHandle, o: &Options) -> tauri::Result<WebviewWindow> {
    let url = WebviewUrl::CustomProtocol("lumen://localhost/".parse().expect("valid url"));
    let mut builder = WebviewWindowBuilder::new(app, MAIN, url)
        .title("lumen.cpp")
        .inner_size(1240.0, 860.0)
        .min_inner_size(780.0, 580.0)
        .decorations(false)
        .background_color(o.background)
        .data_directory(o.data.join("webview").join("main"))
        .additional_browser_args(&browser_args(o.debug_port))
        .initialization_script(BRIDGE)
        .on_navigation(is_app_url)
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny);
    if o.ui_check {
        // Tests must not take the user's focus: off screen, shown without activation.
        builder = builder.position(-4000.0, 0.0).focused(false).visible(true);
    }
    let shown = Arc::new(AtomicBool::new(false));
    if !o.ui_check {
        let on_load = shown.clone();
        builder = builder.visible(false).on_page_load(move |window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished && !on_load.swap(true, Ordering::SeqCst) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        });
    }
    let window = builder.build()?;
    let log = o.data.join("renderer.log");
    harden(&window, log.clone());
    if !o.ui_check {
        // If the page never reports Finished (a stuck load), the window still appears.
        let late = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(SHOW_FALLBACK).await;
            if !shown.swap(true, Ordering::SeqCst) {
                append(&log, &format!("{{\"type\":\"show-fallback\",\"after_ms\":{},\"at\":{}}}", SHOW_FALLBACK.as_millis(), now_ms()));
                let _ = late.show();
                let _ = late.set_focus();
            }
        });
    }
    Ok(window)
}

/// WebView2 events Tauri does not cover: permission requests are denied, new windows are refused (Tauri's on_new_window
/// already does it; this is the same rule at the WebView2 level), renderer process failures go to <data>/renderer.log.
fn harden(window: &WebviewWindow, log: PathBuf) {
    let result = window.with_webview(move |webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use webview2_com::{NewWindowRequestedEventHandler, PermissionRequestedEventHandler, ProcessFailedEventHandler};
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let mut token = 0i64;
        let denied = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
            }
            Ok(())
        }));
        let _ = core.add_PermissionRequested(&denied, &mut token);
        let refused = NewWindowRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                args.SetHandled(true)?;
            }
            Ok(())
        }));
        let _ = core.add_NewWindowRequested(&refused, &mut token);
        let failed = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND(-1);
            if let Some(args) = args {
                let _ = args.ProcessFailedKind(&mut kind);
            }
            append(&log, &format!("{{\"type\":\"process-failed\",\"kind\":{},\"at\":{}}}", kind.0, now_ms()));
            Ok(())
        }));
        let _ = core.add_ProcessFailed(&failed, &mut token);
    });
    if let Err(e) = result {
        eprintln!("[window] webview hardening failed: {e}");
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

pub fn append(file: &Path, line: &str) {
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
        let _ = writeln!(f, "{line}");
    }
}

/// minimize | maximize (toggles) | close (the exit sequence runs from CloseRequested).
pub fn action(app: &AppHandle, action: &str) -> Result<(), String> {
    let window = app.get_webview_window(MAIN).ok_or("The window is gone.")?;
    let r = match action {
        "minimize" => window.minimize(),
        "maximize" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        _ => return Err("Invalid window action.".into()),
    };
    r.map_err(|e| e.to_string())
}

/// Second instance: bring the existing window forward.
pub fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_app_origin_may_load() {
        for ok in ["http://lumen.localhost/", "http://lumen.localhost/index.html"] {
            assert!(is_app_url(&ok.parse().unwrap()), "{ok}");
        }
        for bad in ["https://example.com/", "http://lumen.localhost.evil.com/", "http://lumen.localhost:8080/", "file:///C:/x", "http://127.0.0.1/", "about:blank"] {
            assert!(!is_app_url(&bad.parse().unwrap()), "{bad}");
        }
    }

    #[test]
    fn production_builds_add_no_debugging_port() {
        let args = browser_args(Some(9222));
        assert!(args.starts_with(DEFAULT_BROWSER_ARGS));
        assert_eq!(args.contains("--remote-debugging-port"), cfg!(feature = "ui-check"));
    }
}
