//! Runs a command on a pseudo console (ConPTY) and saves everything it prints there, escape codes included.
//! For Cinebench, which prints its score only to a console it attaches to ("parentconsole"), never to a redirected
//! stdout, and keeps no results file. The child is created by this process, so it is in this process's job.

use std::fs::File;
use std::io::Write;
use std::path::Path;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Storage::FileSystem::ReadFile;
use windows::Win32::System::Console::{COORD, ClosePseudoConsole, CreatePseudoConsole};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess, INFINITE,
    InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
    PROCESS_INFORMATION, STARTUPINFOEXW, UpdateProcThreadAttribute, WaitForSingleObject,
};
use windows::core::{PCWSTR, PWSTR};

fn quote(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_string();
    }
    format!("\"{}\"", arg.replace('"', "\\\""))
}

/// Runs `command` on a 200 × 50 pseudo console, writes its output to `capture`, and returns the exit code.
pub fn run(command: &[String], capture: &Path) -> Result<u32, String> {
    fn e(what: &'static str) -> impl Fn(windows::core::Error) -> String {
        move |err| format!("{what}: {err}")
    }
    unsafe {
        let (mut in_read, mut in_write) = (HANDLE::default(), HANDLE::default());
        let (mut out_read, mut out_write) = (HANDLE::default(), HANDLE::default());
        CreatePipe(&mut in_read, &mut in_write, None, 0).map_err(e("CreatePipe"))?;
        CreatePipe(&mut out_read, &mut out_write, None, 0).map_err(e("CreatePipe"))?;
        let pty = CreatePseudoConsole(COORD { X: 200, Y: 50 }, in_read, out_write, 0).map_err(e("CreatePseudoConsole"))?;
        // The pseudo console holds its own copies now.
        let _ = CloseHandle(in_read);
        let _ = CloseHandle(out_write);

        // Drain the output from the start: a pseudo console whose output nobody reads blocks its writers.
        let raw = out_read.0 as usize;
        let path = capture.to_path_buf();
        let reader = std::thread::spawn(move || {
            let handle = HANDLE(raw as *mut core::ffi::c_void);
            let mut file = File::create(path).ok();
            let mut buf = [0u8; 8192];
            loop {
                let mut n = 0u32;
                if ReadFile(handle, Some(&mut buf), Some(&mut n), None).is_err() || n == 0 {
                    break;
                }
                if let Some(f) = file.as_mut() {
                    let _ = f.write_all(&buf[..n as usize]);
                }
            }
        });

        let mut size = 0usize;
        let _ = InitializeProcThreadAttributeList(None, 1, None, &mut size);
        let mut storage = vec![0u8; size];
        let attrs = LPPROC_THREAD_ATTRIBUTE_LIST(storage.as_mut_ptr() as *mut core::ffi::c_void);
        InitializeProcThreadAttributeList(Some(attrs), 1, None, &mut size).map_err(e("InitializeProcThreadAttributeList"))?;
        UpdateProcThreadAttribute(
            attrs,
            0,
            PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
            Some(pty.0 as *const core::ffi::c_void),
            std::mem::size_of_val(&pty),
            None,
            None,
        )
        .map_err(e("UpdateProcThreadAttribute"))?;
        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        startup.lpAttributeList = attrs;
        let line = command.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" ");
        let mut wide: Vec<u16> = line.encode_utf16().chain(std::iter::once(0)).collect();
        let mut info = PROCESS_INFORMATION::default();
        let created = CreateProcessW(
            PCWSTR::null(),
            Some(PWSTR(wide.as_mut_ptr())),
            None,
            None,
            false,
            EXTENDED_STARTUPINFO_PRESENT,
            None,
            PCWSTR::null(),
            &startup.StartupInfo,
            &mut info,
        );
        let result = match created {
            Ok(()) => {
                WaitForSingleObject(info.hProcess, INFINITE);
                let mut code = 0u32;
                let _ = GetExitCodeProcess(info.hProcess, &mut code);
                let _ = CloseHandle(info.hThread);
                let _ = CloseHandle(info.hProcess);
                Ok(code)
            }
            Err(err) => Err(format!("CreateProcessW: {err}")),
        };
        DeleteProcThreadAttributeList(attrs);
        // Closing the pseudo console ends its output, so the reader sees end of file.
        ClosePseudoConsole(pty);
        let _ = reader.join();
        let _ = CloseHandle(out_read);
        let _ = CloseHandle(in_write);
        result
    }
}
