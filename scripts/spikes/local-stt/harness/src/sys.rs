//! Windows facts the emulation depends on: the cores and their efficiency classes, this process's affinity, the
//! active power scheme and its frequency cap, CPU features, process memory, and job objects.

use serde::Serialize;
use std::process::Command;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_CPU_RATE_CONTROL_ENABLE, JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,
    JOB_OBJECT_LIMIT_AFFINITY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_BASIC_PROCESS_ID_LIST, JOBOBJECT_CPU_RATE_CONTROL_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectBasicAccountingInformation, JobObjectBasicProcessIdList,
    JobObjectCpuRateControlInformation, JobObjectExtendedLimitInformation,
    QueryInformationJobObject, SetInformationJobObject,
};
use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX};
use windows::Win32::System::SystemInformation::{
    GetLogicalProcessorInformationEx, RelationProcessorCore, SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetProcessAffinityMask, IsProcessorFeaturePresent, PF_AVX2_INSTRUCTIONS_AVAILABLE,
    PF_AVX512F_INSTRUCTIONS_AVAILABLE, PF_AVX_INSTRUCTIONS_AVAILABLE,
};

/// One physical core: its logical processors (group 0 only; this PC has 24) and Windows' efficiency class
/// (higher = faster; on the i7-13700K the P-cores are class 1 and the E-cores class 0).
#[derive(Debug, Clone, Serialize)]
pub struct Core {
    pub efficiency_class: u8,
    pub logical: Vec<u32>,
}

pub fn cores() -> windows::core::Result<Vec<Core>> {
    let mut len = 0u32;
    // The first call fails with ERROR_INSUFFICIENT_BUFFER and sets the length.
    let _ = unsafe { GetLogicalProcessorInformationEx(RelationProcessorCore, None, &mut len) };
    let mut buf = vec![0u8; len as usize];
    unsafe {
        GetLogicalProcessorInformationEx(
            RelationProcessorCore,
            Some(buf.as_mut_ptr() as *mut SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX),
            &mut len,
        )?;
    }
    let mut cores = Vec::new();
    let mut offset = 0usize;
    while offset < len as usize {
        let info = unsafe { &*(buf.as_ptr().add(offset) as *const SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX) };
        let processor = unsafe { info.Anonymous.Processor };
        let group = processor.GroupMask[0];
        let mut logical = Vec::new();
        if group.Group == 0 {
            for bit in 0..usize::BITS {
                if group.Mask & (1usize << bit) != 0 {
                    logical.push(bit);
                }
            }
        }
        cores.push(Core { efficiency_class: processor.EfficiencyClass, logical });
        offset += info.Size as usize;
    }
    Ok(cores)
}

/// The emulated laptop's shape: six of the fastest cores, both hyper-threads of each, so twelve logical processors.
/// Core 0 takes most interrupts and DPCs, so the six are taken from the top of the fastest class downwards.
pub fn laptop_mask(cores: &[Core]) -> Result<usize, String> {
    let best = cores.iter().map(|c| c.efficiency_class).max().ok_or("no cores")?;
    let mut fast: Vec<&Core> = cores.iter().filter(|c| c.efficiency_class == best && c.logical.len() == 2).collect();
    if fast.len() < 6 {
        return Err(format!("only {} cores of the fastest class with two threads; need 6", fast.len()));
    }
    fast.sort_by_key(|c| std::cmp::Reverse(c.logical[0]));
    let mut mask = 0usize;
    for core in fast.iter().take(6) {
        for lp in &core.logical {
            mask |= 1usize << lp;
        }
    }
    Ok(mask)
}

pub fn mask_to_list(mask: usize) -> Vec<u32> {
    (0..usize::BITS).filter(|b| mask & (1usize << b) != 0).collect()
}

pub fn parse_mask(text: &str) -> Option<usize> {
    let t = text.trim();
    if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        usize::from_str_radix(hex, 16).ok()
    } else {
        t.parse().ok()
    }
}

/// (process affinity mask, system affinity mask) of this process.
pub fn own_affinity() -> (usize, usize) {
    let (mut process, mut system) = (0usize, 0usize);
    let _ = unsafe { GetProcessAffinityMask(GetCurrentProcess(), &mut process, &mut system) };
    (process, system)
}

#[derive(Debug, Clone, Serialize)]
pub struct PowerScheme {
    pub guid: String,
    pub name: String,
    /// `PROCFREQMAX` and `PROCFREQMAX1` on mains power, in MHz; 0 means no cap.
    pub procfreqmax_ac: Option<u32>,
    pub procfreqmax1_ac: Option<u32>,
}

/// The active scheme, read with `powercfg` (reading changes nothing).
pub fn active_scheme() -> Option<PowerScheme> {
    let out = Command::new("powercfg").arg("/getactivescheme").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    // "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)"
    let line = text.lines().find(|l| l.contains("GUID"))?;
    let after = line.split_once(':')?.1.trim();
    let guid = after.split_whitespace().next()?.to_string();
    let name = after
        .split_once('(')
        .and_then(|(_, rest)| rest.rsplit_once(')').map(|(n, _)| n.to_string()))
        .unwrap_or_default();
    Some(PowerScheme {
        procfreqmax_ac: ac_value(&guid, "PROCFREQMAX"),
        procfreqmax1_ac: ac_value(&guid, "PROCFREQMAX1"),
        guid,
        name,
    })
}

