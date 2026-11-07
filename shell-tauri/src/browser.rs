// The in-app browser of the Tauri shell: the user's web panel (a child webview of the main window, Window::add_child, Tauri's
// `unstable` feature) and the hidden JavaScript renderer (a hidden WebviewWindow). This is the Tauri side of platform.browser
// (app/platform.cjs); Electron's is app/electron/browser-view.cjs, and the core (app/browser.cjs) decides what the panel shows.
// Spec: docs/superpowers/specs/2026-11-06-tauri-shell-bridge-design.md 5.4, 6 item 3, 6.0-6.2. Both webviews follow Electron's rules:
//  - a WebView2 profile of their own (<data>/webview/browser, Electron's persist:lumen-web), no bridge script, no capability
//    (capabilities/main.json names the main webview only), the Lumen protocols answer them 403, no DevTools window;
//  - no network of their own: every request goes through the core's filtering proxy (app/webproxy.cjs, Electron's webRequest
//    rules), named in browser.configure. Its Basic challenge is answered here, and only the challenge with its random realm,
//    so neither page scripts nor web sites see the token;
//  - top-level navigations only to http(s) addresses that are not local/private names or literals (Electron's will-navigate /
//    will-redirect checkUrl); frames to http(s), about:, data: and blob: (will-frame-navigate);
//  - permissions, downloads, client certificates, a site's Basic auth, script dialogs and new windows are refused; pop-ups go
//    to the core (browser.onPopup {url}), which loads them in the panel or drops them;
//  - Electron's executeJavaScriptInIsolatedWorld, sendInputEvent and Sec-GPC/DNT headers go through WebView2's in-process
//    DevTools channel (CallDevToolsProtocolMethod, no port): Page.createIsolatedWorld + Runtime.evaluate (never the page's own
//    world), Input.dispatchMouseEvent and Network.setExtraHTTPHeaders; findInPage is WebView2's Find API.
// Requests run one after another in the order the core sent them; render, waitIdle and evalIsolated run beside the queue (they
// wait for pages), renders one at a time.
use serde_json::{json, Value};
use std::collections::HashSet;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl};
use tokio::sync::{mpsc, oneshot, Notify};

/// Isolated worlds (Electron: 1101 for the panel, 1009 for the renderer). Page scripts cannot see or change them.
const PANEL_WORLD: &str = "lumen-panel";
const RENDER_WORLD: &str = "lumen-render";
const LOAD_LIMIT: Duration = Duration::from_secs(20);
const SETTLE: Duration = Duration::from_millis(1200);
const RENDER_IDLE: Duration = Duration::from_secs(60);
const CDP_LIMIT: Duration = Duration::from_secs(30);
const MAX_SCRIPT: usize = 1 << 20;
const RENDER_TEXT: &str = r#"({title:document.title,url:location.href,text:(document.body?document.body.innerText:"").slice(0,200000)})"#;

// ---------- pure rules (unit tested) ----------

/// What browser.configure says about the core's proxy: {proxy:'http://lumen:<token>@127.0.0.1:<port>', realm, testHost}.
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub port: u16,
    pub user: String,
    pub token: String,
    pub realm: String,
    /// Test builds with --ui-check only: the UI tests' local server ('127.0.0.1:<port>'); always None otherwise.
    pub test_host: Option<String>,
}

pub fn parse_session(v: &Value, ui_check: bool) -> Result<Session, String> {
    let bad = || "Invalid browser proxy.".to_string();
    let url = tauri::Url::parse(v["proxy"].as_str().ok_or_else(bad)?).map_err(|_| bad())?;
    let realm = v["realm"].as_str().ok_or_else(bad)?;
    let hex = |s: &str, n: usize| s.len() == n && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.username().is_empty() || url.password().unwrap_or("").len() < 32 || url.path() != "/" {
        return Err(bad());
    }
    if !realm.strip_prefix("lumen-").map(|r| hex(r, 32)).unwrap_or(false) {
        return Err(bad());
    }
    let decode = |s: &str| percent_encoding::percent_decode_str(s).decode_utf8_lossy().to_string();
    #[allow(unused_mut)]
    let mut test_host = None;
    #[cfg(feature = "ui-check")]
    if ui_check {
        test_host = v["testHost"].as_str().filter(|h| h.strip_prefix("127.0.0.1:").and_then(|p| p.parse::<u16>().ok()).filter(|p| *p != 0).is_some()).map(str::to_string);
    }
    let _ = ui_check;
    Ok(Session { port: url.port().ok_or_else(bad)?, user: decode(url.username()), token: decode(url.password().unwrap_or("")), realm: realm.to_string(), test_host })
}

/// WebView2 browser arguments of both browser webviews (they share a profile, so the arguments must be identical): all traffic
/// to the proxy, loopback included (Chromium bypasses proxies for loopback unless told `<-loopback>`), WebRTC kept from leaking
/// addresses outside it, and in test builds a debugging port of their own (0 = a free one, written to DevToolsActivePort).
pub fn browser_args(session: &Session, _ui_check: bool) -> String {
    #[allow(unused_mut)]
    let mut args = format!(
        "{} --proxy-server=http://127.0.0.1:{} --proxy-bypass-list=<-loopback> --force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        crate::window::DEFAULT_BROWSER_ARGS,
        session.port
    );
    #[cfg(feature = "ui-check")]
    if _ui_check {
        args.push_str(" --remote-debugging-port=0");
    }
    args
}

/// web.cjs ipv4Private.
fn ipv4_private(ip: std::net::Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    a == 0 || a == 10 || a == 127 || a >= 224 || (a == 100 && (64..=127).contains(&b)) || (a == 169 && b == 254) || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168) || (a == 192 && b == 0 && c == 0) || (a == 192 && b == 0 && c == 2) || (a == 198 && (b == 18 || b == 19)) || (a == 198 && b == 51 && c == 100) || (a == 203 && b == 0 && c == 113)
}

/// web.cjs privateAddress (IPv6 classified by bytes, embedded IPv4 included).
pub fn private_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => ipv4_private(v4),
        IpAddr::V6(v6) => {
            let b = v6.octets();
            let embedded = || ipv4_private(std::net::Ipv4Addr::new(b[12], b[13], b[14], b[15]));
            let zeros = |n: usize| b[..n].iter().all(|x| *x == 0);
            if zeros(10) && b[10] == 0xff && b[11] == 0xff {
                return embedded();
            }
            if zeros(12) {
                return embedded();
            }
            if zeros(8) && b[8] == 0xff && b[9] == 0xff && b[10] == 0 && b[11] == 0 {
                return embedded();
            }
            let (first, second) = (u16::from(b[0]) << 8 | u16::from(b[1]), u16::from(b[2]) << 8 | u16::from(b[3]));
            if (first == 0x64 && second == 0xff9b) || (first == 0x2001 && (second == 0 || second == 0x0db8)) {
                return true;
            }
            (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80 || (first & 0xff00) == 0xff00 || first == 0x2002
        }
    }
}

/// web.cjs blockedHostname.
pub fn blocked_hostname(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    let h = h.trim_end_matches('.');
    h == "localhost" || [".localhost", ".local", ".internal", ".home.arpa"].iter().any(|s| h.ends_with(s)) || h == "metadata.google.internal"
}

/// web.cjs checkUrl: http(s), no credentials, no local/private name or literal (the test host aside, in test builds).
pub fn check_url(url: &tauri::Url, test_host: Option<&str>) -> bool {
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str() else { return false };
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if let (Some(t), Some(port)) = (test_host, url.port()) {
        if format!("{bare}:{port}") == t {
            return true;
        }
    }
    if blocked_hostname(bare) {
        return false;
    }
    match bare.parse::<IpAddr>() {
        Ok(ip) => !private_address(ip),
        Err(_) => true,
    }
}

/// Top-level navigations: the blank start page, else checkUrl (Electron will-navigate / will-redirect).
pub fn allows_navigation(url: &tauri::Url, test_host: Option<&str>) -> bool {
    url.as_str() == "about:blank" || check_url(url, test_host)
}

/// Frame navigations (Electron will-frame-navigate); the proxy filters their requests.
pub fn allows_frame(uri: &str) -> bool {
    let lower = uri.to_ascii_lowercase();
    ["http:", "https:", "about:", "data:", "blob:"].iter().any(|s| lower.starts_with(s))
}

