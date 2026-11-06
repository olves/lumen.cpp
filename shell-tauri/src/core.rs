// The core process: `node.exe app/core-host.cjs`, one JSON object per line on stdin/stdout (protocol: app/core-host.cjs).
// The shell starts it inside a Job Object (KILL_ON_JOB_CLOSE: if lumen.exe dies, the core and everything it started die too),
// waits for `ready`, forwards calls, asset requests and platform answers, and restarts it once if it dies or does not start.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{oneshot, watch};

pub const LINE_LIMIT: usize = 64 * 1024 * 1024;
pub const READY_TIMEOUT: Duration = Duration::from_secs(20);
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
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
    Platform { id: String, method: String, args: Vec<Value> },
    /// The core died or did not start; `restarting` says whether one restart is under way.
    Fatal { timed_out: bool, restarting: bool },
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
    stdin: Mutex<Option<ChildStdin>>,
    ready: watch::Sender<u64>,  // generation that is ready, 0 = none
    exited: watch::Sender<u64>, // last generation that exited
    notify: Box<dyn Fn(Notice) + Send + Sync>,
}

pub const GONE: &str = "Lumen's core stopped unexpectedly.";
pub const NOT_RUNNING: &str = "Lumen's core is not running.";

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
        if cfg.ui_check {
            cmd.arg("--ui-check");
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
        *self.stdin.lock().unwrap() = child.stdin.take();
        self.ready.send_replace(0);

        let me = self.clone();
        std::thread::spawn(move || {
            me.read_loop(stdout, generation);
            let _ = child.wait();
            me.on_exit(generation);
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

    fn read_loop(&self, stdout: impl Read, generation: u64) {
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

    fn dispatch(&self, frame: Frame, generation: u64) {
        match frame {
            Frame::Ready { channels } => {
                self.inner.lock().unwrap().channels = channels.into_iter().collect();
                self.ready.send_replace(generation);
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
            Frame::Platform { id, method, args } => (self.notify)(Notice::Platform { id, method, args }),
            Frame::ProtocolError { reason } => eprintln!("[core] protocol error: {reason}"),
            _ => {}
        }
    }

    fn on_exit(self: &Arc<Self>, generation: u64) {
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
            let restart = !i.stopping && i.restarts == 0;
            if restart {
                i.restarts += 1;
            }
            (if i.stopping { None } else { Some(restart) }, i.timed_out)
        };
        *self.stdin.lock().unwrap() = None;
        self.ready.send_replace(0);
        self.exited.send_replace(generation);
        let Some(restart) = restart else { return };
        (self.notify)(Notice::Fatal { timed_out, restarting: restart });
        if restart {
            if let Err(e) = self.spawn() {
                eprintln!("[core] restart failed: {e}");
                (self.notify)(Notice::Fatal { timed_out: false, restarting: false });
            }
        }
    }

    fn write(&self, frame: &Frame) -> Result<(), String> {
        let mut guard = self.stdin.lock().unwrap();
        let stdin = guard.as_mut().ok_or_else(|| NOT_RUNNING.to_string())?;
        let mut line = encode(frame);
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
            let mut i = self.inner.lock().unwrap();
            if i.stopping {
                return Err("Lumen is shutting down.".into());
            }
            if !i.channels.contains(&channel) {
                return Err("Unknown channel.".into());
            }
            i.calls.insert(id.clone(), tx);
        }
        if let Err(e) = self.write(&Frame::Call { id: id.clone(), channel, args }) {
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

    /// Answer to a `platform` request.
    pub fn answer(&self, id: String, result: Result<Value, String>) {
        let frame = match result {
            Ok(value) => Frame::PlatformResult { id, ok: true, value: Some(value), error: None },
            Err(error) => Frame::PlatformResult { id, ok: false, value: None, error: Some(error) },
        };
        let _ = self.write(&frame);
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
}
