// Platform requests of the core (app/platform.cjs) that the Tauri shell answers. Ruling T5-a: this task implements only window
// actions, app.quit/relaunchArgs and an interim secrets.available; dialogs, clipboard, images, secrets, openExternal, the
// browser panel and the preview window come in Tasks 6, 7 and 9 and are refused until then.
use serde_json::Value;
use tauri::AppHandle;

pub const NOT_IMPLEMENTED: &str = "not implemented in Tauri shell yet";

pub enum Outcome {
    Answer(Result<Value, String>),
    /// Answer `null`, then start the exit sequence.
    Quit,
}

pub fn route(method: &str, args: &[Value]) -> Outcome {
    match method {
        "windowAction" => Outcome::Answer(match args.first().and_then(Value::as_str) {
            Some(a @ ("minimize" | "maximize" | "close")) => Ok(Value::String(a.to_string())),
            _ => Err("Invalid window action.".into()),
        }),
        "app.quit" => Outcome::Quit,
        // The updater keeps these test flags when it restarts Lumen; the Tauri build never installs updates (check-only).
        "app.relaunchArgs" => Outcome::Answer(Ok(Value::Array(vec![]))),
        // Interim until Task 6 brings DPAPI: keys are not saved (the core's existing "encryption unavailable" path).
        "secrets.available" => Outcome::Answer(Ok(Value::Bool(false))),
        _ => Outcome::Answer(Err(NOT_IMPLEMENTED.into())),
    }
}

/// Runs a routed request; returns the answer for the core.
pub fn handle(app: &AppHandle, method: &str, args: &[Value]) -> (Result<Value, String>, bool) {
    match route(method, args) {
        Outcome::Quit => (Ok(Value::Null), true),
        Outcome::Answer(Ok(Value::String(action))) if method == "windowAction" => (crate::window::action(app, &action).map(|_| Value::Null), false),
        Outcome::Answer(answer) => (answer, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn answer(method: &str, args: Value) -> Result<Value, String> {
        match route(method, args.as_array().unwrap()) {
            Outcome::Answer(a) => a,
            Outcome::Quit => Ok(json!("quit")),
        }
    }

    #[test]
    fn routes_t5a_methods() {
        assert_eq!(answer("windowAction", json!(["minimize"])), Ok(json!("minimize")));
        assert!(answer("windowAction", json!(["fullscreen"])).is_err());
        assert_eq!(answer("app.quit", json!([])), Ok(json!("quit")));
        assert_eq!(answer("app.relaunchArgs", json!([])), Ok(json!([])));
        assert_eq!(answer("secrets.available", json!([])), Ok(json!(false)));
        for m in ["dialog.open", "clipboard.read", "image.normalize", "secrets.encrypt", "openExternal", "browser.render", "artifact.open"] {
            assert_eq!(answer(m, json!([])), Err(NOT_IMPLEMENTED.to_string()), "{m}");
        }
    }
}
