// The core process: `node.exe app/core-host.cjs`, one JSON object per line on stdin/stdout (protocol: app/core-host.cjs).
// The shell starts it inside a Job Object (KILL_ON_JOB_CLOSE: if lumen.exe dies, the core and everything it started die too),
// waits for `ready`, forwards calls, asset requests and platform answers, and restarts it once if it dies or does not start.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{oneshot, watch};

pub const LINE_LIMIT: usize = 64 * 1024 * 1024;
pub const READY_TIMEOUT: Duration = Duration::from_secs(20);
/// core-host caps the engine's shutdown at 4 s (STOP_CAP_MS) and releases core.lock before it exits, inside this grace period.
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
/// core-host's exit code when another running Lumen holds the data folder (core.lock): reported, never restarted.
pub const EXIT_LOCKED: i32 = 3;
/// After the restarted core has been ready this long, the one-restart budget is available again.
pub const RESTART_RESET: Duration = Duration::from_secs(60);
pub const ASSET_BASE: &str = "http://lumen.localhost/";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// A value that is present (even `null`) is Some; a left-out value (JavaScript `undefined`) is None.
fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}

/// One protocol line, in both directions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Frame {
    // shell -> core
    Call { id: String, channel: String, args: Vec<Value> },
    Shutdown,
    PlatformResult {
        id: String,
        ok: bool,
        #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")]
        value: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    PlatformEvent { name: String, payload: Value },
    Asset { id: String, path: String },
    // core -> shell
    Ready { channels: Vec<String> },
    Result {
        id: String,
        ok: bool,
        #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")]
        value: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Event {
        channel: String,
        #[serde(default)]
        payload: Value,
    },
    Platform {
        id: String,
        method: String,
        #[serde(default)]
        args: Vec<Value>,
    },
    AssetResult {
        id: String,
        status: u16,
        #[serde(default)]
        headers: Map<String, Value>,
        #[serde(rename = "filePath", default, skip_serializing_if = "Option::is_none")]
        file_path: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        body: Option<String>,
    },
    ProtocolError { reason: String },
}

pub fn encode(frame: &Frame) -> String {
    serde_json::to_string(frame).expect("frames always serialize")
}

pub fn decode(line: &str) -> Option<Frame> {
    serde_json::from_str(line).ok()
}

/// What the core asks of the shell.
pub enum Notice {
    Event { channel: String, payload: Value },
    /// `generation`: the core process that asked. The answer goes back with it (Core::answer), so it never reaches a later core.
    Platform { id: String, method: String, args: Vec<Value>, generation: u64 },
    /// The core died or did not start; `restarting` says whether one restart is under way. Sent before the restart begins.
    Fatal { timed_out: bool, restarting: bool },
    /// The core did not start because another running Lumen holds the data folder (core-host exit code 3). No restart.
    Locked,
}

#[derive(Debug)]
pub struct AssetReply {
    pub status: u16,
    pub headers: Map<String, Value>,
    pub file_path: Option<String>,
    pub body: Option<String>,
}

pub struct Config {
    pub node: PathBuf,
    pub script: PathBuf,
    pub data: PathBuf,
    pub app_root: PathBuf,
    pub ui_check: bool,
    pub log: PathBuf,
}

// A Windows Job Object that kills its processes when the last handle closes (the handle is held by this process).
struct Job(isize);
impl Job {
    fn for_child(child: &std::process::Child) -> std::io::Result<Job> {
        use std::os::windows::io::AsRawHandle;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(None, PCWSTR::null()).map_err(std::io::Error::other)?;
            let job = Job(handle.0 as isize);
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .map_err(std::io::Error::other)?;
            AssignProcessToJobObject(handle, HANDLE(child.as_raw_handle() as _)).map_err(std::io::Error::other)?;
            Ok(job)
        }
    }
    fn terminate(&self) {
        unsafe {
            let _ = windows::Win32::System::JobObjects::TerminateJobObject(windows::Win32::Foundation::HANDLE(self.0 as _), 1);
        }
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(windows::Win32::Foundation::HANDLE(self.0 as _));
        }
    }
}

type CallReply = Result<Option<Value>, String>;

