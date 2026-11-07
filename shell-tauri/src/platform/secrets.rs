// platform.secrets in Electron's safeStorage format (Chromium os_crypt on Windows), read AND written, so keys saved by one shell
// open in the other (spec §7). The 32-byte AES key lives in <Electron userData>/Local State as
//   os_crypt.encrypted_key = base64("DPAPI" + CryptProtectData(key))        (current user scope)
// and every value is  "v10" + 12-byte nonce + AES-256-GCM(ciphertext + 16-byte tag), stored by the core as base64.
// Values without the "v10" prefix are legacy DPAPI blobs; Chromium decrypts those with DPAPI alone, and so does this module.
// A missing Local State (or one without os_crypt.encrypted_key) gets a new random key in the same format, written as Chromium
// writes it (DPAPI description "Chromium", CRYPTPROTECT_AUDIT, os_crypt.audit_enabled = true): without audit_enabled Chromium
// re-wraps the same key on its next start, which is harmless but rewrites the file. An existing key that
// cannot be read is never replaced: that would make every saved secret unreadable. Keys and plaintext are never logged.
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use zeroize::Zeroizing;

/// The AES key, wiped from memory when dropped.
type Key = Zeroizing<[u8; 32]>;

const DPAPI_PREFIX: &[u8] = b"DPAPI";
const V10: &[u8] = b"v10";
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

pub struct Secrets {
    local_state: PathBuf,
    key: Mutex<Option<Key>>,
}

impl Secrets {
    /// `user_data`: Electron's userData folder (%APPDATA%\lumen.cpp; tests: the Electron profile of the test).
    pub fn new(user_data: &Path) -> Secrets {
        Secrets { local_state: user_data.join("Local State"), key: Mutex::new(None) }
    }

    fn key(&self) -> Result<Key, String> {
        let mut cached = self.key.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(k) = cached.as_ref() {
            return Ok(k.clone());
        }
        let k = load_or_create(&self.local_state)?;
        *cached = Some(k.clone());
        Ok(k)
    }

    pub fn available(&self) -> bool {
        self.key().is_ok()
    }

    /// text -> base64("v10" + nonce + ciphertext + tag)
    pub fn encrypt(&self, text: &str) -> Result<String, String> {
        let key = self.key()?;
        let mut nonce = [0u8; NONCE_LEN];
        getrandom::fill(&mut nonce).map_err(|_| "Secure storage could not create a nonce.".to_string())?;
        let cipher = Aes256Gcm::new_from_slice(&key[..]).map_err(|_| "Encryption failed.".to_string())?;
        let sealed = cipher.encrypt(Nonce::from_slice(&nonce), text.as_bytes()).map_err(|_| "Encryption failed.".to_string())?;
        let mut out = Vec::with_capacity(V10.len() + NONCE_LEN + sealed.len());
        out.extend_from_slice(V10);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        Ok(B64.encode(out))
    }

    /// base64 (as stored by the core) -> text
    pub fn decrypt(&self, value: &str) -> Result<String, String> {
        let bytes = B64.decode(value.trim()).map_err(|_| "Error while decrypting the ciphertext provided to safeStorage.decryptString.".to_string())?;
        let plain: Zeroizing<Vec<u8>> = Zeroizing::new(if let Some(rest) = bytes.strip_prefix(V10) {
            if rest.len() < NONCE_LEN + TAG_LEN {
                return Err("Error while decrypting the ciphertext provided to safeStorage.decryptString.".into());
            }
            let key = self.key()?;
            let (nonce, sealed) = rest.split_at(NONCE_LEN);
            Aes256Gcm::new_from_slice(&key[..])
                .map_err(|_| "Error while decrypting the ciphertext provided to safeStorage.decryptString.".to_string())?
                .decrypt(Nonce::from_slice(nonce), sealed)
                .map_err(|_| "Error while decrypting the ciphertext provided to safeStorage.decryptString.".to_string())?
        } else {
            dpapi::unprotect(&bytes).map_err(|_| "Error while decrypting the ciphertext provided to safeStorage.decryptString.".to_string())?
        });
        String::from_utf8(plain.to_vec()).map_err(|_| "The decrypted value is not text.".to_string())
    }
}

fn read_state(file: &Path) -> Result<Option<Value>, String> {
    match std::fs::read(file) {
        Ok(bytes) => {
            let json = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes);
            serde_json::from_slice::<Value>(json).map(Some).map_err(|_| "Local State is not valid JSON; it is left unchanged.".to_string())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Local State could not be read.".into()),
    }
}

