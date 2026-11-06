// platform.openExternal: the default browser, through tauri-plugin-opener's Rust function (the plugin is not registered, so no
// JavaScript can reach it). Only https addresses without embedded credentials are opened (spec 5.4); the core already checks
// the address (browser.cjs normalize/checkUrl, the Hugging Face model page) and this is the shell's own last check.
use serde_json::Value;

pub fn check(url: &str) -> Result<String, String> {
    let blocked = || "Only https addresses are opened in the browser.".to_string();
    if url.len() > 4096 || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(blocked());
    }
    let rest = url.get(..8).filter(|p| p.eq_ignore_ascii_case("https://")).map(|_| &url[8..]).ok_or_else(blocked)?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') || authority.contains('\\') {
        return Err(blocked());
    }
    Ok(url.to_string())
}

pub fn open(url: &str) -> Result<Value, String> {
    let url = check(url)?;
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| format!("The browser could not be opened: {e}"))?;
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_without_credentials() {
        assert!(check("https://huggingface.co/google/gemma-4").is_ok());
        assert!(check("HTTPS://example.com/a?b=c#d").is_ok());
        for bad in ["http://example.com", "file:///C:/Windows/notepad.exe", "javascript:alert(1)", "ms-settings:", "https://user:pw@example.com/",
            "https://", "https:///path", "https://exa mple.com", "https://a.com\n", "https:\\\\evil.com", "https://a\\b.com", "C:\\Windows\\notepad.exe"] {
            assert!(check(bad).is_err(), "{bad}");
        }
    }
}
