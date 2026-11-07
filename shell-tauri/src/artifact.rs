// The artifact preview window (HTML/SVG code blocks of a reply), the Tauri side of app/artifacts.cjs. Same rules as Electron's
// electron/artifact-window.cjs: its own non-persistent WebView2 profile, no bridge script and no capability, a CSP header, no
// network at all (every request except the current document is answered 403), no permissions, downloads, new windows,
// dialogs or navigation. The document is served by the `lumen-artifact` protocol (http://lumen-artifact.localhost/ on Windows)
// under a random 32-hex path prefix per document: http://lumen-artifact.localhost/<token>/ (Electron uses the token as host).
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::http::Response;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "artifact";
/// Identical to `CSP` in app/artifacts.cjs (a test compares them).
pub const CSP: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
const HOST: &str = "lumen-artifact.localhost";

struct Page {
    token: String,
    html: Vec<u8>,
}
/// Only the latest document is kept (as in Electron).
static PAGE: Mutex<Option<Page>> = Mutex::new(None);
/// open() waits for the document to finish loading.
static LOAD: Mutex<Option<(String, std::sync::mpsc::Sender<Result<(), String>>)>> = Mutex::new(None);
/// Opens run one at a time.
static OPEN_TURN: Mutex<()> = Mutex::new(());
/// True only once every WebView2 handler and the request filter of the window are registered. An unguarded window is never reused.
static GUARDED: AtomicBool = AtomicBool::new(false);
const LOAD_LIMIT: std::time::Duration = std::time::Duration::from_secs(20);
/// Test builds only (--ui-check, LUMEN_ARTIFACT_NO_CSP=1): the document is served without its CSP header, so that a test can see
/// the request filter work on its own. Never set in a production build.
#[cfg(feature = "ui-check")]
static NO_CSP: AtomicBool = AtomicBool::new(false);
fn csp_header() -> Option<&'static str> {
    #[cfg(feature = "ui-check")]
    if NO_CSP.load(Ordering::SeqCst) {
        return None;
    }
    Some(CSP)
}

fn current_token() -> Option<String> {
    PAGE.lock().ok().and_then(|p| p.as_ref().map(|p| p.token.clone()))
}

