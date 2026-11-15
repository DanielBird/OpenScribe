//! Memory of this process and of every process it started (WebView2's msedgewebview2.exe and their children).

use serde_json::{Value, json};
use std::collections::HashMap;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

fn counters(pid: u32) -> Option<PROCESS_MEMORY_COUNTERS_EX> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut c = PROCESS_MEMORY_COUNTERS_EX { cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32, ..Default::default() };
        let ok = GetProcessMemoryInfo(handle, &mut c as *mut _ as *mut PROCESS_MEMORY_COUNTERS, c.cb).is_ok();
        let _ = CloseHandle(handle);
        ok.then_some(c)
    }
}

fn processes() -> Vec<(u32, u32, String)> {
    let mut list = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return list };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                list.push((entry.th32ProcessID, entry.th32ParentProcessID, name));
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    list
}

pub fn snapshot() -> Value {
    let own = std::process::id();
    let all = processes();
    let mut children: HashMap<u32, Vec<(u32, String)>> = HashMap::new();
    for (pid, parent, name) in &all {
        children.entry(*parent).or_default().push((*pid, name.clone()));
    }
    let mut stack = vec![own];
    let mut descendants = Vec::new();
    while let Some(p) = stack.pop() {
        for (child, name) in children.get(&p).cloned().unwrap_or_default() {
            if child != own && !descendants.iter().any(|(c, _)| *c == child) {
                descendants.push((child, name));
                stack.push(child);
            }
        }
    }
    let mine = counters(own);
    let (mut ws, mut private, mut n) = (0u64, 0u64, 0);
    let mut each = Vec::new();
    for (pid, name) in &descendants {
        if let Some(c) = counters(*pid) {
            ws += c.WorkingSetSize as u64;
            private += c.PrivateUsage as u64;
            n += 1;
            each.push(json!({ "pid": pid, "name": name, "workingSetBytes": c.WorkingSetSize, "privateBytes": c.PrivateUsage }));
        }
    }
    json!({
        "probe": mine.map(|c| json!({
            "workingSetBytes": c.WorkingSetSize, "peakWorkingSetBytes": c.PeakWorkingSetSize, "privateBytes": c.PrivateUsage,
        })),
        "children": { "processes": n, "workingSetBytes": ws, "privateBytes": private, "each": each },
    })
}
