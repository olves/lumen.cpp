// The `lumen` protocol (http://lumen.localhost/ on Windows) serves the UI from app/ and photos/generated images from the data
// folder. The core decides what exists (core.asset: allowlist, routes, headers, index.html with the saved theme); this side
// refuses traversal, absolute paths and drive letters first and checks that every file the core names lies where it should.
use crate::core::Core;
use percent_encoding::percent_decode_str;
use std::path::{Path, PathBuf};
use tauri::http::{Response, StatusCode};

#[derive(Debug, PartialEq, Eq)]
pub struct Resolved {
    /// Path relative to the protocol root, decoded ('index.html' for '/').
    pub rel: String,
    /// The file under app/ for UI files; None for the data routes (generated/, photo/, photo-thumb/).
    pub file: Option<PathBuf>,
}

const DATA_ROUTES: [&str; 3] = ["generated/", "photo/", "photo-thumb/"];

/// Maps a request path to a protocol path. Err(403) for '..', '.', empty segments, backslashes, drive letters, absolute or UNC
/// paths and control characters, before or after percent-decoding.
pub fn resolve(app: &Path, url_path: &str) -> Result<Resolved, u16> {
    let raw = url_path.strip_prefix('/').ok_or(403u16)?;
    let decoded = percent_decode_str(raw).decode_utf8().map_err(|_| 403u16)?;
    let rel: &str = if decoded.is_empty() { "index.html" } else { &decoded };
    let bad_char = |c: char| c == '\\' || c == ':' || c.is_control();
    if rel.starts_with('/') || rel.chars().any(bad_char) || rel.split('/').any(|s| s.is_empty() || s == "." || s == "..") {
        return Err(403);
    }
    let file = if DATA_ROUTES.iter().any(|r| rel.starts_with(r)) {
        None
    } else {
        Some(rel.split('/').fold(app.to_path_buf(), |p, s| p.join(s)))
    };
    Ok(Resolved { rel: rel.to_string(), file })
}

/// Whether a file the core named may be served: exactly the expected app file, or a file inside the data folder.
pub fn allowed_file(resolved: &Resolved, file: &Path, data: &Path) -> bool {
    let Ok(real) = std::fs::canonicalize(file) else { return false };
    match &resolved.file {
        Some(expected) => std::fs::canonicalize(expected).map(|e| e == real).unwrap_or(false),
        None => std::fs::canonicalize(data).map(|d| real.starts_with(d)).unwrap_or(false),
    }
}

// index.html's CSP has connect-src 'none'. Tauri's IPC is a fetch to its ipc: scheme (http://ipc.localhost on Windows), so that
// one origin is added, as Tauri does for its own pages; nothing else in the policy changes. The file on disk stays unchanged.
const CSP_CONNECT: &str = "connect-src 'none'";
const CSP_CONNECT_TAURI: &str = "connect-src ipc: http://ipc.localhost";

pub fn with_ipc_csp(html: String) -> String {
    html.replacen(CSP_CONNECT, CSP_CONNECT_TAURI, 1)
}

fn status(code: u16) -> Response<Vec<u8>> {
    Response::builder().status(code).header("content-type", "text/plain; charset=utf-8").body(Vec::new()).unwrap()
}