/// The proxy's challenge, and only it, gets the token: the random realm must be in it.
pub fn is_proxy_challenge(challenge: &str, realm: &str) -> bool {
    realm.len() > 6 && challenge.contains(realm)
}

/// A navigation that failed, as Electron's did-fail-load reports it: (code, description). None for a cancelled navigation
/// (Electron's -3, which the core ignores) or a success. `proxy` is the X-Lumen-Proxy mark of the document's response.
pub fn failure(success: bool, status: i32, proxy: Option<&str>) -> Option<(i32, &'static str)> {
    match proxy {
        Some("blocked") => return Some((-20, "ERR_BLOCKED_BY_CLIENT")),
        Some("dns") => return Some((-105, "ERR_NAME_NOT_RESOLVED")),
        Some("gateway") => return Some((-104, "ERR_CONNECTION_FAILED")),
        Some("bad-request") => return Some((-300, "ERR_INVALID_URL")),
        _ => {}
    }
    if success {
        return None;
    }
    // COREWEBVIEW2_WEB_ERROR_STATUS values.
    Some(match status {
        1 => (-200, "ERR_CERT_COMMON_NAME_INVALID"),
        2 => (-201, "ERR_CERT_DATE_INVALID"),
        3 => (-110, "ERR_SSL_CLIENT_AUTH_CERT_NEEDED"),
        4 => (-206, "ERR_CERT_REVOKED"),
        5 => (-207, "ERR_CERT_INVALID"),
        6 => (-109, "ERR_ADDRESS_UNREACHABLE"),
        7 => (-118, "ERR_CONNECTION_TIMED_OUT"),
        8 => (-320, "ERR_INVALID_RESPONSE"),
        9 => (-103, "ERR_CONNECTION_ABORTED"),
        10 => (-101, "ERR_CONNECTION_RESET"),
        11 => (-106, "ERR_INTERNET_DISCONNECTED"),
        12 => (-102, "ERR_CONNECTION_REFUSED"),
        13 => (-105, "ERR_NAME_NOT_RESOLVED"),
        14 => return None,
        15 => (-310, "ERR_TOO_MANY_REDIRECTS"),
        17 => (-401, "ERR_INVALID_AUTH_CREDENTIALS"),
        18 => (-127, "ERR_PROXY_AUTH_REQUESTED"),
        _ => (-2, "ERR_FAILED"),
    })
}

/// Keys typed while the page has focus that Lumen's panel handles (Electron's before-input-event table in browser-view.cjs).
pub fn shortcut(vk: u32, ctrl: bool, alt: bool, find_active: bool) -> Option<&'static str> {
    match vk {
        0x46 if ctrl => Some("find"),
        0x4C if ctrl => Some("address"),
        0xBB | 0x6B if ctrl => Some("zoom-in"),
        0xBD | 0x6D if ctrl => Some("zoom-out"),
        0x30 | 0x60 if ctrl => Some("zoom-reset"),
        0x1B if find_active => Some("find-close"),
        0x25 if alt => Some("back"),
        0x27 if alt => Some("forward"),
        0x74 => Some("reload"),
        0x52 if ctrl => Some("reload"),
        _ => None,
    }
}

/// Electron's sendInputEvent mouse event -> Input.dispatchMouseEvent parameters. x/y: Electron passes DIPs of the view (the core
/// multiplies page coordinates by the zoom factor); DevTools takes CSS pixels of the viewport, so they are divided by `zoom`.
pub fn mouse_event(event: &Value, zoom: f64) -> Result<Value, String> {
    let bad = || "Invalid input event.".to_string();
    let kind = match event["type"].as_str() {
        Some("mouseMove") => "mouseMoved",
        Some("mouseDown") => "mousePressed",
        Some("mouseUp") => "mouseReleased",
        _ => return Err(bad()),
    };
    let (x, y) = (event["x"].as_f64().filter(|v| v.is_finite()).ok_or_else(bad)?, event["y"].as_f64().filter(|v| v.is_finite()).ok_or_else(bad)?);
    let button = match event["button"].as_str() {
        Some(b @ ("left" | "right" | "middle")) => b,
        None if kind == "mouseMoved" => "none",
        None => "left",
        _ => return Err(bad()),
    };
    let zoom = if zoom.is_finite() && zoom > 0.0 { zoom } else { 1.0 };
    let clicks = event["clickCount"].as_u64().unwrap_or(if kind == "mouseMoved" { 0 } else { 1 }).min(3);
    let bit = match button {
        "left" => 1,
        "right" => 2,
        "middle" => 4,
        _ => 0,
    };
    Ok(json!({"type": kind, "x": x / zoom, "y": y / zoom, "button": button, "buttons": if kind == "mousePressed" { bit } else { 0 }, "clickCount": clicks}))
}

/// Electron renderNow's clean-up of the page text: runs of spaces/tabs to one space, at most one blank line, trimmed.
pub fn tidy_text(text: &str) -> String {
    // .replace(/[ \t]+/g,' ')
    let mut spaced = String::with_capacity(text.len());
    for ch in text.chars() {
        if ch == ' ' || ch == '\t' {
            if !spaced.ends_with(' ') || spaced.is_empty() {
                spaced.push(' ');
            }
        } else {
            spaced.push(ch);
        }
    }
    // .replace(/\n{3,}/g,'\n\n')
    let mut out = String::with_capacity(spaced.len());
    let mut run = 0usize;
    for ch in spaced.chars() {
        if ch == '\n' {
            run += 1;
            if run <= 2 {
                out.push('\n');
            }
        } else {
            run = 0;
            out.push(ch);
        }
    }
    out.trim().to_string()
}

fn bounds_of(v: &Value) -> Result<(f64, f64, f64, f64), String> {
    let n = |k: &str| v[k].as_f64().filter(|x| x.is_finite());
    match (n("x"), n("y"), n("width"), n("height")) {
        (Some(x), Some(y), Some(w), Some(h)) if w >= 1.0 && h >= 1.0 && w <= 20000.0 && h <= 20000.0 => Ok((x, y, w, h)),
        _ => Err("Invalid bounds.".into()),
    }
}

/// Validates a request's arguments before anything runs (unknown methods are refused).
pub fn validate(method: &str, args: &[Value]) -> Result<(), String> {
    let bad = || Err("Invalid platform arguments.".to_string());
    let url = |i: usize| args.get(i).and_then(Value::as_str).and_then(|s| tauri::Url::parse(s).ok()).filter(|u| matches!(u.scheme(), "http" | "https"));
    match method {
        "browser.configure" => args.first().filter(|v| v.is_object()).map(|_| ()).ok_or_else(|| "Invalid platform arguments.".to_string()),
        "browser.create" | "browser.hide" | "browser.back" | "browser.forward" | "browser.reload" | "browser.stop" | "browser.close" | "browser.info" | "browser.clearData" | "browser.onNavigate" | "browser.onPopup" | "browser.onState" => Ok(()),
        "browser.show" => bounds_of(args.first().unwrap_or(&Value::Null)).map(|_| ()),
        "browser.navigate" | "browser.render" => url(0).map(|_| ()).ok_or_else(|| "Only http and https pages can be opened.".to_string()),
        "browser.find" => args.first().and_then(Value::as_str).filter(|t| !t.is_empty() && t.chars().count() <= 1000).map(|_| ()).ok_or_else(|| "Invalid platform arguments.".to_string()),
        "browser.stopFind" => Ok(()),
        "browser.evalIsolated" => args.first().and_then(Value::as_str).filter(|s| s.len() <= MAX_SCRIPT).map(|_| ()).ok_or_else(|| "Invalid platform arguments.".to_string()),
        "browser.input" => mouse_event(args.first().unwrap_or(&Value::Null), 1.0).map(|_| ()),
        "browser.setZoom" => args.first().and_then(Value::as_f64).filter(|z| (0.25..=5.0).contains(z)).map(|_| ()).ok_or_else(|| "Invalid zoom.".to_string()),
        "browser.waitIdle" => args.first().and_then(Value::as_f64).filter(|m| (0.0..=120_000.0).contains(m)).map(|_| ()).ok_or_else(|| "Invalid platform arguments.".to_string()),
        "browser.cancel" => args.first().and_then(Value::as_str).map(|_| ()).ok_or_else(|| "Invalid platform arguments.".to_string()),
        _ => bad(),
    }
}