#[derive(Default)]
struct Inner {
    generation: u64,
    job: Option<Arc<Job>>,
    restarts: u32,
    stopping: bool,
    timed_out: bool,
    seq: u64,
    channels: HashSet<String>,
    calls: HashMap<String, oneshot::Sender<CallReply>>,
    assets: HashMap<String, oneshot::Sender<AssetReply>>,
}

pub struct Core {
    cfg: Config,
    inner: Mutex<Inner>,
    stdin: Mutex<Option<Box<dyn Write + Send>>>,
    ready: watch::Sender<u64>,  // generation that is ready, 0 = none
    exited: watch::Sender<u64>, // last generation that exited
    notify: Box<dyn Fn(Notice) + Send + Sync>,
}

pub const GONE: &str = "Lumen's core stopped unexpectedly.";
pub const NOT_RUNNING: &str = "Lumen's core is not running.";
pub const TOO_LARGE: &str = "The request is too large.";

/// Every NODE_* variable (case-insensitive): what node.exe would honour on its own. The shell sets none of them.
pub fn node_vars(names: impl Iterator<Item = String>) -> Vec<String> {
    names.filter(|n| n.to_ascii_uppercase().starts_with("NODE_")).collect()
}

/// Whether an encoded line (without its '\n') stays within core-host's 64 MiB line limit.
pub fn fits(line: &str) -> bool {
    line.len() <= LINE_LIMIT
}

impl Core {
    pub fn new(cfg: Config, notify: Box<dyn Fn(Notice) + Send + Sync>) -> Arc<Core> {
        Arc::new(Core {
            cfg,
            inner: Mutex::new(Inner::default()),
            stdin: Mutex::new(None),
            ready: watch::channel(0).0,
            exited: watch::channel(0).0,
            notify,
        })
    }