fn is_token(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `http://lumen-artifact.localhost/<token>/` (or the `lumen-artifact://localhost/<token>/` form): the document itself.
fn is_document_url(url: &tauri::Url, token: &str) -> bool {
    let host_ok = (url.scheme() == "http" && url.host_str() == Some(HOST)) || (url.scheme() == "lumen-artifact" && url.host_str() == Some("localhost"));
    host_ok && url.port().is_none() && url.username().is_empty() && url.password().is_none() && url.path() == format!("/{token}/") && url.query().is_none()
}

/// Navigation inside the artifact window: only the current document.
pub fn allows_navigation(url: &tauri::Url) -> bool {
    current_token().map(|t| is_document_url(url, &t)).unwrap_or(false)
}

/// The WebResourceRequested filter: the current document's path prefix (the protocol handler answers only the exact document,
/// 404 otherwise) and data:/blob: media. Anything else (any other host, the app's own origins, ipc.localhost, favicon...) is refused.
fn allows_request(uri: &str, token: &str) -> bool {
    let lower = uri.to_ascii_lowercase();
    if lower.starts_with("data:") || lower.starts_with("blob:") {
        return true;
    }
    let Ok(url) = tauri::Url::parse(uri) else { return false };
    url.scheme() == "http" && url.host_str() == Some(HOST) && url.port().is_none() && url.username().is_empty() && url.password().is_none() && is_token(token) && url.path().starts_with(&format!("/{token}/"))
}

/// The protocol handler: the current document at its exact path, to the artifact webview only; 404 for everything else.
pub fn serve(allowed: bool, path: &str) -> Response<Vec<u8>> {
    let plain = |code: u16| Response::builder().status(code).header("content-type", "text/plain; charset=utf-8").header("cache-control", "no-store").body(b"Not found".to_vec()).unwrap();
    if !allowed {
        return plain(403);
    }
    let guard = PAGE.lock().ok();
    match guard.as_deref().and_then(|p| p.as_ref()) {
        Some(page) if path == format!("/{}/", page.token) => {
            let mut response = Response::builder().status(200).header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store");
            if let Some(csp) = csp_header() {
                response = response.header("content-security-policy", csp);
            }
            response.body(page.html.clone()).unwrap()
        }
        _ => plain(404),
    }
}

fn background(kind: &str, dark: bool) -> tauri::window::Color {
    if kind == "svg" && dark {
        tauri::window::Color(0x1c, 0x1c, 0x1b, 0xff)
    } else {
        tauri::window::Color(0xff, 0xff, 0xff, 0xff)
    }
}

fn window_title(title: Option<&str>, kind: &str) -> String {
    let named: String = title.map(str::trim).filter(|t| !t.is_empty()).map(|t| t.chars().take(80).collect()).unwrap_or_else(|| (if kind == "svg" { "SVG" } else { "HTML" }).to_string());
    format!("{named} · preview")
}

/// Opens the preview, or reuses the open window for a new document.
pub fn open(app: &AppHandle, html: String, kind: &str, title: Option<&str>, dark: bool) -> Result<Value, String> {
    // One open at a time: an overlapping open waits its turn instead of racing for the window or for the load signal, so an
    // earlier open is never failed by a later one (Electron's loadURL of the earlier one would be aborted).
    let _turn = OPEN_TURN.lock().unwrap_or_else(|e| e.into_inner());
    let shell = app.state::<crate::Shell>();
    // No zero token when the system random source fails.
    let token = crate::platform::try_random_hex(16)?;
    let (name, bg) = (window_title(title, kind), background(kind, dark));
    let page = Page { token: token.clone(), html: html.into_bytes() };
    let http: tauri::Url = format!("http://{HOST}/{token}/").parse().map_err(|_| "Invalid preview address.".to_string())?;
    #[cfg(feature = "ui-check")]
    NO_CSP.store(shell.ui_check && std::env::var("LUMEN_ARTIFACT_NO_CSP").as_deref() == Ok("1"), Ordering::SeqCst);
    // A window that is not (or no longer) guarded is never reused: it is destroyed and rebuilt (fail closed).
    let mut existing = app.get_webview_window(LABEL);
    if existing.is_some() && !GUARDED.load(Ordering::SeqCst) {
        discard(app);
        existing = None;
    }
    // open() returns when the document has loaded (Electron: loadURL resolves).
    let (tx, rx) = std::sync::mpsc::channel();
    *LOAD.lock().map_err(|_| "The preview is unavailable.".to_string())? = Some((token.clone(), tx));
    let started = if let Some(window) = existing {
        // Reused window: its handlers are in place.
        (|| -> Result<(), String> {
            *PAGE.lock().map_err(|_| "The preview is unavailable.".to_string())? = Some(page);
            window.set_title(&name).map_err(|e| e.to_string())?;
            let _ = window.set_background_color(Some(bg));
            window.navigate(http).map_err(|e| e.to_string())?;
            if !shell.ui_check {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            Ok(())
        })()
    } else {
        // A fresh window starts without a document (blank, nothing served: PAGE is empty). The document is set and loaded from
        // inside harden(), after every WebView2 handler is registered, so not even the first document runs unguarded.
        closed();
        let ui_check = shell.ui_check;
        let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External("about:blank".parse().expect("valid url")))
            .title(&name)
            .inner_size(960.0, 720.0)
            .min_inner_size(360.0, 280.0)
            .background_color(bg)
            .incognito(true)
            .data_directory(shell.data.join("webview").join(LABEL))
            .additional_browser_args(&browser_args(shell.ui_check))
            .on_navigation(allows_navigation)
            .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
            .on_page_load(move |window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished && allows_navigation(payload.url()) {
                    if !ui_check {
                        // Shown when the page has loaded (Electron: ready-to-show).
                        let _ = window.show();
                    }
                    loaded(payload.url());
                }
            });
        // Owned by the main window (WebviewWindowBuilder::parent does the same). The main window is looked up as a Window: with
        // the browser panel in it, Tauri no longer reports it as a WebviewWindow.
        if let Some(main) = app.get_window(crate::window::MAIN) {
            builder = builder.owner_raw(main.hwnd().map_err(|e| e.to_string())?);
        }
        builder = if ui_check {
            // Tests must not take the user's focus: off screen, shown without activation.
            builder.position(-4000.0, 0.0).focused(false).visible(true)
        } else {
            builder.visible(false)
        };
        match builder.build() {
            Ok(window) => harden(&window, page, http),
            Err(e) => Err(e.to_string()),
        }
    };
    // Anything but a loaded, guarded document: the window goes and nothing stays served (fail closed).
    let outcome = started.and_then(|_| match rx.recv_timeout(LOAD_LIMIT) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err("The preview did not load.".to_string()),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err("The preview was interrupted.".to_string()),
    });
    match outcome {
        Ok(()) => Ok(json!({"open": true})),
        Err(e) => {
            discard(app);
            Err(e)
        }
    }
}

