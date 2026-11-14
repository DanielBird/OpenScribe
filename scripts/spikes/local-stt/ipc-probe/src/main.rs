//! The STT probe (Phase 33): how a recording gets from the page to Rust (Task 5), and where downloaded models would
//! live in the installed app (D7). Not part of the app.
//!
//! GUI (no arguments): a page that streams a chosen file to Rust in chunks through Tauri's IPC (raw request bodies)
//! into the temporary folder, gets a path instead from Tauri's drag-and-drop event or a native Open dialog, and
//! reports the memory of this process and of its WebView2 processes.
//!
//! Headless: `describe-stt-probe --d7 [--write] [--mb N] --report PATH` checks the package's TemporaryFolder,
//! LocalCache and LocalState (or stand-ins without package identity): writes an N MB file (with --write), reads it
//! back memory-mapped, lists what's there and the free space. Installed as an MSIX it is started through its app
//! execution alias, so it runs with the package's identity.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod folders;
mod memory;

use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::ipc::{InvokeBody, Request};

struct Upload {
    file: File,
    path: PathBuf,
    bytes: u64,
}

#[derive(Default)]
struct Uploads {
    open: Mutex<HashMap<String, Upload>>,
    next: AtomicU64,
}

#[tauri::command]
fn upload_begin(state: tauri::State<'_, Uploads>, name: String, size: u64) -> Result<String, String> {
    let dir = folders::uploads_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = format!("{}-{}", std::process::id(), state.next.fetch_add(1, Ordering::SeqCst));
    let path = dir.join(format!("upload-{id}.bin"));
    let file = File::create(&path).map_err(|e| e.to_string())?;
    let _ = (name, size);
    state.open.lock().map_err(|e| e.to_string())?.insert(id.clone(), Upload { file, path, bytes: 0 });
    Ok(id)
}

#[tauri::command]
fn upload_chunk(state: tauri::State<'_, Uploads>, request: Request<'_>) -> Result<u64, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw body".into());
    };
    let id = request
        .headers()
        .get("x-upload-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("no x-upload-id header")?
        .to_string();
    let mut open = state.open.lock().map_err(|e| e.to_string())?;
    let upload = open.get_mut(&id).ok_or("unknown upload")?;
    upload.file.write_all(bytes).map_err(|e| e.to_string())?;
    upload.bytes += bytes.len() as u64;
    Ok(upload.bytes)
}

#[tauri::command]
fn upload_finish(state: tauri::State<'_, Uploads>, id: String, keep: bool) -> Result<Value, String> {
    let mut upload = state.open.lock().map_err(|e| e.to_string())?.remove(&id).ok_or("unknown upload")?;
    upload.file.flush().map_err(|e| e.to_string())?;
    drop(upload.file);
    let started = std::time::Instant::now();
    if !keep {
        std::fs::remove_file(&upload.path).map_err(|e| e.to_string())?;
    }
    Ok(json!({ "path": upload.path.display().to_string(), "bytes": upload.bytes, "deleteMs": started.elapsed().as_secs_f64() * 1000.0 }))
}

#[tauri::command]
fn memory() -> Value {
    memory::snapshot()
}

#[tauri::command]
fn path_info(path: String) -> Value {
    let meta = std::fs::metadata(&path);
    json!({ "path": path, "exists": meta.is_ok(), "bytes": meta.map(|m| m.len()).ok() })
}

#[tauri::command]
async fn open_dialog() -> Result<Value, String> {
    let started = std::time::Instant::now();
    let path = std::thread::spawn(folders::open_dialog).join().map_err(|_| "dialog thread panicked")??;
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    Ok(match path {
        Some(p) => json!({ "path": p, "bytes": std::fs::metadata(&p).map(|m| m.len()).ok(), "dialogMs": ms }),
        None => json!({ "cancelled": true }),
    })
}

#[tauri::command]
fn environment() -> Value {
    folders::environment()
}

#[tauri::command]
fn temp_leftovers() -> Value {
    folders::leftovers(false)
}

#[tauri::command]
fn clean_temp() -> Value {
    folders::leftovers(true)
}

/// Leaves an upload half-written and ends the process at once, as a crash would.
#[tauri::command]
fn crash_now(state: tauri::State<'_, Uploads>) {
    if let Ok(mut open) = state.open.lock() {
        for upload in open.values_mut() {
            let _ = upload.file.flush();
        }
    }
    std::process::abort();
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--d7") {
        std::process::exit(folders::d7(&args));
    }
    tauri::Builder::default()
        .manage(Uploads::default())
        .invoke_handler(tauri::generate_handler![
            upload_begin,
            upload_chunk,
            upload_finish,
            memory,
            path_info,
            open_dialog,
            environment,
            temp_leftovers,
            clean_temp,
            crash_now
        ])
        .run(tauri::generate_context!())
        .expect("the probe window");
}