/// Key from `encrypted_key` (base64 of "DPAPI" + DPAPI blob).
fn key_from(encrypted_key: &str) -> Result<Key, String> {
    let blob = B64.decode(encrypted_key).map_err(|_| "os_crypt.encrypted_key is not base64.".to_string())?;
    let protected = blob.strip_prefix(DPAPI_PREFIX).ok_or_else(|| "os_crypt.encrypted_key has no DPAPI prefix.".to_string())?;
    let key = Zeroizing::new(dpapi::unprotect(protected).map_err(|_| "os_crypt.encrypted_key could not be opened for this Windows user.".to_string())?);
    if key.len() != 32 {
        return Err("os_crypt.encrypted_key is not a 32-byte key.".into());
    }
    let mut out: Key = Zeroizing::new([0u8; 32]);
    out.copy_from_slice(&key);
    Ok(out)
}

fn load_or_create(file: &Path) -> Result<Key, String> {
    let state = read_state(file)?;
    if let Some(existing) = state.as_ref().and_then(|s| s["os_crypt"]["encrypted_key"].as_str()) {
        return key_from(existing);
    }
    // No key yet: create one in Chromium's format, keeping every other Local State field.
    let mut key: Key = Zeroizing::new([0u8; 32]);
    getrandom::fill(&mut key[..]).map_err(|_| "Secure storage could not create a key.".to_string())?;
    let mut blob = DPAPI_PREFIX.to_vec();
    blob.extend_from_slice(&dpapi::protect_key(&key[..]).map_err(|_| "Windows data protection (DPAPI) is unavailable.".to_string())?);
    let mut state = state.unwrap_or_else(|| json!({}));
    if !state.is_object() {
        return Err("Local State is not a JSON object; it is left unchanged.".into());
    }
    if !state["os_crypt"].is_object() {
        state["os_crypt"] = json!({});
    }
    state["os_crypt"]["encrypted_key"] = Value::String(B64.encode(blob));
    state["os_crypt"]["audit_enabled"] = Value::Bool(true);
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|_| "The Local State folder could not be created.".to_string())?;
    }
    let temp = file.with_file_name(format!("Local State.{}.tmp", std::process::id()));
    std::fs::write(&temp, serde_json::to_vec(&state).map_err(|e| e.to_string())?).map_err(|_| "Local State could not be written.".to_string())?;
    std::fs::rename(&temp, file).map_err(|_| {
        let _ = std::fs::remove_file(&temp);
        "Local State could not be written.".to_string()
    })?;
    Ok(key)
}

