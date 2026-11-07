// platform.dialog with rfd (the native Windows dialogs), called from Rust only. tauri-plugin-dialog is deliberately not used: it
// injects an init script into every webview that replaces window.alert/confirm (confirm would become an async, always-truthy
// function in the untrusted browser panel). Inputs and answers
// are Electron's (the core passes Electron's options and reads Electron's results):
//   open({title, defaultPath, properties:[openFile|openDirectory|multiSelections|...], filters:[{name, extensions}]}) -> {canceled, filePaths}
//   save({title, defaultPath, filters}) -> {canceled, filePath}
//   message({type, title, message, detail, buttons, defaultId, cancelId}) -> {response, checkboxChecked}
// Message boxes are Windows task dialogs with the core's (Turkish or English) button texts, in the core's order; the first button
// is the default, which is the core's defaultId (0, "Cancel") in every caller. Esc or closing the box answers cancelId, as in Electron.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use rfd::{FileDialog, MessageButtons as MessageDialogButtons, MessageDialog, MessageDialogResult, MessageLevel};
use tauri::{AppHandle, Manager};

#[derive(Debug, PartialEq, Default)]
pub struct FileRequest {
    pub title: Option<String>,
    pub directory: Option<PathBuf>,
    pub file_name: Option<String>,
    pub filters: Vec<(String, Vec<String>)>,
    pub folder: bool,
    pub multiple: bool,
}

fn text(o: &Value, key: &str) -> Option<String> {
    o.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Electron's dialog options -> what the native dialog needs. defaultPath is a folder (open) or a file name / full path (save).
pub fn file_request(o: &Value, save: bool) -> FileRequest {
    let properties: Vec<&str> = o.get("properties").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let filters = o
        .get("filters")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|f| {
                    let name = f.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                    let ext: Vec<String> = f.get("extensions")?.as_array()?.iter().filter_map(Value::as_str).map(str::to_string).collect();
                    (!ext.is_empty()).then_some((name, ext))
                })
                .collect()
        })
        .unwrap_or_default();
    let (mut directory, mut file_name) = (None, None);
    if let Some(default) = text(o, "defaultPath") {
        let p = PathBuf::from(&default);
        if save {
            file_name = p.file_name().map(|n| n.to_string_lossy().to_string());
            directory = p.parent().filter(|d| !d.as_os_str().is_empty()).map(Path::to_path_buf);
        } else if p.is_dir() {
            directory = Some(p);
        } else {
            directory = p.parent().filter(|d| !d.as_os_str().is_empty()).map(Path::to_path_buf);
        }
    }
    FileRequest {
        title: text(o, "title"),
        directory,
        file_name,
        filters,
        folder: !save && properties.contains(&"openDirectory"),
        multiple: !save && properties.contains(&"multiSelections"),
    }
}

/// Buttons in the core's order, and how the dialog's answer maps back to Electron's `response` index.
pub fn message_buttons(o: &Value) -> (MessageDialogButtons, Vec<String>, u64) {
    let labels: Vec<String> = o.get("buttons").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    let cancel_id = o.get("cancelId").and_then(Value::as_u64).unwrap_or(0);
    let buttons = match labels.as_slice() {
        [] => MessageDialogButtons::Ok,
        [a] => MessageDialogButtons::OkCustom(a.clone()),
        [a, b] => MessageDialogButtons::OkCancelCustom(a.clone(), b.clone()),
        [a, b, c, ..] => MessageDialogButtons::YesNoCancelCustom(a.clone(), b.clone(), c.clone()),
    };
    (buttons, labels, cancel_id)
}

pub fn response(result: &MessageDialogResult, labels: &[String], cancel_id: u64) -> u64 {
    match result {
        MessageDialogResult::Custom(label) => labels.iter().position(|l| l == label).map(|i| i as u64).unwrap_or(cancel_id),
        MessageDialogResult::Ok | MessageDialogResult::Yes if labels.is_empty() => 0,
        _ => cancel_id,
    }
}

fn level(o: &Value) -> MessageLevel {
    match o.get("type").and_then(Value::as_str) {
        Some("warning") => MessageLevel::Warning,
        Some("error") => MessageLevel::Error,
        _ => MessageLevel::Info,
    }
}

/// The main window owns the dialog (modal to it), as `dialog.showOpenDialog(win, ...)` in Electron. Looked up as a Window: with
/// the browser panel in it, Tauri no longer reports it as a WebviewWindow.
fn main_window(app: &AppHandle) -> Option<tauri::Window> {
    app.get_window(crate::window::MAIN)
}

fn builder(app: &AppHandle, r: &FileRequest) -> FileDialog {
    let mut b = FileDialog::new();
    if let Some(w) = main_window(app) {
        b = b.set_parent(&w);
    }
    if let Some(t) = &r.title {
        b = b.set_title(t);
    }
    if let Some(d) = &r.directory {
        b = b.set_directory(d);
    }
    if let Some(n) = &r.file_name {
        b = b.set_file_name(n);
    }
    for (name, ext) in &r.filters {
        b = b.add_filter(name, ext);
    }
    b
}

