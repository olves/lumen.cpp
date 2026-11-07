// The artifact preview window (HTML/SVG code blocks of a reply), the Tauri side of app/artifacts.cjs. Same rules as Electron's
// electron/artifact-window.cjs: its own non-persistent WebView2 profile, no bridge script and no capability, a CSP header, no
// network at all (every request except the current document is answered 403), no permissions, downloads, new windows,
// dialogs or navigation. The document is served by the `lumen-artifact` protocol (http://lumen-artifact.localhost/ on Windows)
// under a random 32-hex path prefix per document: http://lumen-artifact.localhost/<token>/ (Electron uses the token as host).
use serde_json::{json, Value};
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
static LOAD: Mutex<Option<std::sync::mpsc::Sender<()>>> = Mutex::new(None);
const LOAD_LIMIT: std::time::Duration = std::time::Duration::from_secs(20);
/// Test builds only (--ui-check, LUMEN_ARTIFACT_NO_CSP=1): the document is served without its CSP header, so that a test can see
/// the request filter work on its own. Never set in a production build.
#[cfg(feature = "ui-check")]
static NO_CSP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
fn csp_header() -> Option<&'static str> {
    #[cfg(feature = "ui-check")]
    if NO_CSP.load(std::sync::atomic::Ordering::SeqCst) {
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
    let shell = app.state::<crate::Shell>();
    // No zero token when the system random source fails.
    let token = crate::platform::try_random_hex(16)?;
    let (name, bg) = (window_title(title, kind), background(kind, dark));
    let page = Page { token: token.clone(), html: html.into_bytes() };
    let http: tauri::Url = format!("http://{HOST}/{token}/").parse().map_err(|_| "Invalid preview address.".to_string())?;
    #[cfg(feature = "ui-check")]
    NO_CSP.store(shell.ui_check && std::env::var("LUMEN_ARTIFACT_NO_CSP").as_deref() == Ok("1"), std::sync::atomic::Ordering::SeqCst);
    // open() returns when the document has loaded (Electron: loadURL resolves).
    let (tx, rx) = std::sync::mpsc::channel();
    *LOAD.lock().map_err(|_| "The preview is unavailable.".to_string())? = Some(tx);
    if let Some(window) = app.get_webview_window(LABEL) {
        // Reused window: its handlers are in place.
        *PAGE.lock().map_err(|_| "The preview is unavailable.".to_string())? = Some(page);
        window.set_title(&name).map_err(|e| e.to_string())?;
        let _ = window.set_background_color(Some(bg));
        window.navigate(http).map_err(|e| e.to_string())?;
        if !shell.ui_check {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
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
                    loaded();
                }
            });
        if let Some(main) = app.get_webview_window(crate::window::MAIN) {
            builder = builder.parent(&main).map_err(|e| e.to_string())?;
        }
        builder = if ui_check {
            // Tests must not take the user's focus: off screen, shown without activation.
            builder.position(-4000.0, 0.0).focused(false).visible(true)
        } else {
            builder.visible(false)
        };
        let window = builder.build().map_err(|e| e.to_string())?;
        if let Err(e) = harden(&window, page, http) {
            let _ = window.destroy();
            return Err(e);
        }
    }
    match rx.recv_timeout(LOAD_LIMIT) {
        Ok(()) => Ok(json!({"open": true})),
        Err(_) => Err("The preview did not load.".to_string()),
    }
}

/// The document has loaded: open() may answer.
fn loaded() {
    if let Ok(mut load) = LOAD.lock() {
        if let Some(tx) = load.take() {
            let _ = tx.send(());
        }
    }
}

pub fn close(app: &AppHandle) -> Result<Value, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
    Ok(Value::Null)
}

/// The window is gone (or starts over): the document is dropped.
pub fn closed() {
    if let Ok(mut page) = PAGE.lock() {
        *page = None;
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
    if t.is_empty() || t.to_ascii_lowercase().starts_with(HOST) || t.to_ascii_lowercase().starts_with("http://") || t.to_ascii_lowercase().starts_with("lumen-artifact:") {
        None
    } else {
        Some(t.to_string())
    }
}

/// WebView2 rules Tauri does not cover: every request but the current document is answered 403 before it leaves (documents,
/// workers and frames alike), permissions and downloads are refused, new windows are never opened, script dialogs and context
/// menus are off, and the window title follows the document's <title> (Electron's behaviour). When everything is registered the
/// document is made current and loaded.
fn harden(window: &WebviewWindow, page: Page, url: tauri::Url) -> Result<(), String> {
    let titled = window.clone();
    window
        .with_webview(move |webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use webview2_com::{take_pwstr, DocumentTitleChangedEventHandler, DownloadStartingEventHandler, NewWindowRequestedEventHandler, PermissionRequestedEventHandler, WebResourceRequestedEventHandler};
            use windows::core::{Interface, HSTRING, PWSTR};
            let Ok(core) = webview.controller().CoreWebView2() else { return };
            let env = webview.environment();
            let mut token = 0i64;
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
            let _ = core.add_PermissionRequested(&denied, &mut token);
            let refused = NewWindowRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetHandled(true)?;
                }
                Ok(())
            }));
            let _ = core.add_NewWindowRequested(&refused, &mut token);
            if let Ok(core4) = core.cast::<ICoreWebView2_4>() {
                let no_download = DownloadStartingEventHandler::create(Box::new(|_, args| {
                    if let Some(args) = args {
                        args.SetCancel(true)?;
                        args.SetHandled(true)?;
                    }
                    Ok(())
                }));
                let _ = core4.add_DownloadStarting(&no_download, &mut token);
            }
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
            let _ = core.add_DocumentTitleChanged(&follow_title, &mut token);
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
            let registered = added.is_ok() && core.add_WebResourceRequested(&blocker, &mut token).is_ok();
            if !registered {
                eprintln!("[artifact] the request filter could not be installed; the document is not loaded");
                return;
            }
            // Only now does the document exist, and it loads.
            if let Ok(mut current) = PAGE.lock() {
                *current = Some(page);
            }
            let _ = core.Navigate(&HSTRING::from(url.as_str()));
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
        for none in ["", "  ", "lumen-artifact.localhost/0123456789abcdef0123456789abcdef/", "http://lumen-artifact.localhost/x/", "LUMEN-ARTIFACT.LOCALHOST/x"] {
            assert_eq!(real_title(none), None, "{none:?}");
        }
        assert_eq!(real_title(" Rapor "), Some("Rapor".into()));
        assert_eq!(real_title("t"), Some("t".into()));
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