/// Destroys the window (if any) and drops everything served.
fn discard(app: &AppHandle) {
    if let Ok(mut load) = LOAD.lock() {
        *load = None;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
        for _ in 0..40 {
            if app.get_webview_window(LABEL).is_none() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
    closed();
}

/// The document at `url` has loaded: the waiting open() may answer, if it waits for this very document.
fn loaded(url: &tauri::Url) {
    let Some(token) = url.path_segments().and_then(|mut s| s.next()).map(str::to_string) else { return };
    if let Ok(mut load) = LOAD.lock() {
        if load.as_ref().map(|(t, _)| *t == token).unwrap_or(false) {
            if let Some((_, tx)) = load.take() {
                let _ = tx.send(Ok(()));
            }
        }
    }
}

/// The preview could not be set up: the waiting open() fails.
fn failed(message: &str) {
    if let Ok(mut load) = LOAD.lock() {
        if let Some((_, tx)) = load.take() {
            let _ = tx.send(Err(message.to_string()));
        }
    }
}

pub fn close(app: &AppHandle) -> Result<Value, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
    Ok(Value::Null)
}

/// The window is gone (or starts over): the document is dropped and the next window must be guarded again.
pub fn closed() {
    GUARDED.store(false, Ordering::SeqCst);
    if let Ok(mut page) = PAGE.lock() {
        *page = None;
    }
}

/// The Destroyed event of a window: a newer window of the same label (rebuilt in the meantime) keeps its state.
pub fn destroyed(app: &AppHandle) {
    if app.get_webview_window(LABEL).is_none() {
        closed();
    }
}

/// Same arguments as the main webview plus WebRTC kept from leaking addresses (this profile has a folder of its own). Test builds
/// add a debugging port of their own (0 = a free one, written to <profile>/EBWebView/DevToolsActivePort), because a separate
/// profile is a separate browser process.
fn browser_args(_ui_check: bool) -> String {
    #[allow(unused_mut)]
    let mut args = format!("{} --force-webrtc-ip-handling-policy=disable_non_proxied_udp", crate::window::DEFAULT_BROWSER_ARGS);
    #[cfg(feature = "ui-check")]
    if _ui_check {
        args.push_str(" --remote-debugging-port=0");
    }
    args
}

/// A document title other than the address WebView2 reports for a page without <title>.
fn real_title(title: &str) -> Option<String> {
    let t = title.trim();
    let lower = t.to_ascii_lowercase();
    if t.is_empty() || lower == "about:blank" || lower.starts_with(HOST) || lower.starts_with("http://") || lower.starts_with("lumen-artifact:") {
        None
    } else {
        Some(t.to_string())
    }
}

/// Test builds only (--ui-check, LUMEN_ARTIFACT_FAIL_HARDEN=<n>): the first n hardening attempts fail, as if WebView2 refused the
/// request filter. A seam for the fail-closed test; production builds have no such path.
#[cfg(feature = "ui-check")]
fn forced_failure() -> bool {
    static LEFT: std::sync::OnceLock<std::sync::atomic::AtomicU32> = std::sync::OnceLock::new();
    let left = LEFT.get_or_init(|| std::sync::atomic::AtomicU32::new(std::env::var("LUMEN_ARTIFACT_FAIL_HARDEN").ok().and_then(|v| v.parse().ok()).unwrap_or(0)));
    left.try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1)).is_ok()
}
#[cfg(not(feature = "ui-check"))]
fn forced_failure() -> bool {
    false
}

