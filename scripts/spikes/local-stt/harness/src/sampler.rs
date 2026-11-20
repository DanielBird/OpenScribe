//! Once a second, with PDH (Windows' performance counters): the clock of the pinned logical processors, how much any
//! GPU engine is used by the processes being measured, and (Phase 37) per graphics adapter, their engine use and GPU
//! memory. Reading counters changes nothing.

use serde::Serialize;
use std::collections::HashMap;
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
    /// Per graphics adapter (Phase 37), for the measured processes: which card was busy, and how much of its memory
    /// they held. Only adapters on which they used an engine or held memory are listed.
    pub gpu_adapters: Vec<GpuAdapter>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct GpuAdapter {
    /// As PDH names it ("0x00000000_0x00017912"); `vulkaninfo`'s `deviceLUID` is the same number, bytes reversed.
    pub luid: String,
    /// Each second, the busiest engine of this adapter (summed over the processes); then the max and the mean.
    pub engine_max_percent: f64,
    pub engine_mean_percent: f64,
    /// Engine types that showed use ("Compute_0", "3D", …).
    pub engine_types: Vec<String>,
    /// `GPU Process Memory(*)\Dedicated Usage` and `\Shared Usage`, summed over the processes; the peak.
    pub dedicated_peak_bytes: u64,
    pub shared_peak_bytes: u64,
}

/// "pid_1234_luid_0x00000000_0x0000C2A1_phys_0[_eng_0_engtype_3D]" → (1234, "0x00000000_0x0000C2A1", engine type).
fn parse_instance(name: &str) -> Option<(u32, String, Option<String>)> {
    let rest = name.strip_prefix("pid_")?;
    let (pid, rest) = rest.split_once('_')?;
    let rest = rest.strip_prefix("luid_")?;
    let mut parts = rest.splitn(3, '_');
    let luid = format!("{}_{}", parts.next()?, parts.next()?);
    let engtype = name.split_once("_engtype_").map(|(_, t)| t.to_string());
    Some((pid.parse().ok()?, luid, engtype))
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
    gpu_dedicated: Option<PDH_HCOUNTER>,
    gpu_shared: Option<PDH_HCOUNTER>,
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
    let gpu_dedicated = add(r"\GPU Process Memory(*)\Dedicated Usage");
    let gpu_shared = add(r"\GPU Process Memory(*)\Shared Usage");
    Some(Query { query, perf, freq, gpu, gpu_dedicated, gpu_shared })
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

#[derive(Default)]
struct AdapterAcc {
    engine_max_percent: f64,
    engine_sum: f64,
    engine_types: Vec<String>,
    dedicated_peak_bytes: u64,
    shared_peak_bytes: u64,
}

fn run(lps: Vec<u32>, pids: PidSource, stop: Arc<AtomicBool>, summary: Arc<Mutex<Summary>>) {
    let Some(q) = open() else { return };
    // Rate counters need two collections before the first value.
    unsafe { PdhCollectQueryData(q.query) };
    let (mut sum, mut n, mut min, mut max) = (0.0f64, 0u32, f64::MAX, 0.0f64);
    let mut gpu_max = 0.0f64;
    let mut engines: Vec<String> = Vec::new();
    let mut adapters: HashMap<String, AdapterAcc> = HashMap::new();
    let mut ticks = 0u32;
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
        let watched = pids();
        ticks += 1;
        // Per adapter this second: the busiest engine (summed over the watched processes), and memory summed.
        let mut engine_now: HashMap<(String, String), f64> = HashMap::new();
        let mut dedicated_now: HashMap<String, f64> = HashMap::new();
        let mut shared_now: HashMap<String, f64> = HashMap::new();
        for (counter, target) in [(q.gpu_dedicated, &mut dedicated_now), (q.gpu_shared, &mut shared_now)] {
            let Some(counter) = counter else { continue };
            for (name, value) in values(counter) {
                if let Some((pid, luid, _)) = parse_instance(&name)
                    && watched.contains(&pid)
                {
                    *target.entry(luid).or_default() += value;
                }
            }
        }
        if let Some(gpu) = q.gpu {
            for (name, value) in values(gpu) {
                if let Some((pid, luid, Some(engtype))) = parse_instance(&name)
                    && watched.contains(&pid)
                {
                    *engine_now.entry((luid, engtype)).or_default() += value;
                }
            }
        }
        let mut busiest: HashMap<String, f64> = HashMap::new();
        for ((luid, engtype), value) in &engine_now {
            let b = busiest.entry(luid.clone()).or_default();
            *b = b.max(*value);
            let acc = adapters.entry(luid.clone()).or_default();
            if *value > 0.0 && !acc.engine_types.contains(engtype) {
                acc.engine_types.push(engtype.clone());
            }
        }
        for (luid, value) in busiest {
            let acc = adapters.entry(luid).or_default();
            acc.engine_max_percent = acc.engine_max_percent.max(value);
            acc.engine_sum += value;
        }
        for (luid, value) in dedicated_now {
            let acc = adapters.entry(luid).or_default();
            acc.dedicated_peak_bytes = acc.dedicated_peak_bytes.max(value as u64);
        }
        for (luid, value) in shared_now {
            let acc = adapters.entry(luid).or_default();
            acc.shared_peak_bytes = acc.shared_peak_bytes.max(value as u64);
        }
        if let Some(gpu) = q.gpu {
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
            let mut list: Vec<GpuAdapter> = adapters
                .iter()
                .filter(|(_, a)| a.engine_max_percent > 0.0 || a.dedicated_peak_bytes > 0 || a.shared_peak_bytes > 0)
                .map(|(luid, a)| GpuAdapter {
                    luid: luid.clone(),
                    engine_max_percent: a.engine_max_percent,
                    engine_mean_percent: if ticks > 0 { a.engine_sum / ticks as f64 } else { 0.0 },
                    engine_types: a.engine_types.clone(),
                    dedicated_peak_bytes: a.dedicated_peak_bytes,
                    shared_peak_bytes: a.shared_peak_bytes,
                })
                .collect();
            list.sort_by(|a, b| a.luid.cmp(&b.luid));
            s.gpu_adapters = list;
        }
    }
    unsafe { PdhCloseQuery(q.query) };
}
