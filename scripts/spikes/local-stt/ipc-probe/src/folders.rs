//! The folders a downloaded model could live in (D7), the temporary copy of a recording (Task 5), and the native
//! Open dialog.

use serde_json::{Value, json};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;
use windows::Win32::Foundation::{CloseHandle, GENERIC_READ};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, GetDiskFreeSpaceExW, OPEN_EXISTING,
};
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize};
use windows::Win32::System::Memory::{CreateFileMappingW, FILE_MAP_READ, MapViewOfFile, PAGE_READONLY, UnmapViewOfFile};
use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, SIGDN_FILESYSPATH};
use windows::core::HSTRING;

#[derive(Clone, Copy)]
pub enum Kind {
    Temporary,
    LocalCache,
    LocalState,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Temporary => "TemporaryFolder",
            Kind::LocalCache => "LocalCacheFolder",
            Kind::LocalState => "LocalFolder (LocalState)",
        }
    }
}

/// The package's folder, or None without package identity.
fn package_folder(kind: Kind) -> Option<PathBuf> {
    let data = windows::Storage::ApplicationData::Current().ok()?;
    let folder = match kind {
        Kind::Temporary => data.TemporaryFolder(),
        Kind::LocalCache => data.LocalCacheFolder(),
        Kind::LocalState => data.LocalFolder(),
    }
    .ok()?;
    Some(PathBuf::from(folder.Path().ok()?.to_os_string()))
}

/// The package's folder, or a stand-in under %TEMP% / %LOCALAPPDATA% when unpackaged.
pub fn folder(kind: Kind) -> PathBuf {
    package_folder(kind).unwrap_or_else(|| {
        let base = |var: &str| PathBuf::from(std::env::var_os(var).unwrap_or_default()).join("describe-stt-probe");
        match kind {
            Kind::Temporary => base("TEMP"),
            Kind::LocalCache => base("LOCALAPPDATA").join("LocalCache"),
            Kind::LocalState => base("LOCALAPPDATA").join("LocalState"),
        }
    })
}

pub fn uploads_dir() -> PathBuf {
    folder(Kind::Temporary).join("uploads")
}

fn package() -> Value {
    let Ok(pkg) = windows::ApplicationModel::Package::Current() else { return Value::Null };
    let id = pkg.Id().ok();
    let version = id.as_ref().and_then(|i| i.Version().ok());
    json!({
        "familyName": id.as_ref().and_then(|i| i.FamilyName().ok()).map(|s| s.to_string()),
        "version": version.map(|v| format!("{}.{}.{}.{}", v.Major, v.Minor, v.Build, v.Revision)),
        "installedPath": pkg.InstalledPath().ok().map(|s| s.to_string()),
    })
}

fn free_bytes(path: &Path) -> Option<u64> {
    let mut free = 0u64;
    unsafe { GetDiskFreeSpaceExW(&HSTRING::from(path.as_os_str()), Some(&mut free), None, None) }.ok()?;
    Some(free)
}

pub fn environment() -> Value {
    let kinds = [Kind::Temporary, Kind::LocalCache, Kind::LocalState];
    let folders: Vec<Value> = kinds
        .iter()
        .map(|k| {
            let dir = folder(*k);
            let existing = dir.ancestors().find(|p| p.exists()).map(Path::to_path_buf).unwrap_or_default();
            json!({ "kind": k.name(), "path": dir.display().to_string(), "freeBytes": free_bytes(&existing) })
        })
        .collect();
    json!({
        "packageIdentity": package_folder(Kind::LocalState).is_some(),
        "package": package(),
        "folders": folders,
        "uploads": uploads_dir().display().to_string(),
    })
}

/// Partial uploads left in the temporary folder (by a crash); `clean` deletes them.
pub fn leftovers(clean: bool) -> Value {
    let dir = uploads_dir();
    let started = Instant::now();
    let mut files = Vec::new();
    let mut bytes = 0u64;
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
        bytes += len;
        files.push(entry.file_name().to_string_lossy().into_owned());
        if clean {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    json!({ "dir": dir.display().to_string(), "files": files.len(), "bytes": bytes, "cleaned": clean, "ms": started.elapsed().as_secs_f64() * 1000.0 })
}

/// Windows' own Open dialog, on its own STA thread. None if cancelled.
pub fn open_dialog() -> Result<Option<String>, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<Option<String>> {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            if dialog.Show(None).is_err() {
                return Ok(None);
            }
            let item = dialog.GetResult()?;
            let name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = name.to_string().ok();
            CoTaskMemFree(Some(name.0 as *const core::ffi::c_void));
            Ok(path)
        })();
        CoUninitialize();
        result.map_err(|e| e.to_string())
    }
}