fn text_of(p: PathBuf) -> String {
    p.to_string_lossy().to_string()
}

/// Blocking: call from a blocking thread, never the main thread.
pub fn open(app: &AppHandle, options: &Value) -> Result<Value, String> {
    let r = file_request(options, false);
    let b = builder(app, &r);
    let picked: Vec<String> = match (r.folder, r.multiple) {
        (true, true) => b.pick_folders().unwrap_or_default().into_iter().map(text_of).collect(),
        (true, false) => b.pick_folder().map(text_of).into_iter().collect(),
        (false, true) => b.pick_files().unwrap_or_default().into_iter().map(text_of).collect(),
        (false, false) => b.pick_file().map(text_of).into_iter().collect(),
    };
    Ok(json!({"canceled": picked.is_empty(), "filePaths": picked}))
}

pub fn save(app: &AppHandle, options: &Value) -> Result<Value, String> {
    let r = file_request(options, true);
    match builder(app, &r).save_file().map(text_of) {
        Some(path) => Ok(json!({"canceled": false, "filePath": path})),
        None => Ok(json!({"canceled": true, "filePath": ""})),
    }
}

pub fn message(app: &AppHandle, options: &Value) -> Result<Value, String> {
    let (buttons, labels, cancel_id) = message_buttons(options);
    // Electron shows `message` as the heading and `detail` below it; the task dialog has one text.
    let body = match (text(options, "message"), text(options, "detail")) {
        (Some(m), Some(d)) => format!("{m}

{}", d.trim_end()),
        (Some(m), None) => m,
        (None, Some(d)) => d,
        (None, None) => String::new(),
    };
    // Without a title Electron shows the app name.
    let mut b = MessageDialog::new().set_level(level(options)).set_title(text(options, "title").unwrap_or_else(|| "lumen.cpp".into())).set_description(body).set_buttons(buttons);
    if let Some(w) = main_window(app) {
        b = b.set_parent(&w);
    }
    let result = b.show();
    Ok(json!({"response": response(&result, &labels, cancel_id), "checkboxChecked": false}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_options_from_the_core() {
        let r = file_request(&json!({"title": "Belge ekle", "properties": ["openFile", "multiSelections"], "filters": [{"name": "Belgeler", "extensions": ["pdf", "docx"]}]}), false);
        assert_eq!(r, FileRequest { title: Some("Belge ekle".into()), filters: vec![("Belgeler".into(), vec!["pdf".into(), "docx".into()])], multiple: true, ..Default::default() });
        let r = file_request(&json!({"properties": ["openDirectory"]}), false);
        assert!(r.folder && !r.multiple);
        let here = std::env::temp_dir();
        let r = file_request(&json!({"defaultPath": here.to_string_lossy(), "properties": ["openFile", "dontAddToRecent"]}), false);
        assert_eq!(r.directory, Some(here));
        assert!(!r.folder);
    }

    #[test]
    fn save_options_from_the_core() {
        let r = file_request(&json!({"defaultPath": "lumen-chat.md", "filters": [{"name": "Markdown", "extensions": ["md"]}]}), true);
        assert_eq!(r.file_name.as_deref(), Some("lumen-chat.md"));
        assert_eq!(r.directory, None);
        let r = file_request(&json!({"defaultPath": "C:\\Users\\x\\Şubat\\SKILL.md"}), true);
        assert_eq!(r.file_name.as_deref(), Some("SKILL.md"));
        assert_eq!(r.directory, Some(PathBuf::from("C:\\Users\\x\\Şubat")));
    }

    #[test]
    fn message_answers_use_electron_indexes() {
        let o = json!({"type": "warning", "message": "Bu sohbet silinsin mi?", "buttons": ["Vazgeç", "Sil"], "defaultId": 0, "cancelId": 0});
        let (buttons, labels, cancel) = message_buttons(&o);
        assert!(matches!(&buttons, MessageDialogButtons::OkCancelCustom(a, b) if a == "Vazgeç" && b == "Sil"));
        assert_eq!(response(&MessageDialogResult::Custom("Sil".into()), &labels, cancel), 1);
        assert_eq!(response(&MessageDialogResult::Custom("Vazgeç".into()), &labels, cancel), 0);
        // Esc / closing the box
        assert_eq!(response(&MessageDialogResult::Cancel, &labels, cancel), 0);
        let (buttons, labels, cancel) = message_buttons(&json!({"message": "Done"}));
        assert!(matches!(buttons, MessageDialogButtons::Ok));
        assert_eq!(response(&MessageDialogResult::Ok, &labels, cancel), 0);
    }
}