// ---------- state ----------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Panel,
    Render,
}

/// What the handlers of one webview know about it.
struct Page {
    kind: Kind,
    loading: AtomicBool,
    /// The address of the current top-level navigation (redirects update it) and the X-Lumen-Proxy mark of its response.
    target: Mutex<String>,
    mark: Mutex<Option<String>>,
    /// The renderer's load waiter.
    load: Mutex<Option<oneshot::Sender<Result<(), String>>>>,
    find_active: AtomicBool,
    find_term: Mutex<Option<String>>,
}

impl Page {
    fn new(kind: Kind) -> Arc<Page> {
        Arc::new(Page { kind, loading: AtomicBool::new(false), target: Mutex::new(String::new()), mark: Mutex::new(None), load: Mutex::new(None), find_active: AtomicBool::new(false), find_term: Mutex::new(None) })
    }
    fn settle_load(&self, result: Result<(), String>) {
        if let Some(tx) = self.load.lock().ok().and_then(|mut l| l.take()) {
            let _ = tx.send(result);
        }
    }
}

#[derive(Clone)]
enum Handle {
    Panel(tauri::Webview),
    Render(tauri::WebviewWindow),
}

impl Handle {
    fn with_webview<F: FnOnce(tauri::webview::PlatformWebview) + Send + 'static>(&self, f: F) -> Result<(), String> {
        match self {
            Handle::Panel(w) => w.with_webview(f),
            Handle::Render(w) => w.with_webview(f),
        }
        .map_err(|e| e.to_string())
    }
    fn destroy(&self) {
        match self {
            Handle::Panel(w) => {
                let _ = w.close();
            }
            Handle::Render(w) => {
                let _ = w.destroy();
            }
        }
    }
}

#[derive(Clone)]
struct View {
    handle: Handle,
    page: Arc<Page>,
}

struct RenderJob {
    id: String,
    url: String,
}

pub struct Browser {
    app: AppHandle,
    data: PathBuf,
    ui_check: bool,
    session: Mutex<Option<Session>>,
    privacy: AtomicBool,
    panel: Mutex<Option<View>>,
    render: Mutex<Option<View>>,
    forward: [AtomicBool; 3],
    seq: AtomicU64,
    render_generation: AtomicU64,
    renders: mpsc::UnboundedSender<RenderJob>,
    queue: mpsc::UnboundedSender<(String, String, Vec<Value>)>,
    cancelled: Mutex<HashSet<String>>,
    current: Mutex<Option<(String, Arc<Notify>)>>,
}

static BROWSER: OnceLock<Arc<Browser>> = OnceLock::new();

const NAVIGATE: usize = 0;
const POPUP: usize = 1;
const STATE: usize = 2;

/// A browser request of the core, called in the order the requests were read. The answer goes back with core.answer(id).
pub fn dispatch(app: &AppHandle, id: String, method: String, args: Vec<Value>) {
    let browser = BROWSER.get_or_init(|| start(app));
    if method == "browser.cancel" {
        let answer = validate(&method, &args).map(|_| {
            browser.cancel(args[0].as_str().unwrap_or_default());
            Value::Null
        });
        return browser.answer(id, answer);
    }
    let _ = browser.queue.send((id, method, args));
}

fn start(app: &AppHandle) -> Arc<Browser> {
    let shell = app.state::<crate::Shell>();
    let (queue, mut requests) = mpsc::unbounded_channel::<(String, String, Vec<Value>)>();
    let (renders, mut jobs) = mpsc::unbounded_channel::<RenderJob>();
    let browser = Arc::new(Browser {
        app: app.clone(),
        data: shell.data.clone(),
        ui_check: shell.ui_check,
        session: Mutex::new(None),
        privacy: AtomicBool::new(true),
        panel: Mutex::new(None),
        render: Mutex::new(None),
        forward: [AtomicBool::new(false), AtomicBool::new(false), AtomicBool::new(false)],
        seq: AtomicU64::new(0),
        render_generation: AtomicU64::new(0),
        renders,
        queue,
        cancelled: Mutex::new(HashSet::new()),
        current: Mutex::new(None),
    });
    let b = browser.clone();
    tauri::async_runtime::spawn(async move {
        while let Some((id, method, args)) = requests.recv().await {
            if let Err(e) = validate(&method, &args) {
                b.answer(id, Err(e));
                continue;
            }
            match method.as_str() {
                "browser.render" => {
                    let _ = b.renders.send(RenderJob { id, url: args[0].as_str().unwrap_or_default().to_string() });
                }
                // These wait for pages: beside the queue, like Electron's promises.
                "browser.waitIdle" | "browser.evalIsolated" => {
                    let b = b.clone();
                    tauri::async_runtime::spawn(async move {
                        let answer = b.run(&method, &args).await;
                        b.answer(id, answer);
                    });
                }
                _ => {
                    let answer = b.run(&method, &args).await;
                    b.answer(id, answer);
                }
            }
        }
    });
    let b = browser.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(job) = jobs.recv().await {
            let answer = if b.cancelled.lock().map(|mut c| c.remove(&job.id)).unwrap_or(false) { Err("Cancelled".to_string()) } else { b.render_page(&job.id, &job.url).await };
            b.answer(job.id, answer);
        }
    });
    browser
}

impl Browser {
    fn answer(&self, id: String, answer: Result<Value, String>) {
        self.app.state::<crate::Shell>().core.answer(id, answer);
    }

    fn emit(&self, which: usize, payload: Value) {
        if !self.forward[which].load(Ordering::SeqCst) {
            return;
        }
        let name = ["browser.onNavigate", "browser.onPopup", "browser.onState"][which];
        self.app.state::<crate::Shell>().core.event(name, payload);
    }

    fn session(&self) -> Result<Session, String> {
        self.session.lock().ok().and_then(|s| s.clone()).ok_or_else(|| "The web session is not set up.".to_string())
    }

    fn panel(&self) -> Option<View> {
        self.panel.lock().ok().and_then(|p| p.clone())
    }

    fn cancel(&self, id: &str) {
        if let Ok(current) = self.current.lock() {
            if let Some((running, stop)) = current.as_ref() {
                if running == id {
                    stop.notify_one();
                    return;
                }
            }
        }
        if let Ok(mut c) = self.cancelled.lock() {
            if c.len() > 1000 {
                c.clear();
            }
            c.insert(id.to_string());
        }
    }

