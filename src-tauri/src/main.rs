// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // The same exe, started again by the app, is the worker that runs the speech engine (DECISIONS.md D53): it never
  // opens a window, and the app ends it to cancel.
  if std::env::args().nth(1).as_deref() == Some(describe_lib::stt::protocol::WORKER_FLAG) {
    std::process::exit(describe_lib::stt::run::main());
  }
  describe_lib::run();
}