fn ac_value(scheme: &str, setting: &str) -> Option<u32> {
    // `/qh`: the frequency caps are hidden settings, which `/q` leaves out.
    let out = Command::new("powercfg").args(["/qh", scheme, "SUB_PROCESSOR", setting]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().find(|l| l.contains("Current AC Power Setting Index"))?;
    let hex = line.rsplit_once("0x")?.1.trim();
    u32::from_str_radix(hex, 16).ok()
}

#[derive(Debug, Clone, Serialize)]
pub struct CpuFeatures {
    pub avx: bool,
    pub avx2: bool,
    pub avx512f: bool,
}

pub fn cpu_features() -> CpuFeatures {
    unsafe {
        CpuFeatures {
            avx: IsProcessorFeaturePresent(PF_AVX_INSTRUCTIONS_AVAILABLE).as_bool(),
            avx2: IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE).as_bool(),
            avx512f: IsProcessorFeaturePresent(PF_AVX512F_INSTRUCTIONS_AVAILABLE).as_bool(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct Memory {
    pub peak_working_set_bytes: u64,
    pub peak_private_bytes: u64,
}

/// Peak working set and peak private (commit) bytes of a process. Works on a process that has exited, as long as
/// the handle is still open.
pub fn process_memory(handle: HANDLE) -> Memory {
    let mut counters = PROCESS_MEMORY_COUNTERS_EX {
        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        ..Default::default()
    };
    let ok = unsafe {
        GetProcessMemoryInfo(
            handle,
            &mut counters as *mut PROCESS_MEMORY_COUNTERS_EX as *mut PROCESS_MEMORY_COUNTERS,
            counters.cb,
        )
    };
    if ok.is_err() {
        return Memory::default();
    }
    Memory {
        peak_working_set_bytes: counters.PeakWorkingSetSize as u64,
        peak_private_bytes: counters.PeakPagefileUsage as u64,
    }
}

pub struct Job {
    pub handle: HANDLE,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct JobPeaks {
    /// The most committed memory any one process in the job had.
    pub peak_process_commit_bytes: u64,
    /// The most committed memory of the whole job at once.
    pub peak_job_commit_bytes: u64,
}

impl Job {
    /// A job that pins every process in it to `affinity` (or leaves them unpinned with `None`), optionally limits
    /// each process's committed memory, and kills everything in it when the last handle closes (so nothing outlives
    /// pinrun).
    pub fn new(affinity: Option<usize>, memory_limit_bytes: Option<u64>) -> windows::core::Result<Job> {
        let handle = unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null())? };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Some(affinity) = affinity {
            info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_AFFINITY;
            info.BasicLimitInformation.Affinity = affinity;
        }
        if let Some(limit) = memory_limit_bytes {
            info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            info.ProcessMemoryLimit = limit as usize;
        }
        unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )?;
        }
        Ok(Job { handle })
    }

    /// A hard cap on the CPU time the whole job may use, as a share of all the machine's logical processors
    /// (Windows' unit), in hundredths of a percent.
    pub fn set_cpu_rate(&self, rate_hundredths: u32) -> windows::core::Result<()> {
        let mut info = JOBOBJECT_CPU_RATE_CONTROL_INFORMATION {
            ControlFlags: JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,
            ..Default::default()
        };
        info.Anonymous.CpuRate = rate_hundredths.clamp(1, 10_000);
        unsafe {
            SetInformationJobObject(
                self.handle,
                JobObjectCpuRateControlInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_CPU_RATE_CONTROL_INFORMATION>() as u32,
            )
        }
    }

    /// Puts this process in the job, so every child it starts is in it too.
    pub fn assign_self(&self) -> windows::core::Result<()> {
        unsafe { AssignProcessToJobObject(self.handle, GetCurrentProcess()) }
    }

    pub fn peaks(&self) -> JobPeaks {
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        let ok = unsafe {
            QueryInformationJobObject(
                Some(self.handle),
                JobObjectExtendedLimitInformation,
                &mut info as *mut _ as *mut core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                None,
            )
        };
        if ok.is_err() {
            return JobPeaks::default();
        }
        JobPeaks {
            peak_process_commit_bytes: info.PeakProcessMemoryUsed as u64,
            peak_job_commit_bytes: info.PeakJobMemoryUsed as u64,
        }
    }

    /// The CPU time every process in the job has used, ended ones included: (user, kernel) in seconds.
    pub fn cpu_seconds(&self) -> (f64, f64) {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        let ok = unsafe {
            QueryInformationJobObject(
                Some(self.handle),
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                None,
            )
        };
        if ok.is_err() {
            return (0.0, 0.0);
        }
        (info.TotalUserTime as f64 / 1e7, info.TotalKernelTime as f64 / 1e7)
    }

    pub fn pids(&self) -> Vec<u32> {
        job_pids(self.handle.0 as usize)
    }

    /// The handle as a plain number, for a sampler thread (HANDLE isn't Send). Valid while the Job lives.
    pub fn raw(&self) -> usize {
        self.handle.0 as usize
    }
}

/// The processes in a job, from its handle as a number (see `Job::raw`).
pub fn job_pids(raw_handle: usize) -> Vec<u32> {
    // Room for 256 processes, which is far more than any run here starts.
    const MAX: usize = 256;
    #[repr(C)]
    struct List {
        head: JOBOBJECT_BASIC_PROCESS_ID_LIST,
        rest: [usize; MAX - 1],
    }
    let mut list = List { head: JOBOBJECT_BASIC_PROCESS_ID_LIST::default(), rest: [0; MAX - 1] };
    let ok = unsafe {
        QueryInformationJobObject(
            Some(HANDLE(raw_handle as *mut core::ffi::c_void)),
            JobObjectBasicProcessIdList,
            &mut list as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<List>() as u32,
            None,
        )
    };
    if ok.is_err() {
        return Vec::new();
    }
    let n = list.head.NumberOfProcessIdsInList as usize;
    let ptr = list.head.ProcessIdList.as_ptr();
    (0..n.min(MAX)).map(|i| unsafe { *ptr.add(i) } as u32).collect()
}

impl Drop for Job {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.handle) };
    }
}