    async fn run(self: &Arc<Self>, method: &str, args: &[Value]) -> Result<Value, String> {
        let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
        match method {
            "browser.configure" => {
                let settings = arg(0);
                if let Some(proxy) = args.get(1).filter(|v| v.is_object()) {
                    let session = parse_session(proxy, self.ui_check)?;
                    let mut current = self.session.lock().map_err(|_| "The browser is unavailable.".to_string())?;
                    // The proxy runs for the whole life of the core; a different one cannot apply to webviews already made.
                    if current.as_ref().map(|c| c != &session).unwrap_or(false) && (self.panel().is_some() || self.render.lock().map(|r| r.is_some()).unwrap_or(false)) {
                        return Err("The web session is already set up with another proxy.".into());
                    }
                    *current = Some(session);
                }
                self.privacy.store(settings["privacySignals"] != false, Ordering::SeqCst);
                let views: Vec<View> = [self.panel(), self.render.lock().ok().and_then(|r| r.clone())].into_iter().flatten().collect();
                for view in views {
                    let _ = self.headers(&view).await;
                }
                Ok(Value::Null)
            }
            "browser.onNavigate" | "browser.onPopup" | "browser.onState" => {
                let i = match method {
                    "browser.onNavigate" => NAVIGATE,
                    "browser.onPopup" => POPUP,
                    _ => STATE,
                };
                self.forward[i].store(true, Ordering::SeqCst);
                Ok(Value::Null)
            }
            "browser.create" => {
                if self.panel().is_some() {
                    return Ok(Value::Null);
                }
                let javascript = arg(0)["javascript"] != false;
                let view = self.build(Kind::Panel, javascript).await?;
                if let Ok(mut p) = self.panel.lock() {
                    *p = Some(view);
                }
                Ok(Value::Null)
            }
            "browser.show" => {
                let (x, y, w, h) = bounds_of(&arg(0))?;
                if let Some(View { handle: Handle::Panel(webview), .. }) = self.panel() {
                    webview.set_bounds(tauri::Rect { position: LogicalPosition::new(x, y).into(), size: LogicalSize::new(w, h).into() }).map_err(|e| e.to_string())?;
                    webview.show().map_err(|e| e.to_string())?;
                }
                Ok(Value::Null)
            }
            "browser.hide" => {
                if let Some(View { handle: Handle::Panel(webview), .. }) = self.panel() {
                    webview.hide().map_err(|e| e.to_string())?;
                }
                Ok(Value::Null)
            }
            "browser.close" => {
                let view = self.panel.lock().ok().and_then(|mut p| p.take());
                if let Some(view) = view {
                    view.page.find_active.store(false, Ordering::SeqCst);
                    view.handle.destroy();
                }
                Ok(Value::Null)
            }
            "browser.navigate" => {
                if let Some(View { handle: Handle::Panel(webview), .. }) = self.panel() {
                    let url = tauri::Url::parse(args[0].as_str().unwrap_or_default()).map_err(|_| "Invalid address.".to_string())?;
                    webview.navigate(url).map_err(|e| e.to_string())?;
                }
                Ok(Value::Null)
            }
            "browser.back" | "browser.forward" | "browser.reload" | "browser.stop" => {
                if let Some(view) = self.panel() {
                    let m = method.to_string();
                    com(&view.handle, move |core, _| unsafe {
                        let (mut back, mut forward) = (windows::core::BOOL(0), windows::core::BOOL(0));
                        let _ = core.CanGoBack(&mut back);
                        let _ = core.CanGoForward(&mut forward);
                        let _ = match m.as_str() {
                            "browser.back" if back.as_bool() => core.GoBack(),
                            "browser.forward" if forward.as_bool() => core.GoForward(),
                            "browser.reload" => core.Reload(),
                            "browser.stop" => core.Stop(),
                            _ => Ok(()),
                        };
                    })
                    .await?;
                }
                Ok(Value::Null)
            }
            "browser.info" => {
                let Some(view) = self.panel() else { return Ok(Value::Null) };
                let loading = view.page.loading.load(Ordering::SeqCst);
                com(&view.handle, move |core, controller| unsafe {
                    let (mut back, mut forward) = (windows::core::BOOL(0), windows::core::BOOL(0));
                    let _ = core.CanGoBack(&mut back);
                    let _ = core.CanGoForward(&mut forward);
                    let (mut source, mut title) = (windows::core::PWSTR::null(), windows::core::PWSTR::null());
                    let _ = core.Source(&mut source);
                    let _ = core.DocumentTitle(&mut title);
                    let mut zoom = 1.0f64;
                    let _ = controller.ZoomFactor(&mut zoom);
                    let url = webview2_com::take_pwstr(source);
                    let url = if url == "about:blank" { String::new() } else { url };
                    let title = webview2_com::take_pwstr(title);
                    let title = if title == "about:blank" { String::new() } else { title };
                    json!({"url": url, "title": title, "loading": loading, "canGoBack": back.as_bool(), "canGoForward": forward.as_bool(), "zoom": zoom})
                })
                .await
            }
            "browser.setZoom" => {
                if let Some(view) = self.panel() {
                    let factor = arg(0).as_f64().unwrap_or(1.0);
                    com(&view.handle, move |_, controller| unsafe {
                        let _ = controller.SetZoomFactor(factor);
                    })
                    .await?;
                }
                Ok(Value::Null)
            }
            "browser.waitIdle" => {
                let ms = arg(0).as_f64().unwrap_or(0.0) as u64;
                let Some(view) = self.panel() else { return Ok(Value::Null) };
                let end = std::time::Instant::now() + Duration::from_millis(ms);
                while view.page.loading.load(Ordering::SeqCst) && std::time::Instant::now() < end {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Ok(Value::Null)
            }
            "browser.evalIsolated" => {
                let view = self.panel().ok_or("The browser panel is closed.")?;
                evaluate(&view.handle, PANEL_WORLD, args[0].as_str().unwrap_or_default()).await
            }
            "browser.input" => {
                if let Some(view) = self.panel() {
                    let zoom = com(&view.handle, |_, controller| unsafe {
                        let mut zoom = 1.0f64;
                        let _ = controller.ZoomFactor(&mut zoom);
                        zoom
                    })
                    .await?;
                    cdp(&view.handle, "Input.dispatchMouseEvent", mouse_event(&arg(0), zoom)?).await?;
                }
                Ok(Value::Null)
            }
            "browser.find" => {
                let Some(view) = self.panel() else { return Ok(Value::Bool(false)) };
                let text = arg(0).as_str().unwrap_or_default().to_string();
                let options = arg(1);
                let (forward, new_session) = (options["forward"] != false, options["findNext"] == true);
                let same = view.page.find_term.lock().map(|t| t.as_deref() == Some(text.as_str())).unwrap_or(false);
                let page = view.page.clone();
                com(&view.handle, move |core, _| unsafe { find(core, &page, &text, forward, new_session || !same) }).await??;
                Ok(Value::Bool(true))
            }
            "browser.stopFind" => {
                let Some(view) = self.panel() else { return Ok(Value::Bool(false)) };
                view.page.find_active.store(false, Ordering::SeqCst);
                if let Ok(mut t) = view.page.find_term.lock() {
                    *t = None;
                }
                com(&view.handle, |core, _| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_28;
                    use windows::core::Interface;
                    if let Ok(f) = core.cast::<ICoreWebView2_28>().and_then(|c| c.Find()) {
                        let _ = f.Stop();
                    }
                })
                .await?;
                Ok(Value::Bool(true))
            }
            "browser.clearData" => self.clear_data().await.map(|_| Value::Null),
            _ => Err("Invalid platform arguments.".into()),
        }
    }

