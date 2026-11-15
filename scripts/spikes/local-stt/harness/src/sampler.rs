//! Once a second, with PDH (Windows' performance counters): the clock of the pinned logical processors, and how
//! much any GPU engine is used by the processes being measured. Reading counters changes nothing.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use windows::Win32::System::Performance::{
    PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA, PdhAddEnglishCounterW,
    PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW,
};
use windows::core::HSTRING;

#[derive(Debug, Clone, Default, Serialize)]
pub struct Summary {
    pub samples: u32,
    /// Effective clock of the pinned logical processors: base frequency × `% Processor Performance`.
    pub clock_mean_mhz: Option<f64>,
    pub clock_min_mhz: Option<f64>,
    pub clock_max_mhz: Option<f64>,
    /// The highest `GPU Engine` utilisation seen for any of the measured processes, any engine, any GPU.
    pub gpu_max_percent: f64,
    /// Engine instances that showed any use (pid, adapter LUID, engine type), so a non-zero value can be explained.
    pub gpu_engines_used: Vec<String>,
}

pub struct Sampler {
    stop: Arc<AtomicBool>,
    summary: Arc<Mutex<Summary>>,
    thread: Option<JoinHandle<()>>,
}

type PidSource = Box<dyn Fn() -> Vec<u32> + Send>;

impl Sampler {
    /// `lps`: the logical processors whose clock to record. `pids`: called each second for the processes to watch.
    pub fn start(lps: Vec<u32>, pids: PidSource) -> Sampler {
        let stop = Arc::new(AtomicBool::new(false));
        let summary = Arc::new(Mutex::new(Summary::default()));
        let (stop2, summary2) = (Arc::clone(&stop), Arc::clone(&summary));
        let thread = std::thread::spawn(move || run(lps, pids, stop2, summary2));
        Sampler { stop, summary, thread: Some(thread) }
    }

    pub fn finish(mut self) -> Summary {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        self.summary.lock().map(|s| s.clone()).unwrap_or_default()
    }
}

struct Query {
    query: PDH_HQUERY,
    perf: PDH_HCOUNTER,
    freq: PDH_HCOUNTER,
    gpu: Option<PDH_HCOUNTER>,
}

fn open() -> Option<Query> {
    let mut query = PDH_HQUERY::default();
    if unsafe { PdhOpenQueryW(windows::core::PCWSTR::null(), 0, &mut query) } != 0 {
        return None;
    }
    let add = |path: &str| -> Option<PDH_HCOUNTER> {
        let mut counter = PDH_HCOUNTER::default();
        let status = unsafe { PdhAddEnglishCounterW(query, &HSTRING::from(path), 0, &mut counter) };
        (status == 0).then_some(counter)
    };
    let perf = add(r"\Processor Information(*)\% Processor Performance")?;
    let freq = add(r"\Processor Information(*)\Processor Frequency")?;
    // Missing on a PC without the GPU counters: then GPU use is reported as 0 with no engines.
    let gpu = add(r"\GPU Engine(*)\Utilization Percentage");
    Some(Query { query, perf, freq, gpu })
}

fn values(counter: PDH_HCOUNTER) -> Vec<(String, f64)> {
    let (mut size, mut count) = (0u32, 0u32);
    let status = unsafe { PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, None) };
    if status != PDH_MORE_DATA || size == 0 {
        return Vec::new();
    }
    // The buffer holds the items followed by their name strings; allocate it as u64s for alignment.
    let mut buf = vec![0u64; (size as usize).div_ceil(8) + 1];
    let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
    let status = unsafe { PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items)) };
    if status != 0 {
        return Vec::new();
    }
    (0..count as usize)
        .filter_map(|i| {
            let item = unsafe { &*items.add(i) };
            if item.FmtValue.CStatus != 0 {
                return None;
            }
            let name = unsafe { item.szName.to_string() }.ok()?;
            Some((name, unsafe { item.FmtValue.Anonymous.doubleValue }))
        })
        .collect()
}

fn run(lps: Vec<u32>, pids: PidSource, stop: Arc<AtomicBool>, summary: Arc<Mutex<Summary>>) {
    let Some(q) = open() else { return };
    // Rate counters need two collections before the first value.
    unsafe { PdhCollectQueryData(q.query) };
    let (mut sum, mut n, mut min, mut max) = (0.0f64, 0u32, f64::MAX, 0.0f64);
    let mut gpu_max = 0.0f64;
    let mut engines: Vec<String> = Vec::new();
    while !stop.load(Ordering::SeqCst) {
        // Sleep in small steps so finish() doesn't wait a whole second.
        for _ in 0..10 {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        if unsafe { PdhCollectQueryData(q.query) } != 0 {
            continue;
        }
        let perf = values(q.perf);
        let freq = values(q.freq);
        let mut clocks = Vec::new();
        for lp in &lps {
            let name = format!("0,{lp}");
            let p = perf.iter().find(|(n, _)| *n == name).map(|(_, v)| *v);
            let f = freq.iter().find(|(n, _)| *n == name).map(|(_, v)| *v);
            if let (Some(p), Some(f)) = (p, f) {
                clocks.push(f * p / 100.0);
            }
        }
        if !clocks.is_empty() {
            let mean = clocks.iter().sum::<f64>() / clocks.len() as f64;
            sum += mean;
            n += 1;
            min = min.min(mean);
            max = max.max(mean);
        }
        if let Some(gpu) = q.gpu {
            let watched = pids();
            for (name, value) in values(gpu) {
                // "pid_1234_luid_0x00000000_0x0000C2A1_phys_0_eng_0_engtype_3D"
                let pid = name
                    .strip_prefix("pid_")
                    .and_then(|rest| rest.split('_').next())
                    .and_then(|p| p.parse::<u32>().ok());
                if pid.is_some_and(|p| watched.contains(&p)) {
                    gpu_max = gpu_max.max(value);
                    if value > 0.0 && !engines.contains(&name) {
                        engines.push(name);
                    }
                }
            }
        }
        if let Ok(mut s) = summary.lock() {
            s.samples = n;
            if n > 0 {
                s.clock_mean_mhz = Some((sum / n as f64).round());
                s.clock_min_mhz = Some(min.round());
                s.clock_max_mhz = Some(max.round());
            }
            s.gpu_max_percent = gpu_max;
            s.gpu_engines_used = engines.clone();
        }
    }
    unsafe { PdhCloseQuery(q.query) };
}
