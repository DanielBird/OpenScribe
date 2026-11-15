fn main() {
  // Each of the app's commands needs a permission, which `capabilities/default.json` grants. Without this list Tauri
  // would allow every app command. Keep it in step with `src/stt/commands.rs` COMMANDS.
  let commands: &'static [&'static str] = &[
    "stt_choose_recording",
    "stt_status",
    "stt_start",
    "stt_cancel",
    "set_close_guard",
    "stt_download",
    "stt_download_cancel",
    "stt_remove_models",
  ];
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(commands)),
  )
  .expect("failed to run the Tauri build script");
}