    /// Creates the panel (a hidden child of the main window, placed by browser.show) or the hidden renderer window. Nothing remote
    /// loads before every handler is registered; if they cannot all be registered the webview is destroyed (fail closed).
    async fn build(self: &Arc<Self>, kind: Kind, javascript: bool) -> Result<View, String> {
        let session = self.session()?;
        let label = format!("{}-{}", if kind == Kind::Panel { "browser" } else { "render" }, self.seq.fetch_add(1, Ordering::SeqCst) + 1);
        let page = Page::new(kind);
        let (app, data, ui_check) = (self.app.clone(), self.data.join("webview").join("browser"), self.ui_check);
        let args = browser_args(&session, ui_check);
        let test_host = session.test_host.clone();
        let blank: tauri::Url = "about:blank".parse().expect("valid url");
        let handle = tauri::async_runtime::spawn_blocking(move || -> Result<Handle, String> {
            let guard_host = test_host.clone();
            let popup_host = test_host.clone();
            let navigation = move |url: &tauri::Url| allows_navigation(url, guard_host.as_deref());
            // Pop-ups never open a window: an address that passes checkUrl goes to the core (which checks it again).
            let popup = move |url: tauri::Url, _features| {
                if check_url(&url, popup_host.as_deref()) {
                    if let Some(b) = BROWSER.get() {
                        b.emit(POPUP, json!({"url": url.as_str()}));
                    }
                }
                tauri::webview::NewWindowResponse::Deny
            };
            match kind {
                Kind::Panel => {
                    let main = app.get_window(crate::window::MAIN).ok_or("The window is gone.")?;
                    let mut builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(blank))
                        .data_directory(data)
                        .additional_browser_args(&args)
                        .devtools(false)
                        .focused(false)
                        .background_color(tauri::window::Color(0xff, 0xff, 0xff, 0xff))
                        .on_navigation(navigation)
                        .on_new_window(popup)
                        .on_download(|_, _| false);
                    if !javascript {
                        builder = builder.disable_javascript();
                    }
                    let webview = main.add_child(builder, LogicalPosition::new(-30000.0, -30000.0), LogicalSize::new(800.0, 600.0)).map_err(|e| e.to_string())?;
                    let _ = webview.hide();
                    Ok(Handle::Panel(webview))
                }
                Kind::Render => {
                    let window = tauri::WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(blank))
                        .title("lumen.cpp renderer")
                        .inner_size(1280.0, 900.0)
                        .visible(false)
                        .focused(false)
                        .skip_taskbar(true)
                        .data_directory(data)
                        .additional_browser_args(&args)
                        .devtools(false)
                        .on_navigation(navigation)
                        .on_new_window(popup)
                        .on_download(|_, _| false)
                        .build()
                        .map_err(|e| e.to_string())?;
                    Ok(Handle::Render(window))
                }
            }
        })
        .await
        .map_err(|e| e.to_string())??;
        let view = View { handle: handle.clone(), page: page.clone() };
        let guarded = harden(self.clone(), &view, session).await;
        let headers = match guarded {
            Ok(()) => self.headers(&view).await,
            Err(e) => Err(e),
        };
        if let Err(e) = headers {
            handle.destroy();
            return Err(e);
        }
        Ok(view)
    }

    /// Sec-GPC: 1 and DNT: 1 on every request of the page while Settings → Browser → privacy signals is on (Electron:
    /// onBeforeSendHeaders). Set through DevTools, so HTTPS requests carry them too.
    async fn headers(&self, view: &View) -> Result<(), String> {
        let headers = if self.privacy.load(Ordering::SeqCst) { json!({"Sec-GPC": "1", "DNT": "1"}) } else { json!({}) };
        cdp(&view.handle, "Network.enable", json!({})).await?;
        cdp(&view.handle, "Network.setExtraHTTPHeaders", json!({"headers": headers})).await?;
        Ok(())
    }

    async fn render_view(self: &Arc<Self>) -> Result<View, String> {
        if let Some(view) = self.render.lock().ok().and_then(|r| r.clone()) {
            return Ok(view);
        }
        let view = self.build(Kind::Render, true).await?;
        if let Ok(mut r) = self.render.lock() {
            *r = Some(view.clone());
        }
        Ok(view)
    }

    fn drop_render(&self) {
        if let Some(view) = self.render.lock().ok().and_then(|mut r| r.take()) {
            view.handle.destroy();
        }
    }

    /// The hidden renderer (Electron renderNow): load (20 s at most), give client-side rendering 1.2 s, read the text in an
    /// isolated world. Cancellable (browser.cancel with this request's id). The window goes after a minute without use.
    async fn render_page(self: &Arc<Self>, id: &str, raw: &str) -> Result<Value, String> {
        let session = self.session()?;
        let url = tauri::Url::parse(raw).ok().filter(|u| check_url(u, session.test_host.as_deref())).ok_or("Local and private network addresses are blocked.")?;
        let stop = Arc::new(Notify::new());
        if let Ok(mut c) = self.current.lock() {
            *c = Some((id.to_string(), stop.clone()));
        }
        self.render_generation.fetch_add(1, Ordering::SeqCst);
        let result = self.render_now(url, &stop, &session).await;
        if let Ok(mut c) = self.current.lock() {
            *c = None;
        }
        let generation = self.render_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let b = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(RENDER_IDLE).await;
            if b.render_generation.load(Ordering::SeqCst) == generation {
                b.drop_render();
            }
        });
        result
    }

    async fn render_now(self: &Arc<Self>, url: tauri::Url, stop: &Notify, session: &Session) -> Result<Value, String> {
        let cancelled = || "Cancelled".to_string();
        let view = self.render_view().await?;
        let (tx, rx) = oneshot::channel();
        if let Ok(mut l) = view.page.load.lock() {
            *l = Some(tx);
        }
        let Handle::Render(window) = &view.handle else { return Err("The renderer is unavailable.".into()) };
        window.navigate(url).map_err(|e| e.to_string())?;
        let halt = |view: &View| {
            let _ = view.handle.with_webview(|w| unsafe {
                if let Ok(core) = w.controller().CoreWebView2() {
                    let _ = core.Stop();
                }
            });
        };
        tokio::select! {
            loaded = tokio::time::timeout(LOAD_LIMIT, rx) => match loaded {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(e))) => return Err(e),
                Ok(Err(_)) => return Err("The page could not be loaded (the renderer stopped).".into()),
                Err(_) => { halt(&view); return Err("The page took too long to load.".into()); }
            },
            _ = stop.notified() => { halt(&view); return Err(cancelled()); }
        }
        tokio::select! {
            _ = tokio::time::sleep(SETTLE) => {}
            _ = stop.notified() => return Err(cancelled()),
        }
        let page = tokio::select! {
            page = evaluate(&view.handle, RENDER_WORLD, RENDER_TEXT) => page?,
            _ = stop.notified() => return Err(cancelled()),
        };
        let final_url = page["url"].as_str().unwrap_or_default().to_string();
        if !tauri::Url::parse(&final_url).map(|u| check_url(&u, session.test_host.as_deref())).unwrap_or(false) {
            return Err("Local and private network addresses are blocked.".into());
        }
        let title: String = page["title"].as_str().unwrap_or_default().chars().take(300).collect();
        Ok(json!({"title": title, "url": final_url, "text": tidy_text(page["text"].as_str().unwrap_or_default())}))
    }

    /// Clears the profile's cookies, storage and cache (Electron: clearStorageData + clearCache). The renderer goes; a webview
    /// is needed to reach the profile, so the renderer is made for it when the panel is closed.
    async fn clear_data(self: &Arc<Self>) -> Result<(), String> {
        self.drop_render();
        let view = match self.panel() {
            Some(v) => v,
            None => self.render_view().await?,
        };
        let (tx, rx) = oneshot::channel::<Result<(), String>>();
        view.handle.with_webview(move |w| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Profile2, ICoreWebView2_13};
            use windows::core::Interface;
            let profile = w.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_13>()).and_then(|c| c.Profile()).and_then(|p| p.cast::<ICoreWebView2Profile2>());
            match profile {
                Ok(profile) => {
                    // If the call fails at once, the handler (and the sender) is dropped and the wait below fails.
                    let handler = webview2_com::ClearBrowsingDataCompletedHandler::create(Box::new(move |r| {
                        let _ = tx.send(r.map_err(|e| e.message()));
                        Ok(())
                    }));
                    let _ = profile.ClearBrowsingDataAll(&handler);
                }
                Err(e) => {
                    let _ = tx.send(Err(e.message()));
                }
            }
        })?;
        let result = tokio::time::timeout(CDP_LIMIT, rx).await.map_err(|_| "Clearing browsing data timed out.".to_string())?.map_err(|_| "Clearing browsing data failed.".to_string())?;
        self.drop_render();
        result
    }
}

// ---------- WebView2 plumbing ----------

/// Runs `f` on the webview's thread with its CoreWebView2 and controller and returns what it returns.
async fn com<T: Send + 'static>(handle: &Handle, f: impl FnOnce(&webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2, &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller) -> T + Send + 'static) -> Result<T, String> {
    let (tx, rx) = oneshot::channel();
    handle.with_webview(move |w| {
        let controller = w.controller();
        if let Ok(core) = unsafe { controller.CoreWebView2() } {
            let _ = tx.send(f(&core, &controller));
        }
    })?;
    tokio::time::timeout(CDP_LIMIT, rx).await.map_err(|_| "The page did not answer.".to_string())?.map_err(|_| "The page is gone.".to_string())
}

/// One DevTools method through WebView2's in-process channel (no debugging port).
async fn cdp(handle: &Handle, method: &str, params: Value) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let (method_name, params) = (method.to_string(), params.to_string());
    handle.with_webview(move |w| unsafe {
        use windows::core::HSTRING;
        let core = match w.controller().CoreWebView2() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(e.message()));
                return;
            }
        };
        let sender = Arc::new(Mutex::new(Some(tx)));
        let done = sender.clone();
        let handler = webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
            if let Some(tx) = done.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(match result {
                    Ok(()) => Ok(json),
                    Err(e) => Err(format!("{} {}", e.message(), json)),
                });
            }
            Ok(())
        }));
        if let Err(e) = core.CallDevToolsProtocolMethod(&HSTRING::from(method_name), &HSTRING::from(params), &handler) {
            if let Some(tx) = sender.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(Err(e.message()));
            }
        }
    })?;
    let json = tokio::time::timeout(CDP_LIMIT, rx).await.map_err(|_| format!("{method} did not answer."))?.map_err(|_| "The page is gone.".to_string())??;
    serde_json::from_str(&json).map_err(|_| format!("{method} returned no JSON."))
}