/// Reads a file through a memory mapping, touching every page; returns (bytes, seconds).
fn mmap_read(path: &Path) -> Result<(u64, f64), String> {
    let started = Instant::now();
    unsafe {
        let file = CreateFileW(&HSTRING::from(path.as_os_str()), GENERIC_READ.0, FILE_SHARE_READ, None, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, None)
            .map_err(|e| format!("CreateFileW: {e}"))?;
        let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let mapping = CreateFileMappingW(file, None, PAGE_READONLY, 0, 0, None).map_err(|e| format!("CreateFileMappingW: {e}"));
        let mapping = match mapping {
            Ok(m) => m,
            Err(e) => {
                let _ = CloseHandle(file);
                return Err(e);
            }
        };
        let view = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0);
        if view.Value.is_null() {
            let _ = CloseHandle(mapping);
            let _ = CloseHandle(file);
            return Err("MapViewOfFile failed".into());
        }
        let base = view.Value as *const u8;
        let mut sum = 0u64;
        let mut off = 0u64;
        while off < len {
            sum = sum.wrapping_add(*base.add(off as usize) as u64);
            off += 4096;
        }
        std::hint::black_box(sum);
        let _ = UnmapViewOfFile(view);
        let _ = CloseHandle(mapping);
        let _ = CloseHandle(file);
        Ok((len, started.elapsed().as_secs_f64()))
    }
}

/// `--d7 [--write] [--mb N] --report PATH`
pub fn d7(args: &[String]) -> i32 {
    let get = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let write = args.iter().any(|a| a == "--write");
    let mb: u64 = get("--mb").and_then(|v| v.parse().ok()).unwrap_or(1024);
    let package = package();
    let mut folders = Vec::new();
    for kind in [Kind::Temporary, Kind::LocalCache, Kind::LocalState] {
        let dir = folder(kind);
        let _ = std::fs::create_dir_all(&dir);
        let probe = dir.join("d7-probe.bin");
        let marker = dir.join("d7-marker.json");
        let mut entry = json!({ "kind": kind.name(), "path": dir.display().to_string() });
        entry["before"] = json!({
            "probeBytes": std::fs::metadata(&probe).map(|m| m.len()).ok(),
            "marker": std::fs::read_to_string(&marker).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()),
        });
        if write {
            let started = Instant::now();
            let result = (|| -> std::io::Result<()> {
                let mut out = BufWriter::with_capacity(1 << 20, std::fs::File::create(&probe)?);
                let block: Vec<u8> = (0..1u32 << 20).map(|i| (i.wrapping_mul(2_654_435_761) >> 24) as u8).collect();
                for _ in 0..mb {
                    out.write_all(&block)?;
                }
                out.flush()?;
                out.get_ref().sync_all()
            })();
            entry["write"] = match result {
                Ok(()) => json!({ "mb": mb, "seconds": started.elapsed().as_secs_f64() }),
                Err(e) => json!({ "error": e.to_string() }),
            };
            let _ = std::fs::write(&marker, json!({ "writtenBy": package["version"], "at": now() }).to_string());
        }
        if probe.exists() {
            entry["mmapRead"] = match mmap_read(&probe) {
                Ok((bytes, sec)) => json!({ "bytes": bytes, "seconds": sec }),
                Err(e) => json!({ "error": e }),
            };
        }
        entry["freeBytes"] = json!(free_bytes(&dir));
        folders.push(entry);
    }
    let report = json!({ "tool": "describe-stt-probe --d7", "at": now(), "packageIdentity": package_folder(Kind::LocalState).is_some(), "package": package, "folders": folders });
    let text = serde_json::to_string_pretty(&report).unwrap_or_default();
    match get("--report") {
        Some(path) => match std::fs::write(&path, text + "\n") {
            Ok(()) => 0,
            Err(_) => 1,
        },
        None => {
            println!("{text}");
            0
        }
    }
}

fn now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{secs}")
}