/// Answers one request. `allowed` is false for other webviews and non-GET methods.
pub async fn serve(core: &Core, app: &Path, data: &Path, allowed: bool, url_path: &str) -> Response<Vec<u8>> {
    if !allowed {
        return status(403);
    }
    let resolved = match resolve(app, url_path) {
        Ok(r) => r,
        Err(code) => return status(code),
    };
    // WebView2 asks for /favicon.ico on its own (Electron does not); answer with the app icon instead of a logged 404.
    if resolved.rel == "favicon.ico" {
        return match tokio::fs::read(app.join("lumen.ico")).await {
            Ok(bytes) => Response::builder().status(200).header("content-type", "image/x-icon").body(bytes).unwrap(),
            Err(_) => status(404),
        };
    }
    let reply = match core.asset(format!("/{}", resolved.rel)).await {
        Ok(r) => r,
        Err(_) => return status(503),
    };
    let body = if let Some(body) = reply.body {
        if resolved.rel == "index.html" { with_ipc_csp(body) } else { body }.into_bytes()
    } else if let Some(file) = reply.file_path.as_deref() {
        if !allowed_file(&resolved, Path::new(file), data) {
            eprintln!("[protocol] refused a file outside its root: {}", resolved.rel);
            return status(403);
        }
        match tokio::fs::read(file).await {
            Ok(bytes) => bytes,
            Err(_) => return status(404),
        }
    } else {
        Vec::new()
    };
    let mut response = Response::builder().status(StatusCode::from_u16(reply.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR));
    for (name, value) in &reply.headers {
        if let Some(v) = value.as_str() {
            response = response.header(name.as_str(), v);
        }
    }
    response.body(body).unwrap_or_else(|_| status(500))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> PathBuf {
        PathBuf::from("app")
    }

    #[test]
    fn traversal_is_forbidden() {
        for p in ["/..%2findex.html", "/..%2f..%2fsecret", "/../core.lock", "/a/../index.html", "/%2e%2e/x", "/..%5cx", "/photo/..%2f..%2fx.png"] {
            assert_eq!(resolve(&app(), p), Err(403), "{p}");
        }
    }

    #[test]
    fn absolute_and_drive_paths_are_forbidden() {
        for p in ["/C:/Windows/win.ini", "/C:%5cWindows", "/c:", "//server/share", "/%2fetc", "/\\\\?\\C:\\x", "/%5c%5c%3f%5cC:%5cx", "/a\\b", "/x%00.js"] {
            assert_eq!(resolve(&app(), p), Err(403), "{p}");
        }
    }

    #[test]
    fn app_files_resolve_under_app() {
        assert_eq!(resolve(&app(), "/index.html"), Ok(Resolved { rel: "index.html".into(), file: Some(PathBuf::from("app/index.html")) }));
        assert_eq!(resolve(&app(), "/"), Ok(Resolved { rel: "index.html".into(), file: Some(PathBuf::from("app/index.html")) }));
        assert_eq!(resolve(&app(), "/vendor/katex.min.css"), Ok(Resolved { rel: "vendor/katex.min.css".into(), file: Some(PathBuf::from("app").join("vendor").join("katex.min.css")) }));
    }

    #[test]
    fn data_routes_come_from_the_core() {
        let sha = "a".repeat(64);
        for p in [format!("/photo/{sha}.png"), format!("/photo-thumb/{sha}.png"), format!("/generated/{sha}.thumb.png")] {
            let r = resolve(&app(), &p).unwrap();
            assert_eq!(r.rel, p[1..]);
            assert_eq!(r.file, None);
        }
    }

    #[test]
    fn csp_gains_only_the_ipc_origin() {
        let real = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/index.html")).unwrap();
        let out = with_ipc_csp(real.clone());
        let csp = |s: &str| s.split("Content-Security-Policy\" content=\"").nth(1).unwrap().split('"').next().unwrap().to_string();
        assert_eq!(csp(&out), csp(&real).replace("connect-src 'none'", "connect-src ipc: http://ipc.localhost"));
        assert!(csp(&out).contains("script-src 'self'") && csp(&out).contains("default-src 'self'"));
        assert_eq!(out.len(), real.len() - "'none'".len() + "ipc: http://ipc.localhost".len());
    }

    #[test]
    fn files_named_by_the_core_must_lie_in_their_root() {
        let root = std::env::temp_dir().join(format!("lumen-protocol-test-{}", std::process::id()));
        let (app, data, other) = (root.join("app"), root.join("data"), root.join("other"));
        for d in [&app, &data.join("images"), &other] {
            std::fs::create_dir_all(d).unwrap();
        }
        for f in [app.join("index.html"), app.join("style.css"), data.join("images").join("p.png"), other.join("x.png")] {
            std::fs::write(f, b"x").unwrap();
        }
        let index = resolve(&app, "/index.html").unwrap();
        assert!(allowed_file(&index, &app.join("index.html"), &data));
        assert!(!allowed_file(&index, &app.join("style.css"), &data));
        let photo = resolve(&app, &format!("/photo/{}.png", "b".repeat(64))).unwrap();
        assert!(allowed_file(&photo, &data.join("images").join("p.png"), &data));
        assert!(!allowed_file(&photo, &other.join("x.png"), &data));
        assert!(!allowed_file(&photo, &data.join("images").join("..").join("..").join("other").join("x.png"), &data));
        let _ = std::fs::remove_dir_all(root);
    }
}