/// Electron's executeJavaScriptInIsolatedWorld: the script runs in a named isolated world of the main frame (created once per
/// document and name, so globals it sets persist between calls), never in the page's own world. Promises are awaited.
async fn evaluate(handle: &Handle, world: &str, script: &str) -> Result<Value, String> {
    let tree = cdp(handle, "Page.getFrameTree", json!({})).await?;
    let frame = tree["frameTree"]["frame"]["id"].as_str().ok_or("The page has no frame.")?.to_string();
    let created = cdp(handle, "Page.createIsolatedWorld", json!({"frameId": frame, "worldName": world, "grantUniveralAccess": false})).await?;
    let context = created["executionContextId"].as_i64().ok_or("The isolated world could not be created.")?;
    let r = cdp(handle, "Runtime.evaluate", json!({"expression": script, "contextId": context, "returnByValue": true, "awaitPromise": true, "userGesture": true, "silent": true})).await?;
    if let Some(details) = r.get("exceptionDetails") {
        let text = details["exception"]["description"].as_str().or(details["text"].as_str()).unwrap_or("Script failed.");
        return Err(text.chars().take(500).collect());
    }
    Ok(r["result"]["value"].clone())
}

/// Starts a find session or steps through it (Electron findInPage: findNext=true starts a new session).
unsafe fn find(core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2, page: &Page, text: &str, forward: bool, new_session: bool) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment15, ICoreWebView2_2, ICoreWebView2_28};
    use windows::core::{Interface, HSTRING};
    let finder = core.cast::<ICoreWebView2_28>().and_then(|c| c.Find()).map_err(|_| "Find is not available in this WebView2 runtime.".to_string())?;
    if !new_session {
        let _ = if forward { finder.FindNext() } else { finder.FindPrevious() };
        return Ok(());
    }
    let env = core.cast::<ICoreWebView2_2>().and_then(|c| c.Environment()).and_then(|e| e.cast::<ICoreWebView2Environment15>()).map_err(|e| e.message())?;
    let options = env.CreateFindOptions().map_err(|e| e.message())?;
    options.SetFindTerm(&HSTRING::from(text)).map_err(|e| e.message())?;
    let _ = options.SetSuppressDefaultFindDialog(true);
    let _ = options.SetShouldHighlightAllMatches(true);
    let _ = finder.Stop();
    if let Ok(mut t) = page.find_term.lock() {
        *t = Some(text.to_string());
    }
    let backwards = !forward;
    let stepper = finder.clone();
    let started = webview2_com::FindStartCompletedHandler::create(Box::new(move |_| {
        if backwards {
            let _ = stepper.FindPrevious();
        }
        Ok(())
    }));
    finder.Start(&options, &started).map_err(|e| e.message())
}

