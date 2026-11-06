// Platform requests of the core (app/platform.cjs) that the Tauri shell answers, with the same inputs and outputs as Electron's
// shell (app/shell-electron.cjs). Task 6 adds dialogs, clipboard, images, secrets and openExternal; the browser panel (Task 9)
// and the preview window (Task 7) are still refused with NOT_IMPLEMENTED (ruling T5-a).
pub mod clipboard;
pub mod dialog;
pub mod image;
pub mod opener;
pub mod secrets;

use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const NOT_IMPLEMENTED: &str = "not implemented in Tauri shell yet";

/// `n` random bytes as hex (file names under <data>/temp).
pub fn random_hex(n: usize) -> String {
    let mut bytes = vec![0u8; n];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// What a request runs as.
#[derive(Debug, PartialEq)]
pub enum Outcome {
    Answer(Result<Value, String>),
    /// Answer `null`, then start the exit sequence.
    Quit,
    /// Runs on a blocking thread (dialogs, clipboard, image files, DPAPI).
    Service(Service),
}

#[derive(Debug, PartialEq)]
pub enum Service {
    Window(String),
    DialogOpen(Value),
    DialogSave(Value),
    DialogMessage(Value),
    ClipboardWriteText(String),
    ClipboardWritePng(PathBuf),
    ClipboardRead,
    ImageDecodeWebp(PathBuf, PathBuf),
    ImageNormalize(PathBuf, PathBuf, Option<f64>, String),
    ImageThumbnail(PathBuf, PathBuf, f64, String),
    SecretsAvailable,
    SecretsEncrypt(String),
    SecretsDecrypt(String),
    OpenExternal(String),
}

fn arg_str(args: &[Value], i: usize) -> Option<&str> {
    args.get(i).and_then(Value::as_str)
}
fn arg_path(args: &[Value], i: usize) -> Result<PathBuf, String> {
    arg_str(args, i).filter(|s| !s.is_empty()).map(PathBuf::from).ok_or_else(|| "Invalid platform arguments.".to_string())
}
fn arg_obj(args: &[Value]) -> Value {
    args.first().filter(|v| v.is_object()).cloned().unwrap_or_else(|| Value::Object(Default::default()))
}

/// Validates the arguments of a request and says how it runs. Pure, so the routing is testable without a window.
pub fn route(method: &str, args: &[Value]) -> Outcome {
    let service = |s: Result<Service, String>| match s {
        Ok(s) => Outcome::Service(s),
        Err(e) => Outcome::Answer(Err(e)),
    };
    let text = |i: usize| arg_str(args, i).map(str::to_string).ok_or_else(|| "Invalid platform arguments.".to_string());
    match method {
        "windowAction" => match arg_str(args, 0) {
            Some(a @ ("minimize" | "maximize" | "close")) => Outcome::Service(Service::Window(a.to_string())),
            _ => Outcome::Answer(Err("Invalid window action.".into())),
        },
        "app.quit" => Outcome::Quit,
        // The updater keeps these test flags when it restarts Lumen; the Tauri build never installs updates (check-only).
        "app.relaunchArgs" => Outcome::Answer(Ok(Value::Array(vec![]))),
        "dialog.open" => Outcome::Service(Service::DialogOpen(arg_obj(args))),
        "dialog.save" => Outcome::Service(Service::DialogSave(arg_obj(args))),
        "dialog.message" => Outcome::Service(Service::DialogMessage(arg_obj(args))),
        "clipboard.writeText" => service(text(0).map(Service::ClipboardWriteText)),
        "clipboard.writePng" => service(arg_path(args, 0).map(Service::ClipboardWritePng)),
        "clipboard.read" => Outcome::Service(Service::ClipboardRead),
        "image.decodeWebp" => service(arg_path(args, 0).and_then(|i| Ok(Service::ImageDecodeWebp(i, arg_path(args, 1)?)))),
        "image.normalize" => service(arg_path(args, 0).and_then(|i| {
            let max = match args.get(2) {
                None | Some(Value::Null) => None,
                Some(v) => Some(v.as_f64().filter(|m| *m >= 1.0).ok_or("Invalid image size.")?),
            };
            Ok(Service::ImageNormalize(i, arg_path(args, 1)?, max, arg_str(args, 3).unwrap_or("best").to_string()))
        })),
        "image.thumbnail" => service(arg_path(args, 0).and_then(|i| {
            let max = args.get(2).and_then(Value::as_f64).filter(|m| *m >= 1.0).ok_or("Invalid image size.")?;
            Ok(Service::ImageThumbnail(i, arg_path(args, 1)?, max, arg_str(args, 3).unwrap_or("longest").to_string()))
        })),
        "secrets.available" => Outcome::Service(Service::SecretsAvailable),
        "secrets.encrypt" => service(text(0).map(Service::SecretsEncrypt)),
        "secrets.decrypt" => service(text(0).map(Service::SecretsDecrypt)),
        "openExternal" => service(text(0).map(Service::OpenExternal)),
        _ => Outcome::Answer(Err(NOT_IMPLEMENTED.into())),
    }
}

fn run(app: &AppHandle, service: Service) -> Result<Value, String> {
    let shell = app.state::<crate::Shell>();
    match service {
        Service::Window(action) => crate::window::action(app, &action).map(|_| Value::Null),
        Service::DialogOpen(o) => dialog::open(app, &o),
        Service::DialogSave(o) => dialog::save(app, &o),
        Service::DialogMessage(o) => dialog::message(app, &o),
        Service::ClipboardWriteText(t) => clipboard::write_text(&t),
        Service::ClipboardWritePng(p) => clipboard::write_png(&p),
        Service::ClipboardRead => clipboard::read(&shell.data),
        Service::ImageDecodeWebp(i, o) => image::decode_webp(&i, &o),
        Service::ImageNormalize(i, o, max, q) => image::normalize(&i, &o, max, &q),
        Service::ImageThumbnail(i, o, max, fit) => image::thumbnail(&i, &o, max, &fit),
        Service::SecretsAvailable => Ok(Value::Bool(shell.secrets.available())),
        Service::SecretsEncrypt(t) => shell.secrets.encrypt(&t).map(Value::String),
        Service::SecretsDecrypt(v) => shell.secrets.decrypt(&v).map(Value::String),
        Service::OpenExternal(url) => opener::open(&url),
    }
}

/// Runs a request; returns the answer for the core and whether to start the exit sequence.
pub async fn handle(app: &AppHandle, method: &str, args: &[Value]) -> (Result<Value, String>, bool) {
    match route(method, args) {
        Outcome::Quit => (Ok(Value::Null), true),
        Outcome::Answer(answer) => (answer, false),
        // Window actions are quick and must not wait behind a blocking thread.
        Outcome::Service(Service::Window(action)) => (crate::window::action(app, &action).map(|_| Value::Null), false),
        Outcome::Service(service) => {
            let app = app.clone();
            let answer = tauri::async_runtime::spawn_blocking(move || run(&app, service)).await.unwrap_or_else(|e| Err(format!("The platform service failed: {e}")));
            (answer, false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn routed(method: &str, args: Value) -> Outcome {
        route(method, args.as_array().unwrap())
    }

    #[test]
    fn routes_window_and_app_methods() {
        assert_eq!(routed("windowAction", json!(["minimize"])), Outcome::Service(Service::Window("minimize".into())));
        assert!(matches!(routed("windowAction", json!(["fullscreen"])), Outcome::Answer(Err(_))));
        assert_eq!(routed("app.quit", json!([])), Outcome::Quit);
        assert_eq!(routed("app.relaunchArgs", json!([])), Outcome::Answer(Ok(json!([]))));
    }

    #[test]
    fn routes_task6_services_with_rpc_arguments() {
        assert_eq!(routed("dialog.open", json!([{"title": "t"}])), Outcome::Service(Service::DialogOpen(json!({"title": "t"}))));
        assert_eq!(routed("dialog.save", json!([])), Outcome::Service(Service::DialogSave(json!({}))));
        assert_eq!(routed("clipboard.writeText", json!(["Şubat"])), Outcome::Service(Service::ClipboardWriteText("Şubat".into())));
        assert_eq!(routed("clipboard.writePng", json!(["C:\\d\\generated\\a.png"])), Outcome::Service(Service::ClipboardWritePng("C:\\d\\generated\\a.png".into())));
        assert_eq!(routed("clipboard.read", json!([])), Outcome::Service(Service::ClipboardRead));
        assert_eq!(routed("image.normalize", json!(["i", "o", null, "best"])), Outcome::Service(Service::ImageNormalize("i".into(), "o".into(), None, "best".into())));
        assert_eq!(routed("image.normalize", json!(["i", "o", 1600, "best"])), Outcome::Service(Service::ImageNormalize("i".into(), "o".into(), Some(1600.0), "best".into())));
        assert_eq!(routed("image.thumbnail", json!(["i", "o", 512, "width"])), Outcome::Service(Service::ImageThumbnail("i".into(), "o".into(), 512.0, "width".into())));
        assert_eq!(routed("image.decodeWebp", json!(["i", "o"])), Outcome::Service(Service::ImageDecodeWebp("i".into(), "o".into())));
        assert_eq!(routed("secrets.encrypt", json!(["k"])), Outcome::Service(Service::SecretsEncrypt("k".into())));
        assert_eq!(routed("secrets.decrypt", json!(["djEw"])), Outcome::Service(Service::SecretsDecrypt("djEw".into())));
        assert_eq!(routed("secrets.available", json!([])), Outcome::Service(Service::SecretsAvailable));
        assert_eq!(routed("openExternal", json!(["https://x.y"])), Outcome::Service(Service::OpenExternal("https://x.y".into())));
        for (m, a) in [("clipboard.writeText", json!([])), ("clipboard.writePng", json!([""])), ("image.thumbnail", json!(["i", "o", 0])), ("image.normalize", json!(["i", "o", "big"])), ("image.decodeWebp", json!(["i"])), ("secrets.encrypt", json!([1]))] {
            assert!(matches!(routed(m, a.clone()), Outcome::Answer(Err(_))), "{m} {a}");
        }
    }

    #[test]
    fn browser_and_artifact_wait_for_their_tasks() {
        for m in ["browser.render", "browser.create", "browser.onNavigate", "artifact.open", "artifact.close", "unknown"] {
            assert_eq!(routed(m, json!([])), Outcome::Answer(Err(NOT_IMPLEMENTED.to_string())), "{m}");
        }
    }
}