#[cfg(windows)]
mod dpapi {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_AUDIT, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        // SAFETY: on success the API returns a LocalAlloc'd buffer of cbData bytes, freed here exactly once.
        unsafe {
            let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            LocalFree(Some(HLOCAL(out.pbData as _)));
            bytes
        }
    }

    fn protect_with(data: &[u8], description: windows::core::PCWSTR, flags: u32) -> windows::core::Result<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: input points to `data`, which outlives the call; out is written by the API.
        unsafe { CryptProtectData(&input, description, None, None, None, flags, &mut out)? };
        Ok(take(out))
    }

    /// The os_crypt key, protected as Chromium protects it.
    pub fn protect_key(key: &[u8]) -> windows::core::Result<Vec<u8>> {
        protect_with(key, windows::core::w!("Chromium"), CRYPTPROTECT_AUDIT)
    }

    /// A plain DPAPI blob (legacy values without "v10").
    #[cfg(test)]
    pub fn protect(data: &[u8]) -> windows::core::Result<Vec<u8>> {
        protect_with(data, windows::core::w!(""), CRYPTPROTECT_UI_FORBIDDEN)
    }

    pub fn unprotect(data: &[u8]) -> windows::core::Result<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: as in protect.
        unsafe { CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)? };
        Ok(take(out))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A fresh folder under the system temp folder (removed by the caller).
    pub fn temp_dir(name: &str) -> PathBuf {
        let mut n = [0u8; 8];
        getrandom::fill(&mut n).unwrap();
        let dir = std::env::temp_dir().join(format!("lumen-{name}-{}", n.iter().map(|b| format!("{b:02x}")).collect::<String>()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn secrets_roundtrip() {
        let dir = temp_dir("secrets");
        let s = Secrets::new(&dir);
        assert!(s.available());
        let text = "tvly-roundtrip-Şubat-ığüşöç-😀";
        let stored = s.encrypt(text).unwrap();
        let raw = B64.decode(&stored).unwrap();
        assert_eq!(&raw[..3], b"v10");
        assert_eq!(raw.len(), 3 + 12 + text.len() + 16);
        assert_eq!(s.decrypt(&stored).unwrap(), text);
        // Local State in Chromium's format, and a new instance (new process) reads the same key.
        let state: Value = serde_json::from_slice(&std::fs::read(dir.join("Local State")).unwrap()).unwrap();
        let blob = B64.decode(state["os_crypt"]["encrypted_key"].as_str().unwrap()).unwrap();
        assert_eq!(&blob[..5], b"DPAPI");
        assert_eq!(state["os_crypt"]["audit_enabled"], true);
        assert_eq!(Secrets::new(&dir).decrypt(&stored).unwrap(), text);
        assert_ne!(s.encrypt(text).unwrap(), stored, "a fresh nonce per value");
        assert!(s.decrypt(&B64.encode(b"v10short")).is_err());
        let mut tampered = raw.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(s.decrypt(&B64.encode(tampered)).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_other_local_state_fields_and_never_replaces_a_key() {
        let dir = temp_dir("state");
        std::fs::write(dir.join("Local State"), r#"{"uninstall_metrics":{"x":1},"os_crypt":{"audit_enabled":true}}"#).unwrap();
        assert!(Secrets::new(&dir).available());
        let state: Value = serde_json::from_slice(&std::fs::read(dir.join("Local State")).unwrap()).unwrap();
        assert_eq!(state["uninstall_metrics"]["x"], 1);
        assert_eq!(state["os_crypt"]["audit_enabled"], true);
        assert!(state["os_crypt"]["encrypted_key"].is_string());
        // A key that cannot be opened is an error, and the file stays as it was.
        let broken = r#"{"os_crypt":{"encrypted_key":"RFBBUElub3QtYS1ibG9i"}}"#;
        std::fs::write(dir.join("Local State"), broken).unwrap();
        let s = Secrets::new(&dir);
        assert!(!s.available());
        assert!(s.encrypt("x").is_err());
        assert_eq!(std::fs::read_to_string(dir.join("Local State")).unwrap(), broken);
        std::fs::write(dir.join("Local State"), "not json").unwrap();
        assert!(!Secrets::new(&dir).available());
        assert_eq!(std::fs::read_to_string(dir.join("Local State")).unwrap(), "not json");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn local_state_is_parsed_from_bytes() {
        let dir = temp_dir("bom");
        let stored = Secrets::new(&dir).encrypt("bom").unwrap();
        let file = dir.join("Local State");
        let mut bytes = vec![0xef, 0xbb, 0xbf];
        bytes.extend(std::fs::read(&file).unwrap());
        std::fs::write(&file, &bytes).unwrap();
        assert_eq!(Secrets::new(&dir).decrypt(&stored).unwrap(), "bom", "a UTF-8 BOM is skipped");
        // Invalid UTF-8 is not "repaired" into JSON: an error, and the file stays as it was.
        let broken = [b"{\"os_crypt\":{\"encrypted_key\":\"".as_slice(), &[0xff, 0xfe], b"\"}}"].concat();
        std::fs::write(&file, &broken).unwrap();
        assert!(!Secrets::new(&dir).available());
        assert_eq!(std::fs::read(&file).unwrap(), broken);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_dpapi_values_decrypt() {
        let dir = temp_dir("legacy");
        let blob = dpapi::protect("legacy-value".as_bytes()).unwrap();
        assert_eq!(Secrets::new(&dir).decrypt(&B64.encode(blob)).unwrap(), "legacy-value");
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn work_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("work")
    }

    /// Node for the fixture script: the pinned node.exe of the build, else `node` on PATH.
    fn node() -> PathBuf {
        let pinned = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join("node-x86_64-pc-windows-msvc.exe");
        if pinned.exists() { pinned } else { PathBuf::from("node") }
    }

    /// A value encrypted by Electron's own safeStorage (tests/fixtures/electron-secret.mjs, run here when missing).
    #[test]
    fn decrypts_electron_fixture() {
        let fixture = work_root().join("secret-fixture").join("fixture.json");
        if !fixture.exists() {
            let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("tests").join("fixtures").join("electron-secret.mjs");
            let status = std::process::Command::new(node()).arg(script).stdout(std::process::Stdio::null()).status().expect("run the Electron fixture");
            assert!(status.success(), "tests/fixtures/electron-secret.mjs failed");
        }
        let f: Value = serde_json::from_slice(&std::fs::read(&fixture).unwrap()).unwrap();
        let s = Secrets::new(Path::new(f["userData"].as_str().unwrap()));
        assert!(s.available());
        assert_eq!(s.decrypt(f["encrypted"].as_str().unwrap()).unwrap(), f["plaintext"].as_str().unwrap());
    }

    /// The reverse direction: Electron's safeStorage opens a value this module wrote with Electron's key.
    #[test]
    fn electron_decrypts_our_value() {
        let fixture = work_root().join("secret-fixture").join("fixture.json");
        if !fixture.exists() {
            decrypts_electron_fixture();
        }
        let f: Value = serde_json::from_slice(&std::fs::read(&fixture).unwrap()).unwrap();
        let user_data = f["userData"].as_str().unwrap();
        let text = "tauri-wrote-this-ŞĞÜ-😀";
        let stored = Secrets::new(Path::new(user_data)).encrypt(text).unwrap();
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("tests").join("fixtures").join("electron-secret.mjs");
        let out = std::process::Command::new(node()).arg(script).arg("decrypt").arg(&stored).arg(format!("--user-data-dir={user_data}")).output().expect("run the Electron fixture");
        let answer: Value = serde_json::from_slice(&out.stdout).expect("fixture answer");
        assert_eq!(answer["value"].as_str(), Some(text), "Electron could not decrypt: {}", answer["error"]);
    }
}