/// Registers every WebView2 handler of a browser webview (the rules at the top of this file). Ok only when all are in place.
async fn harden(browser: Arc<Browser>, view: &View, session: Session) -> Result<(), String> {
    let (tx, rx) = oneshot::channel::<bool>();
    let page = view.page.clone();
    let log = browser.data.join("renderer.log");
    let ui_check = browser.ui_check;
    view.handle.with_webview(move |w| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use webview2_com::*;
        use windows::core::{Interface, BOOL, HSTRING, PWSTR};
        let controller = w.controller();
        let Ok(core) = controller.CoreWebView2() else {
            let _ = tx.send(false);
            return;
        };
        let mut token = 0i64;
        let mut ok = true;
        let kind = page.kind;
        if let Ok(settings) = core.Settings() {
            ok &= settings.SetAreDefaultScriptDialogsEnabled(false).is_ok();
            let _ = settings.SetAreDefaultContextMenusEnabled(false);
            let _ = settings.SetIsStatusBarEnabled(false);
            let _ = settings.SetAreDevToolsEnabled(false);
            // Zoom is Lumen's (browser.cjs); Ctrl+wheel and pinch do not change it behind its back.
            let _ = settings.SetIsZoomControlEnabled(false);
            if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
                let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
            }
            if let Ok(s5) = settings.cast::<ICoreWebView2Settings5>() {
                let _ = s5.SetIsPinchZoomEnabled(false);
            }
        } else {
            ok = false;
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
        // The proxy's challenge (its realm) gets the token; any other Basic auth request is refused (Electron: 'login' prevented).
        match core.cast::<ICoreWebView2_10>() {
            Ok(core10) => {
                let s = session.clone();
                let auth = BasicAuthenticationRequestedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut challenge = PWSTR::null();
                    args.Challenge(&mut challenge)?;
                    if is_proxy_challenge(&take_pwstr(challenge), &s.realm) {
                        let response = args.Response()?;
                        response.SetUserName(&HSTRING::from(s.user.as_str()))?;
                        response.SetPassword(&HSTRING::from(s.token.as_str()))?;
                    } else {
                        args.SetCancel(true)?;
                    }
                    Ok(())
                }));
                ok &= core10.add_BasicAuthenticationRequested(&auth, &mut token).is_ok();
            }
            Err(_) => ok = false,
        }
        match core.cast::<ICoreWebView2_5>() {
            Ok(core5) => {
                let no_certificate = ClientCertificateRequestedEventHandler::create(Box::new(|_, args| {
                    if let Some(args) = args {
                        args.SetCancel(true)?;
                    }
                    Ok(())
                }));
                ok &= core5.add_ClientCertificateRequested(&no_certificate, &mut token).is_ok();
            }
            Err(_) => ok = false,
        }
        // TEST ONLY (ui-check builds, --ui-check, the core's test host): the self-signed certificate of the tests' HTTPS server.
        #[cfg(feature = "ui-check")]
        if let (true, Some(test_host)) = (ui_check, session.test_host.clone()) {
            if let Ok(core14) = core.cast::<ICoreWebView2_14>() {
                let trust = ServerCertificateErrorDetectedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut uri = PWSTR::null();
                    args.RequestUri(&mut uri)?;
                    let uri = take_pwstr(uri);
                    if tauri::Url::parse(&uri).map(|u| u.scheme() == "https" && u.port().map(|p| format!("127.0.0.1:{p}")) == Some(test_host.clone()) && u.host_str() == Some("127.0.0.1")).unwrap_or(false) {
                        args.SetAction(COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW)?;
                    }
                    Ok(())
                }));
                let _ = core14.add_ServerCertificateErrorDetected(&trust, &mut token);
            }
        }
        let _ = ui_check;
        // Frames: http(s), about:, data:, blob: (Electron will-frame-navigate).
        let frames = NavigationStartingEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                if !allows_frame(&take_pwstr(uri)) {
                    args.SetCancel(true)?;
                }
            }
            Ok(())
        }));
        ok &= core.add_FrameNavigationStarting(&frames, &mut token).is_ok();
        // Load state (Electron did-start-loading / did-stop-loading / did-finish-load / did-fail-load).
        let p = page.clone();
        let starting = NavigationStartingEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut cancel = BOOL(0);
            args.Cancel(&mut cancel)?;
            if cancel.as_bool() {
                return Ok(());
            }
            let mut uri = PWSTR::null();
            args.Uri(&mut uri)?;
            let uri = take_pwstr(uri);
            let blank = uri.starts_with("about:");
            if let Ok(mut t) = p.target.lock() {
                *t = uri;
            }
            if let Ok(mut m) = p.mark.lock() {
                *m = None;
            }
            if !blank {
                let was = p.loading.swap(true, Ordering::SeqCst);
                if p.kind == Kind::Panel && !was {
                    if let Some(b) = BROWSER.get() {
                        b.emit(NAVIGATE, json!({"type": "start"}));
                    }
                }
            }
            Ok(())
        }));
        ok &= core.add_NavigationStarting(&starting, &mut token).is_ok();
        // The proxy marks the replies it makes itself (X-Lumen-Proxy): a refused document is a failed load, as in Electron.
        match core.cast::<ICoreWebView2_2>() {
            Ok(core2) => {
                let p = page.clone();
                let marks = WebResourceResponseReceivedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut uri = PWSTR::null();
                    args.Request()?.Uri(&mut uri)?;
                    let uri = take_pwstr(uri);
                    if p.target.lock().map(|t| *t == uri).unwrap_or(false) {
                        let headers = args.Response()?.Headers()?;
                        let mut has = BOOL(0);
                        let name = HSTRING::from("X-Lumen-Proxy");
                        if headers.Contains(&name, &mut has).is_ok() && has.as_bool() {
                            let mut value = PWSTR::null();
                            headers.GetHeader(&name, &mut value)?;
                            if let Ok(mut m) = p.mark.lock() {
                                *m = Some(take_pwstr(value).trim().to_ascii_lowercase());
                            }
                        }
                    }
                    Ok(())
                }));
                ok &= core2.add_WebResourceResponseReceived(&marks, &mut token).is_ok();
            }
            Err(_) => ok = false,
        }
        let p = page.clone();
        let completed = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut success = BOOL(0);
            args.IsSuccess(&mut success)?;
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS(0);
            let _ = args.WebErrorStatus(&mut status);
            let target = p.target.lock().map(|t| t.clone()).unwrap_or_default();
            if target.starts_with("about:") {
                return Ok(());
            }
            p.loading.store(false, Ordering::SeqCst);
            let mark = p.mark.lock().ok().and_then(|m| m.clone());
            let failed = failure(success.as_bool(), status.0, mark.as_deref());
            match p.kind {
                Kind::Panel => {
                    if let Some(b) = BROWSER.get() {
                        b.emit(NAVIGATE, json!({"type": "update"}));
                        match failed {
                            None if success.as_bool() => b.emit(NAVIGATE, json!({"type": "finish"})),
                            None => {}
                            Some((code, description)) => b.emit(NAVIGATE, json!({"type": "fail", "code": code, "description": description, "url": target})),
                        }
                    }
                }
                // A cancelled navigation (replaced by another) keeps the renderer waiting, as Electron ignores -3.
                Kind::Render => match failed {
                    None if success.as_bool() => p.settle_load(Ok(())),
                    None => {}
                    Some((-20, _)) => p.settle_load(Err("This address is blocked.".into())),
                    Some((_, description)) => p.settle_load(Err(format!("The page could not be loaded ({description})."))),
                },
            }
            Ok(())
        }));
        ok &= core.add_NavigationCompleted(&completed, &mut token).is_ok();
        let failed_log = log.clone();
        let p = page.clone();
        let gone = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND(-1);
            if let Some(args) = args {
                let _ = args.ProcessFailedKind(&mut kind);
            }
            crate::window::append(&failed_log, &format!("{{\"type\":\"process-failed\",\"webview\":\"{}\",\"kind\":{}}}", if p.kind == Kind::Panel { "browser" } else { "render" }, kind.0));
            let page_gone = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
            if page_gone {
                p.loading.store(false, Ordering::SeqCst);
                match p.kind {
                    Kind::Panel => {
                        let mut url = String::new();
                        if let Some(sender) = sender {
                            let mut source = PWSTR::null();
                            if sender.Source(&mut source).is_ok() {
                                url = take_pwstr(source);
                            }
                        }
                        if let Some(b) = BROWSER.get() {
                            b.emit(NAVIGATE, json!({"type": "gone", "url": url}));
                        }
                    }
                    Kind::Render => p.settle_load(Err("The page stopped responding.".into())),
                }
            }
            Ok(())
        }));
        ok &= core.add_ProcessFailed(&gone, &mut token).is_ok();
        if kind == Kind::Panel {
            for updated in 0..3 {
                let update = move || {
                    if let Some(b) = BROWSER.get() {
                        b.emit(NAVIGATE, json!({"type": "update"}));
                    }
                };
                ok &= match updated {
                    0 => core.add_SourceChanged(&SourceChangedEventHandler::create(Box::new(move |_, _| { update(); Ok(()) })), &mut token).is_ok(),
                    1 => core.add_HistoryChanged(&HistoryChangedEventHandler::create(Box::new(move |_, _| { update(); Ok(()) })), &mut token).is_ok(),
                    _ => core.add_DocumentTitleChanged(&DocumentTitleChangedEventHandler::create(Box::new(move |_, _| { update(); Ok(()) })), &mut token).is_ok(),
                };
            }
            // Shortcuts typed in the page go to Lumen's panel (Electron before-input-event).
            let p = page.clone();
            let keys = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND(0);
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN {
                    return Ok(());
                }
                let mut vk = 0u32;
                args.VirtualKey(&mut vk)?;
                use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU};
                let down = |k: u16| GetKeyState(i32::from(k)) < 0;
                if let Some(name) = shortcut(vk, down(VK_CONTROL.0), down(VK_MENU.0), p.find_active.load(Ordering::SeqCst)) {
                    args.SetHandled(true)?;
                    if let Some(b) = BROWSER.get() {
                        b.emit(STATE, json!({"type": "shortcut", "name": name}));
                    }
                }
                Ok(())
            }));
            ok &= controller.add_AcceleratorKeyPressed(&keys, &mut token).is_ok();
            // Find results (Electron found-in-page).
            if let Ok(finder) = core.cast::<ICoreWebView2_28>().and_then(|c| c.Find()) {
                for which in 0..2 {
                    let p = page.clone();
                    let report = move |f: Option<ICoreWebView2Find>| {
                        let Some(f) = f else { return };
                        let (mut matches, mut active) = (0i32, -1i32);
                        let _ = f.MatchCount(&mut matches);
                        let _ = f.ActiveMatchIndex(&mut active);
                        p.find_active.store(true, Ordering::SeqCst);
                        if let Some(b) = BROWSER.get() {
                            b.emit(STATE, json!({"type": "found", "matches": matches.max(0), "active": if active < 0 { 0 } else { active }}));
                        }
                    };
                    ok &= if which == 0 {
                        finder.add_MatchCountChanged(&FindMatchCountChangedEventHandler::create(Box::new(move |f, _| { report(f); Ok(()) })), &mut token).is_ok()
                    } else {
                        finder.add_ActiveMatchIndexChanged(&FindActiveMatchIndexChangedEventHandler::create(Box::new(move |f, _| { report(f); Ok(()) })), &mut token).is_ok()
                    };
                }
            } else {
                ok = false;
            }
        } else {
            // The renderer is never heard (Electron: setAudioMuted(true)).
            if let Ok(core8) = core.cast::<ICoreWebView2_8>() {
                let _ = core8.SetIsMuted(true);
            }
            let _ = controller.SetIsVisible(true);
        }
        let _ = tx.send(ok);
    })?;
    match tokio::time::timeout(CDP_LIMIT, rx).await {
        Ok(Ok(true)) => Ok(()),
        _ => Err("The browser page could not be protected.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> tauri::Url {
        s.parse().unwrap()
    }
    const REALM: &str = "lumen-0123456789abcdef0123456789abcdef";
    fn proxy(token: &str) -> Value {
        json!({"proxy": format!("http://lumen:{token}@127.0.0.1:5123"), "realm": REALM, "testHost": "127.0.0.1:4000"})
    }

    #[test]
    fn the_proxy_session_is_parsed_strictly() {
        let token = "a".repeat(48);
        let s = parse_session(&proxy(&token), true).unwrap();
        assert_eq!((s.port, s.user.as_str(), s.token.as_str(), s.realm.as_str()), (5123, "lumen", token.as_str(), REALM));
        // The test host exists only in test builds run with --ui-check.
        assert_eq!(s.test_host.as_deref(), if cfg!(feature = "ui-check") { Some("127.0.0.1:4000") } else { None });
        assert_eq!(parse_session(&proxy(&token), false).unwrap().test_host, None);
        let mut v = proxy(&token);
        v["testHost"] = json!("10.0.0.1:4000");
        assert_eq!(parse_session(&v, true).unwrap().test_host, None);
        for bad in [
            json!({"proxy": format!("http://lumen:{token}@10.0.0.1:5123"), "realm": REALM}),
            json!({"proxy": format!("https://lumen:{token}@127.0.0.1:5123"), "realm": REALM}),
            json!({"proxy": "http://lumen:short@127.0.0.1:5123", "realm": REALM}),
            json!({"proxy": format!("http://127.0.0.1:5123"), "realm": REALM}),
            json!({"proxy": format!("http://lumen:{token}@127.0.0.1:5123"), "realm": "Lumen"}),
            json!({"proxy": format!("http://lumen:{token}@127.0.0.1"), "realm": REALM}),
            json!({"realm": REALM}),
        ] {
            assert!(parse_session(&bad, true).is_err(), "{bad}");
        }
    }

    #[test]
    fn every_request_goes_to_the_proxy_loopback_included() {
        let s = parse_session(&proxy(&"b".repeat(48)), true).unwrap();
        let args = browser_args(&s, true);
        assert!(args.starts_with(crate::window::DEFAULT_BROWSER_ARGS));
        assert!(args.contains(" --proxy-server=http://127.0.0.1:5123 "));
        assert!(args.contains(" --proxy-bypass-list=<-loopback>"));
        assert!(args.contains("--force-webrtc-ip-handling-policy=disable_non_proxied_udp"));
        assert!(!args.contains(&s.token), "the token is never a browser argument");
        assert_eq!(args.contains("--remote-debugging-port=0"), cfg!(feature = "ui-check"));
        assert!(!browser_args(&s, false).contains("--remote-debugging-port"));
    }

    #[test]
    fn navigation_follows_web_cjs_check_url() {
        for ok in ["https://example.com/", "http://93.184.216.34/x", "https://[2606:4700::1]/", "about:blank", "https://x.example.com:8443/a?b"] {
            assert!(allows_navigation(&url(ok), None), "{ok}");
        }
        for bad in [
            "http://127.0.0.1/", "http://192.168.1.1/", "http://10.1.2.3/", "http://169.254.169.254/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fc00::1]/", "http://[fe80::1]/",
            "http://0.0.0.0/", "http://100.64.0.1/", "http://localhost:3000/", "http://lumen.localhost/", "http://tauri.localhost/", "http://ipc.localhost/x", "http://printer.local/", "http://db.internal/",
            "http://router.home.arpa/", "https://user:pw@example.com/", "file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,x", "ftp://example.com/", "about:srcdoc", "http://2130706433/", "http://0x7f.1/",
        ] {
            assert!(!allows_navigation(&url(bad), None), "{bad}");
        }
        // The test host: exactly that host and port.
        assert!(allows_navigation(&url("http://127.0.0.1:4000/a"), Some("127.0.0.1:4000")));
        assert!(allows_navigation(&url("https://127.0.0.1:4000/a"), Some("127.0.0.1:4000")));
        for bad in ["http://127.0.0.1:4001/", "http://127.0.0.1/", "http://localhost:4000/", "http://[::ffff:127.0.0.1]:4000/"] {
            assert!(!allows_navigation(&url(bad), Some("127.0.0.1:4000")), "{bad}");
        }
        for ok in ["https://a/", "http://a/", "about:blank", "data:text/html,x", "blob:https://a/1", "DATA:x"] {
            assert!(allows_frame(ok), "{ok}");
        }
        for bad in ["file:///C:/x", "javascript:x", "lumen://localhost/", "chrome://settings", "ftp://x/"] {
            assert!(!allows_frame(bad), "{bad}");
        }
    }

    #[test]
    fn private_addresses_match_web_cjs() {
        for ip in ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "::1", "::", "::ffff:10.0.0.1", "::ffff:0:10.0.0.1", "fc00::1", "fe80::1", "ff02::1", "2002::1", "64:ff9b::1", "2001::1", "2001:db8::1", "::10.0.0.1"] {
            assert!(private_address(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["93.184.216.34", "8.8.8.8", "2606:4700::1", "::ffff:93.184.216.34"] {
            assert!(!private_address(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn only_the_proxy_realm_gets_the_token() {
        assert!(is_proxy_challenge(&format!("Basic realm=\"{REALM}\""), REALM));
        assert!(is_proxy_challenge(REALM, REALM));
        for other in ["Basic realm=\"Lumen\"", "Basic realm=\"lumen-\"", "", "Basic realm=\"lumen-0123\""] {
            assert!(!is_proxy_challenge(other, REALM), "{other}");
        }
        assert!(!is_proxy_challenge("anything", ""));
    }

    #[test]
    fn failures_read_like_electron() {
        assert_eq!(failure(true, 0, None), None);
        assert_eq!(failure(true, 0, Some("blocked")), Some((-20, "ERR_BLOCKED_BY_CLIENT")));
        assert_eq!(failure(true, 0, Some("dns")), Some((-105, "ERR_NAME_NOT_RESOLVED")));
        assert_eq!(failure(false, 14, None), None, "a cancelled navigation is not reported (Electron -3)");
        assert_eq!(failure(false, 13, None), Some((-105, "ERR_NAME_NOT_RESOLVED")));
        assert_eq!(failure(false, 99, None), Some((-2, "ERR_FAILED")));
    }

    #[test]
    fn shortcuts_match_electron() {
        assert_eq!(shortcut(0x46, true, false, false), Some("find"));
        assert_eq!(shortcut(0x46, false, false, false), None);
        assert_eq!(shortcut(0x4C, true, false, false), Some("address"));
        assert_eq!(shortcut(0xBB, true, false, false), Some("zoom-in"));
        assert_eq!(shortcut(0xBD, true, false, false), Some("zoom-out"));
        assert_eq!(shortcut(0x30, true, false, false), Some("zoom-reset"));
        assert_eq!(shortcut(0x1B, false, false, true), Some("find-close"));
        assert_eq!(shortcut(0x1B, false, false, false), None);
        assert_eq!(shortcut(0x25, false, true, false), Some("back"));
        assert_eq!(shortcut(0x27, false, true, false), Some("forward"));
        assert_eq!(shortcut(0x74, false, false, false), Some("reload"));
        assert_eq!(shortcut(0x52, true, false, false), Some("reload"));
        assert_eq!(shortcut(0x41, true, false, false), None);
    }

    #[test]
    fn mouse_events_become_devtools_events() {
        assert_eq!(mouse_event(&json!({"type": "mouseMove", "x": 10, "y": 20}), 1.0).unwrap(), json!({"type": "mouseMoved", "x": 10.0, "y": 20.0, "button": "none", "buttons": 0, "clickCount": 0}));
        assert_eq!(mouse_event(&json!({"type": "mouseDown", "x": 125, "y": 250, "button": "left", "clickCount": 1}), 1.25).unwrap(), json!({"type": "mousePressed", "x": 100.0, "y": 200.0, "button": "left", "buttons": 1, "clickCount": 1}));
        assert_eq!(mouse_event(&json!({"type": "mouseUp", "x": 1, "y": 2, "button": "left", "clickCount": 1}), 1.0).unwrap()["buttons"], 0);
        for bad in [json!({"type": "keyDown", "x": 1, "y": 1}), json!({"type": "mouseDown", "x": "1", "y": 1}), json!({"type": "mouseDown", "x": 1}), json!({"type": "mouseDown", "x": 1, "y": 1, "button": "x"}), json!(null)] {
            assert!(mouse_event(&bad, 1.0).is_err(), "{bad}");
        }
    }

    #[test]
    fn rendered_text_is_tidied_like_electron() {
        assert_eq!(tidy_text("  a \t b\n\n\n\nc  \n d\t"), "a b\n\nc \n d");
        assert_eq!(tidy_text("a\n \n \nb"), "a\n \n \nb", "only plain newline runs collapse, as in the regex");
        assert_eq!(tidy_text("x\n\ny"), "x\n\ny");
        assert_eq!(tidy_text("Ş ü\tğ"), "Ş ü ğ");
        assert_eq!(tidy_text(" \n\t "), "");
    }

    #[test]
    fn requests_are_validated() {
        assert!(validate("browser.show", &[json!({"x": 1, "y": 2, "width": 300, "height": 200})]).is_ok());
        assert!(validate("browser.show", &[json!({"x": 1, "y": 2, "width": 0, "height": 200})]).is_err());
        assert!(validate("browser.navigate", &[json!("https://example.com/")]).is_ok());
        assert!(validate("browser.navigate", &[json!("file:///C:/x")]).is_err());
        assert!(validate("browser.render", &[json!("javascript:1")]).is_err());
        assert!(validate("browser.setZoom", &[json!(1.25)]).is_ok());
        assert!(validate("browser.setZoom", &[json!(50)]).is_err());
        assert!(validate("browser.evalIsolated", &[json!("1+1")]).is_ok());
        assert!(validate("browser.evalIsolated", &[json!("x".repeat(MAX_SCRIPT + 1))]).is_err());
        assert!(validate("browser.find", &[json!(""), json!({})]).is_err());
        assert!(validate("browser.configure", &[json!({})]).is_ok());
        assert!(validate("browser.input", &[json!({"type": "mouseDown", "x": 1, "y": 1})]).is_ok());
        assert!(validate("browser.nope", &[]).is_err());
    }
}