    /// Starts a new core process (generation). Called once at startup and once more for the restart.
    pub fn spawn(self: &Arc<Self>) -> std::io::Result<()> {
        let cfg = &self.cfg;
        std::fs::create_dir_all(&cfg.data)?;
        let log = std::fs::OpenOptions::new().create(true).append(true).open(&cfg.log)?;
        let mut cmd = Command::new(&cfg.node);
        cmd.arg(&cfg.script)
            .arg("--data")
            .arg(&cfg.data)
            .arg("--app")
            .arg(&cfg.app_root)
            .args(["--asset-base", ASSET_BASE, "--update-mode", "check-only"]);
        // Test mode reaches the core only from a ui-check build (spec 6.5); production builds have no such code.
        #[cfg(feature = "ui-check")]
        if cfg.ui_check {
            cmd.arg("--ui-check");
        }
        // node.exe reads NODE_OPTIONS (--require, --inspect...), NODE_EXTRA_CA_CERTS, NODE_TLS_REJECT_UNAUTHORIZED, NODE_PATH and more
        // from the environment: none of the user's (or another program's) settings reaches the core. Test runs keep them.
        if !cfg.ui_check {
            for name in node_vars(std::env::vars_os().filter_map(|(k, _)| k.into_string().ok())) {
                cmd.env_remove(name);
            }
        }
        cmd.current_dir(&cfg.app_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(log))
            .creation_flags(CREATE_NO_WINDOW);
        let mut child = cmd.spawn()?;
        let job = match Job::for_child(&child) {
            Ok(job) => Arc::new(job),
            Err(e) => {
                let _ = child.kill();
                return Err(e);
            }
        };
        let stdout = child.stdout.take().expect("piped stdout");
        let generation = {
            let mut i = self.inner.lock().unwrap();
            i.generation += 1;
            i.job = Some(job.clone());
            i.timed_out = false;
            i.generation
        };
        *self.stdin.lock().unwrap() = child.stdin.take().map(|s| Box::new(s) as Box<dyn Write + Send>);
        self.ready.send_replace(0);

        let me = self.clone();
        std::thread::spawn(move || {
            me.read_loop(stdout, generation);
            let code = child.wait().ok().and_then(|s| s.code());
            me.on_exit(generation, code);
        });
        // `ready` must come within 20 s; otherwise the process is ended and treated like a crash.
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut rx = me.ready.subscribe();
            let ok = tokio::time::timeout(READY_TIMEOUT, rx.wait_for(|g| *g == generation)).await.is_ok();
            if !ok {
                let mut i = me.inner.lock().unwrap();
                if i.generation == generation && !i.stopping && *me.exited.borrow() < generation {
                    i.timed_out = true;
                    if let Some(job) = &i.job {
                        job.terminate();
                    }
                }
            }
        });
        Ok(())
    }

    fn read_loop(self: &Arc<Self>, stdout: impl Read, generation: u64) {
        let mut reader = BufReader::with_capacity(1 << 16, stdout);
        let mut line: Vec<u8> = Vec::new();
        let mut dropping = false;
        loop {
            let (consumed, done) = match reader.fill_buf() {
                Ok([]) | Err(_) => return,
                Ok(buf) => match buf.iter().position(|b| *b == b'\n') {
                    Some(n) => {
                        if !dropping {
                            line.extend_from_slice(&buf[..n]);
                        }
                        (n + 1, true)
                    }
                    None => {
                        if !dropping {
                            line.extend_from_slice(buf);
                        }
                        (buf.len(), false)
                    }
                },
            };
            reader.consume(consumed);
            if !dropping && line.len() > LINE_LIMIT {
                eprintln!("[core] dropped a line over 64 MiB");
                dropping = true;
                line = Vec::new();
            }
            if done {
                if !dropping {
                    let text = String::from_utf8_lossy(&line);
                    let text = text.trim_end_matches('\r');
                    if !text.trim().is_empty() {
                        match decode(text) {
                            Some(frame) => self.dispatch(frame, generation),
                            None => eprintln!("[core] unreadable line ({} bytes)", text.len()),
                        }
                    }
                }
                dropping = false;
                line.clear();
            }
        }
    }

    fn dispatch(self: &Arc<Self>, frame: Frame, generation: u64) {
        match frame {
            Frame::Ready { channels } => {
                let restarted = {
                    let mut i = self.inner.lock().unwrap();
                    i.channels = channels.into_iter().collect();
                    i.restarts > 0
                };
                self.ready.send_replace(generation);
                // A restarted core that stays up for a minute ends the crash burst: the next crash may restart it again.
                if restarted {
                    let me = self.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(RESTART_RESET).await;
                        let mut i = me.inner.lock().unwrap();
                        if i.generation == generation && *me.exited.borrow() < generation {
                            i.restarts = 0;
                        }
                    });
                }
            }
            Frame::Result { id, ok, value, error } => {
                if let Some(tx) = self.inner.lock().unwrap().calls.remove(&id) {
                    let _ = tx.send(if ok { Ok(value) } else { Err(error.unwrap_or_else(|| "The call failed.".into())) });
                }
            }
            Frame::AssetResult { id, status, headers, file_path, body } => {
                if let Some(tx) = self.inner.lock().unwrap().assets.remove(&id) {
                    let _ = tx.send(AssetReply { status, headers, file_path, body });
                }
            }
            Frame::Event { channel, payload } => (self.notify)(Notice::Event { channel, payload }),
            Frame::Platform { id, method, args } => (self.notify)(Notice::Platform { id, method, args, generation }),
            Frame::ProtocolError { reason } => eprintln!("[core] protocol error: {reason}"),
            _ => {}
        }
    }

    fn on_exit(self: &Arc<Self>, generation: u64, code: Option<i32>) {
        let locked = code == Some(EXIT_LOCKED);
        let (restart, timed_out) = {
            let mut i = self.inner.lock().unwrap();
            if i.generation != generation {
                return;
            }
            // Dropping the job ends whatever the core left behind (lumen-host, llama-server).
            if let Some(job) = i.job.take() {
                job.terminate();
            }
            for (_, tx) in i.calls.drain() {
                let _ = tx.send(Err(GONE.into()));
            }
            i.assets.clear();
            // A held data folder stays held: restarting would only fail again.
            let restart = !i.stopping && i.restarts == 0 && !locked;
            if restart {
                i.restarts += 1;
            }
            (if i.stopping { None } else { Some(restart) }, i.timed_out)
        };
        *self.stdin.lock().unwrap() = None;
        self.ready.send_replace(0);
        self.exited.send_replace(generation);
        let Some(restart) = restart else { return };
        if locked {
            return (self.notify)(Notice::Locked);
        }
        (self.notify)(Notice::Fatal { timed_out, restarting: restart });
        if restart {
            if let Err(e) = self.spawn() {
                eprintln!("[core] restart failed: {e}");
                (self.notify)(Notice::Fatal { timed_out: false, restarting: false });
            }
        }
    }

    fn write(&self, frame: &Frame) -> Result<(), String> {
        self.write_line(encode(frame))
    }

    fn write_line(&self, mut line: String) -> Result<(), String> {
        let mut guard = self.stdin.lock().unwrap();
        let stdin = guard.as_mut().ok_or_else(|| NOT_RUNNING.to_string())?;
        line.push('\n');
        stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()).map_err(|_| GONE.to_string())
    }

    /// Waits until a core generation is ready (at most `limit`).
    pub async fn wait_ready(&self, limit: Duration) -> Result<u64, String> {
        let mut rx = self.ready.subscribe();
        let result = match tokio::time::timeout(limit, rx.wait_for(|g| *g != 0)).await {
            Ok(Ok(g)) => Ok(*g),
            _ => Err(NOT_RUNNING.into()),
        };
        result
    }

    fn next_id(&self, prefix: &str) -> String {
        let mut i = self.inner.lock().unwrap();
        i.seq += 1;
        format!("{prefix}{}", i.seq)
    }

    /// The renderer's invoke. Ok(None) is the core's `undefined`.
    pub async fn call(&self, channel: String, args: Vec<Value>) -> CallReply {
        self.wait_ready(Duration::from_secs(60)).await?;
        let id = self.next_id("c");
        let (tx, rx) = oneshot::channel();
        {
            let i = self.inner.lock().unwrap();
            if i.stopping {
                return Err("Lumen is shutting down.".into());
            }
            if !i.channels.contains(&channel) {
                return Err("Unknown channel.".into());
            }
        }
        // core-host drops an over-long line with a protocol-error that carries no id, so the call would never settle.
        let line = encode(&Frame::Call { id: id.clone(), channel, args });
        if !fits(&line) {
            return Err(TOO_LARGE.into());
        }
        self.inner.lock().unwrap().calls.insert(id.clone(), tx);
        if let Err(e) = self.write_line(line) {
            self.inner.lock().unwrap().calls.remove(&id);
            return Err(e);
        }
        rx.await.unwrap_or_else(|_| Err(GONE.into()))
    }

    /// core.asset(urlPath) of the core.
    pub async fn asset(&self, path: String) -> Result<AssetReply, String> {
        self.wait_ready(Duration::from_secs(60)).await?;
        let id = self.next_id("a");
        let (tx, rx) = oneshot::channel();
        self.inner.lock().unwrap().assets.insert(id.clone(), tx);
        if let Err(e) = self.write(&Frame::Asset { id: id.clone(), path }) {
            self.inner.lock().unwrap().assets.remove(&id);
            return Err(e);
        }
        rx.await.map_err(|_| GONE.to_string())
    }

    /// The core process running now (0 before the first start).
    pub fn generation(&self) -> u64 {
        self.inner.lock().unwrap().generation
    }

    /// Whether core `generation` is the one running now (started and not exited). False from the moment it exits, before the
    /// restart begins, so work it queued is never run for it.
    pub fn is_current(&self, generation: u64) -> bool {
        self.inner.lock().unwrap().generation == generation && *self.exited.borrow() < generation
    }

    /// Answer to a `platform` request of core `generation`. An answer for a core that has since died is dropped: its request ids
    /// mean nothing to the restarted core (a delete confirmation must never settle another request). Returns whether it was sent.
    pub fn answer(&self, id: String, generation: u64, result: Result<Value, String>) -> bool {
        let frame = match result {
            Ok(value) => Frame::PlatformResult { id, ok: true, value: Some(value), error: None },
            Err(error) => Frame::PlatformResult { id, ok: false, value: None, error: Some(error) },
        };
        // The check and the write happen under the stdin lock: on_exit clears stdin before a new generation can begin.
        let mut guard = self.stdin.lock().unwrap();
        if self.inner.lock().unwrap().generation != generation {
            return false;
        }
        let Some(stdin) = guard.as_mut() else { return false };
        let mut line = encode(&frame);
        line.push('\n');
        stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()).is_ok()
    }

    /// A callback event of the platform (browser.onNavigate / onPopup / onState); `payload` is an object.
    pub fn event(&self, name: &str, payload: Value) {
        let _ = self.write(&Frame::PlatformEvent { name: name.to_string(), payload });
    }

    /// Exit: `shutdown`, then the Job Object ends everything after 5 s.
    pub async fn shutdown(&self) {
        let generation = {
            let mut i = self.inner.lock().unwrap();
            i.stopping = true;
            i.generation
        };
        if generation == 0 || *self.exited.borrow() >= generation {
            return;
        }
        let _ = self.write(&Frame::Shutdown);
        let mut rx = self.exited.subscribe();
        if tokio::time::timeout(SHUTDOWN_GRACE, rx.wait_for(|g| *g >= generation)).await.is_err() {
            eprintln!("[core] no exit within 5 s; ending the job");
            self.kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), rx.wait_for(|g| *g >= generation)).await;
        }
    }

    /// Ends the core and everything it started at once.
    pub fn kill(&self) {
        if let Some(job) = &self.inner.lock().unwrap().job {
            job.terminate();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn round_trip(wire: Value) {
        let frame = decode(&wire.to_string()).unwrap_or_else(|| panic!("decode failed: {wire}"));
        let back: Value = serde_json::from_str(&encode(&frame)).unwrap();
        assert_eq!(back, wire);
    }

    #[test]
    fn frames_match_core_host_wire_format() {
        round_trip(json!({"id": "c1", "type": "call", "channel": "engine", "args": ["bootstrap", {"a": 1}]}));
        round_trip(json!({"type": "shutdown"}));
        round_trip(json!({"id": "p1", "type": "platform-result", "ok": true, "value": [1, "x"]}));
        round_trip(json!({"id": "p2", "type": "platform-result", "ok": false, "error": "not implemented in Tauri shell yet"}));
        round_trip(json!({"type": "platform-event", "name": "browser.onState", "payload": {"type": "found"}}));
        round_trip(json!({"id": "a1", "type": "asset", "path": "/index.html"}));
        round_trip(json!({"type": "ready", "channels": ["engine", "photos"]}));
        round_trip(json!({"id": "c1", "type": "result", "ok": true, "value": {"chats": []}}));
        round_trip(json!({"id": "c3", "type": "result", "ok": true, "value": null}));
        round_trip(json!({"id": "c2", "type": "result", "ok": false, "error": "Unknown channel."}));
        round_trip(json!({"type": "event", "channel": "engine-event", "payload": {"type": "chunk", "data": "Mer"}}));
        round_trip(json!({"id": "p3", "type": "platform", "method": "windowAction", "args": ["minimize"]}));
        round_trip(json!({"id": "a1", "type": "asset-result", "status": 200, "headers": {"content-type": "image/png"}, "filePath": "C:\\d\\photo.png"}));
        round_trip(json!({"id": "a2", "type": "asset-result", "status": 404, "headers": {}, "body": "Not found"}));
        round_trip(json!({"type": "protocol-error", "reason": "too-large"}));
    }

    #[test]
    fn missing_values_decode() {
        // `undefined` results and payloads are left out of the JSON by the core.
        assert_eq!(decode(r#"{"id":"c1","type":"result","ok":true}"#), Some(Frame::Result { id: "c1".into(), ok: true, value: None, error: None }));
        assert_eq!(decode(r#"{"id":"c1","type":"result","ok":true,"value":null}"#), Some(Frame::Result { id: "c1".into(), ok: true, value: Some(Value::Null), error: None }));
        assert!(decode(r#"{"type":"event","channel":"engine-event"}"#).is_some());
        assert!(decode(r#"{"type":"platform","id":"p1","method":"app.quit"}"#).is_some());
    }

    #[test]
    fn unknown_or_broken_lines_are_none() {
        assert_eq!(decode("not json"), None);
        assert_eq!(decode(r#"{"type":"nope"}"#), None);
        assert_eq!(decode(r#"{"type":"call","channel":"x"}"#), None);
    }

    #[test]
    fn encoded_frames_are_single_lines() {
        let f = Frame::Call { id: "c1".into(), channel: "engine".into(), args: vec![json!("a\nb\u{2028}ş")] };
        let line = encode(&f);
        assert!(!line.contains('\n'));
        assert_eq!(decode(&line), Some(f));
    }

    // A stdin that records what is written to it.
    #[derive(Clone, Default)]
    struct Sink(Arc<Mutex<Vec<u8>>>);
    impl Write for Sink {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn idle_core() -> Arc<Core> {
        let cfg = Config { node: "node.exe".into(), script: "x".into(), data: "d".into(), app_root: "a".into(), ui_check: false, log: "l".into() };
        Core::new(cfg, Box::new(|_| {}))
    }

    #[test]
    fn answers_for_an_earlier_core_are_dropped() {
        let core = idle_core();
        let sink = Sink::default();
        core.inner.lock().unwrap().generation = 2;
        *core.stdin.lock().unwrap() = Some(Box::new(sink.clone()));
        // A request of core 1 (e.g. a delete confirmation still open when it died) is answered after core 2 started.
        assert!(!core.answer("p1".into(), 1, Ok(json!(1))));
        assert!(sink.0.lock().unwrap().is_empty(), "nothing reaches the new core");
        assert!(core.answer("p2".into(), 2, Ok(json!(0))));
        let written = String::from_utf8(sink.0.lock().unwrap().clone()).unwrap();
        assert_eq!(written, "{\"type\":\"platform-result\",\"id\":\"p2\",\"ok\":true,\"value\":0}\n");
        assert_eq!(core.generation(), 2);
        assert!(core.is_current(2) && !core.is_current(1));
        // Once core 2 has exited (before any restart), its queued work is no longer current either.
        core.exited.send_replace(2);
        assert!(!core.is_current(2));
        // No core running (between the exit and the restart): nothing to answer.
        *core.stdin.lock().unwrap() = None;
        assert!(!core.answer("p3".into(), 2, Err("x".into())));
    }

    #[test]
    fn node_variables_are_found() {
        let names = ["NODE_OPTIONS", "node_extra_ca_certs", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_PATH", "PATH", "LUMEN_TEST_DIR", "XNODE_"];
        assert_eq!(node_vars(names.iter().map(|s| s.to_string())), vec!["NODE_OPTIONS", "node_extra_ca_certs", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_PATH"]);
    }

    #[test]
    fn the_grace_period_outlasts_core_hosts_stop_cap() {
        // core-host STOP_CAP_MS (4 s) plus the lock release and exit must fit in the shell's grace period.
        let host = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../app/core-host.cjs")).unwrap();
        let cap: u64 = host.split("const STOP_CAP_MS = ").nth(1).and_then(|r| r.split(';').next()).and_then(|n| n.trim().parse().ok()).expect("STOP_CAP_MS");
        assert!(Duration::from_millis(cap + 500) <= SHUTDOWN_GRACE, "cap {cap} ms vs grace {SHUTDOWN_GRACE:?}");
        assert!(host.contains("const EXIT_LOCKED = 3;"));
        assert_eq!(EXIT_LOCKED, 3);
    }

    #[test]
    fn lines_over_the_core_host_limit_do_not_fit() {
        // core-host accepts a line of exactly 64 MiB (newline excluded) and drops a longer one without its id.
        assert!(fits(&"x".repeat(LINE_LIMIT)));
        assert!(!fits(&"x".repeat(LINE_LIMIT + 1)));
        let big = encode(&Frame::Call { id: "c1".into(), channel: "photos".into(), args: vec![json!("ş".repeat(LINE_LIMIT / 2))] });
        assert!(!fits(&big), "UTF-8 bytes are counted, not characters");
    }
}