/// WebView2 rules Tauri does not cover: every request but the current document is answered 403 before it leaves (documents,
/// workers and frames alike), navigations other than to the current document are cancelled (the page stays in place), permissions
/// and downloads are refused, new windows are never opened, script dialogs and context menus are off, and the window title
/// follows the document's <title> (Electron's behaviour). Only when everything is registered is the window marked guarded and the
/// document made current and loaded; any failure before that fails the waiting open() (which destroys the window).
fn harden(window: &WebviewWindow, page: Page, url: tauri::Url) -> Result<(), String> {
    let titled = window.clone();
    window
        .with_webview(move |webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use webview2_com::{take_pwstr, DocumentTitleChangedEventHandler, DownloadStartingEventHandler, NavigationStartingEventHandler, NewWindowRequestedEventHandler, PermissionRequestedEventHandler, WebResourceRequestedEventHandler};
            use windows::core::{Interface, HSTRING, PWSTR};
            if forced_failure() {
                return failed("The preview could not be protected (forced).");
            }
            let Ok(core) = webview.controller().CoreWebView2() else { return failed("The preview could not be protected.") };
            let env = webview.environment();
            let mut token = 0i64;
            let mut ok = true;
            if let Ok(settings) = core.Settings() {
                let _ = settings.SetAreDefaultScriptDialogsEnabled(false);
                let _ = settings.SetAreDefaultContextMenusEnabled(false);
                let _ = settings.SetIsStatusBarEnabled(false);
                if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
                    let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
                }
            }
            let denied = PermissionRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                }
                Ok(())
            }));
            ok &= core.add_PermissionRequested(&denied, &mut token).is_ok();
            let refused = NewWindowRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetHandled(true)?;
                }
                Ok(())
            }));
            ok &= core.add_NewWindowRequested(&refused, &mut token).is_ok();
            match core.cast::<ICoreWebView2_4>() {
                Ok(core4) => {
                    let no_download = DownloadStartingEventHandler::create(Box::new(|_, args| {
                        if let Some(args) = args {
                            args.SetCancel(true)?;
                            args.SetHandled(true)?;
                        }
                        Ok(())
                    }));
                    ok &= core4.add_DownloadStarting(&no_download, &mut token).is_ok();
                }
                Err(_) => ok = false,
            }
            // Navigations (top level and frames): only the current document, exactly; the page stays where it is.
            let stay = NavigationStartingEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    if !tauri::Url::parse(&take_pwstr(uri)).map(|u| allows_navigation(&u)).unwrap_or(false) {
                        args.SetCancel(true)?;
                    }
                }
                Ok(())
            }));
            ok &= core.add_NavigationStarting(&stay, &mut token).is_ok();
            let stay_in_frames = NavigationStartingEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    if !tauri::Url::parse(&take_pwstr(uri)).map(|u| allows_navigation(&u)).unwrap_or(false) {
                        args.SetCancel(true)?;
                    }
                }
                Ok(())
            }));
            ok &= core.add_FrameNavigationStarting(&stay_in_frames, &mut token).is_ok();
            let follow_title = DocumentTitleChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    let mut title = PWSTR::null();
                    sender.DocumentTitle(&mut title)?;
                    if let Some(title) = real_title(&take_pwstr(title)) {
                        let _ = titled.set_title(&title);
                    }
                }
                Ok(())
            }));
            ok &= core.add_DocumentTitleChanged(&follow_title, &mut token).is_ok();
            let blocker = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let request = args.Request()?;
                let mut uri = PWSTR::null();
                request.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                let allowed = current_token().map(|t| allows_request(&uri, &t)).unwrap_or(false);
                if !allowed {
                    let response = env.CreateWebResourceResponse(None, 403, &HSTRING::from("Forbidden"), &HSTRING::new())?;
                    args.SetResponse(&response)?;
                }
                Ok(())
            }));
            // Workers and frames too (as wry does for its own protocols) when the runtime has the newer filter.
            let filter = HSTRING::from("*");
            let added = match core.cast::<ICoreWebView2_22>() {
                Ok(core22) => core22.AddWebResourceRequestedFilterWithRequestSourceKinds(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL),
                Err(_) => core.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL),
            };
            ok &= added.is_ok() && core.add_WebResourceRequested(&blocker, &mut token).is_ok();
            if !ok {
                return failed("The preview could not be protected.");
            }
            // Guarded: only now does the document exist, and it loads.
            GUARDED.store(true, Ordering::SeqCst);
            if let Ok(mut current) = PAGE.lock() {
                *current = Some(page);
            }
            if core.Navigate(&HSTRING::from(url.as_str())).is_err() {
                failed("The preview could not be loaded.");
            }
        })
        .map_err(|e| format!("The preview could not be protected: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn url(s: &str) -> tauri::Url {
        s.parse().unwrap()
    }

    #[test]
    fn csp_matches_the_core() {
        let source = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/artifacts.cjs")).unwrap();
        let line = source.lines().find(|l| l.starts_with("const CSP = ")).expect("CSP line");
        assert_eq!(line, format!("const CSP = \"{CSP}\";"));
    }

    #[test]
    fn only_the_current_document_may_load() {
        for ok in [format!("http://lumen-artifact.localhost/{TOKEN}/"), format!("lumen-artifact://localhost/{TOKEN}/")] {
            assert!(is_document_url(&url(&ok), TOKEN), "{ok}");
        }
        let other = "f".repeat(32);
        for bad in [
            format!("http://lumen-artifact.localhost/{other}/"),
            format!("http://lumen-artifact.localhost/{TOKEN}"),
            format!("http://lumen-artifact.localhost/{TOKEN}/x.js"),
            format!("http://lumen-artifact.localhost/{TOKEN}/?a=1"),
            format!("http://lumen-artifact.localhost:8080/{TOKEN}/"),
            format!("http://lumen-artifact.localhost.evil.com/{TOKEN}/"),
            format!("https://lumen-artifact.localhost/{TOKEN}/"),
            format!("http://lumen.localhost/{TOKEN}/"),
            "http://lumen-artifact.localhost/".to_string(),
            "about:blank".to_string(),
            "https://example.com/".to_string(),
        ] {
            assert!(!is_document_url(&url(&bad), TOKEN), "{bad}");
        }
    }

    #[test]
    fn the_request_filter_lets_only_the_document_and_inline_media_through() {
        for ok in [format!("http://lumen-artifact.localhost/{TOKEN}/"), "data:image/png;base64,AAAA".into(), "blob:http://lumen-artifact.localhost/abc".into(), "DATA:text/plain,x".into()] {
            assert!(allows_request(&ok, TOKEN), "{ok}");
        }
        for bad in [
            "https://example.com/".to_string(),
            "http://127.0.0.1:4000/x".into(),
            "http://lumen-artifact.localhost/favicon.ico".into(),
            "http://lumen-artifact.localhost/".into(),
            format!("http://lumen-artifact.localhost/{}/", "e".repeat(32)),
            "http://lumen.localhost/index.html".into(),
            "http://ipc.localhost/lumen_call".into(),
            "ipc://localhost/lumen_call".into(),
            "file:///C:/Windows/win.ini".into(),
            format!("http://lumen-artifact.localhost@evil.com/{TOKEN}/"),
            format!("http://evil.com/{TOKEN}/"),
            "ftp://x/".into(),
            "".into(),
        ] {
            assert!(!allows_request(&bad, TOKEN), "{bad}");
        }
        assert!(!allows_request(&format!("http://lumen-artifact.localhost/{TOKEN}/"), "short"));
    }

    #[test]
    fn titles_follow_electron() {
        assert_eq!(window_title(None, "html"), "HTML · preview");
        assert_eq!(window_title(Some("  "), "svg"), "SVG · preview");
        assert_eq!(window_title(Some(" Şubat raporu "), "html"), "Şubat raporu · preview");
        assert_eq!(window_title(Some(&"x".repeat(100)), "html"), format!("{} · preview", "x".repeat(80)));
    }

    #[test]
    fn page_without_title_keeps_the_window_name() {
        for none in ["about:blank", "", "  ", "lumen-artifact.localhost/0123456789abcdef0123456789abcdef/", "http://lumen-artifact.localhost/x/", "LUMEN-ARTIFACT.LOCALHOST/x"] {
            assert_eq!(real_title(none), None, "{none:?}");
        }
        assert_eq!(real_title(" Rapor "), Some("Rapor".into()));
        assert_eq!(real_title("t"), Some("t".into()));
    }

    // LOAD belongs to this test alone.
    #[test]
    fn a_load_signal_belongs_to_its_own_document() {
        let (tx, rx) = std::sync::mpsc::channel();
        *LOAD.lock().unwrap() = Some((TOKEN.into(), tx));
        loaded(&url(&format!("http://lumen-artifact.localhost/{}/", "d".repeat(32))));
        assert!(rx.try_recv().is_err(), "a late Finished of another document releases nothing");
        loaded(&url(&format!("http://lumen-artifact.localhost/{TOKEN}/")));
        assert_eq!(rx.try_recv(), Ok(Ok(())));
        let (tx, rx) = std::sync::mpsc::channel();
        *LOAD.lock().unwrap() = Some((TOKEN.into(), tx));
        failed("nope");
        assert_eq!(rx.try_recv(), Ok(Err("nope".to_string())));
    }

    #[test]
    fn backgrounds_are_white_unless_a_dark_svg() {
        assert_eq!(background("html", true), tauri::window::Color(255, 255, 255, 255));
        assert_eq!(background("svg", false), tauri::window::Color(255, 255, 255, 255));
        assert_eq!(background("svg", true), tauri::window::Color(0x1c, 0x1c, 0x1b, 255));
    }

    // PAGE is process-wide: one test owns it.
    #[test]
    fn serves_the_current_document_only() {
        *PAGE.lock().unwrap() = Some(Page { token: TOKEN.into(), html: b"<p>hi</p>".to_vec() });
        let ok = serve(true, &format!("/{TOKEN}/"));
        assert_eq!(ok.status(), 200);
        assert_eq!(ok.body(), b"<p>hi</p>");
        assert_eq!(ok.headers()["content-security-policy"], CSP);
        assert_eq!(ok.headers()["cache-control"], "no-store");
        assert!(ok.headers()["content-type"].to_str().unwrap().starts_with("text/html"));
        assert!(allows_navigation(&url(&format!("http://lumen-artifact.localhost/{TOKEN}/"))));
        for path in ["/", "/favicon.ico", &format!("/{TOKEN}"), &format!("/{TOKEN}/x"), &format!("/{}/", "a".repeat(32))] {
            assert_eq!(serve(true, path).status(), 404, "{path}");
        }
        assert_eq!(serve(false, &format!("/{TOKEN}/")).status(), 403);
        closed();
        assert_eq!(serve(true, &format!("/{TOKEN}/")).status(), 404);
        assert!(!allows_navigation(&url(&format!("http://lumen-artifact.localhost/{TOKEN}/"))));
    }
}
