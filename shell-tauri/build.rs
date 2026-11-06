fn main() {
    // Declaring the app commands makes them subject to capabilities: only the `main` window may call them (capabilities/main.json).
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["lumen_call", "window_action"])),
    )
    .expect("tauri build script failed");
}
