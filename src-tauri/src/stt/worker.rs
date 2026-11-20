//! Starting the worker process and listening to it (DECISIONS.md D51, D53).
//!
//! The worker is this exe again, with `--stt-worker`. It runs in a job object that kills it if the app ends, so it can
//! never outlive the window. Cancel ends the job, which frees all the engine's memory at once (Phase 33: 50 ms).
//! Where the job object can't be made, Cancel ends the process instead, and the worker ends itself once its pipe to
//! the app is gone (`run.rs`). Its peak memory is read through its process handle after it exits.

use super::error::{SttError, SttErrorKind, without_path};
use super::protocol::{DEVICES_FLAG, Event, GpuDevice, Job, WORKER_FLAG, WorkerResult};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// The last lines of the engine's own logging, kept for a crash's detail.
const STDERR_LINES: usize = 12;

/// How long the Vulkan engine may take to list the graphics cards (Phase 37, decision 2): the probe, and a run on a
/// card until its worker says whether the card is there (audit GPU-2). Listing took 0.23–0.44 s on the maintainer's
/// PC.
pub const LISTING_TIMEOUT: Duration = Duration::from_secs(15);

/// Listing the graphics cards took longer than `LISTING_TIMEOUT`: a driver that hangs while listing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListingHung;

/// One running worker, as cancel sees it.
#[derive(Default)]
pub struct Running {
  cancelled: AtomicBool,
  /// What ends the worker, while it runs (`None` before and after). Used and dropped only under the lock, so a cancel
  /// never uses a handle that `run` has closed.
  stopper: Mutex<Option<Stopper>>,
}

impl Running {
  /// Ends the worker, if it is running, and marks the run cancelled.
  pub fn cancel(&self) {
    self.cancelled.store(true, Ordering::SeqCst);
    self.end();
  }

  /// Ends the worker, if it is running, without marking the run cancelled.
  fn end(&self) {
    if let Some(stopper) = &*self.stopper() {
      stopper.stop();
    }
  }

  pub fn is_cancelled(&self) -> bool {
    self.cancelled.load(Ordering::SeqCst)
  }

  fn stopper(&self) -> MutexGuard<'_, Option<Stopper>> {
    self.stopper.lock().unwrap_or_else(|e| e.into_inner())
  }

  /// Keeps `stopper` for a cancel, and uses it at once if a cancel came first. Returns whether there is one.
  fn hold(&self, stopper: Option<Stopper>) -> bool {
    let mut held = self.stopper();
    *held = stopper;
    if self.is_cancelled()
      && let Some(stopper) = &*held
    {
      stopper.stop();
    }
    held.is_some()
  }

  /// Lets go of the stopper, closing its handle while no cancel can be using it.
  fn release(&self) {
    let mut held = self.stopper();
    drop(held.take());
  }
}

/// How a cancel ends the worker: its job object, or, where that couldn't be made, its process.
#[cfg(windows)]
enum Stopper {
  Job(native::JobObject),
  Process(std::os::windows::io::OwnedHandle),
}

#[cfg(windows)]
impl Stopper {
  fn for_child(child: &std::process::Child) -> Option<Self> {
    use std::os::windows::io::AsHandle;
    native::JobObject::for_child(child)
      .map(Self::Job)
      .or_else(|| child.as_handle().try_clone_to_owned().ok().map(Self::Process))
  }

  fn stop(&self) {
    match self {
      Self::Job(job) => job.terminate(),
      Self::Process(process) => native::terminate_process(process),
    }
  }
}

/// Elsewhere there's nothing to end the worker with (the app is Windows-only).
#[cfg(not(windows))]
struct Stopper;

#[cfg(not(windows))]
impl Stopper {
  fn for_child(_child: &std::process::Child) -> Option<Self> {
    None
  }

  fn stop(&self) {}
}

/// What a finished worker gave.
#[derive(Debug)]
pub struct Outcome {
  pub result: WorkerResult,
  pub peak_memory_bytes: Option<u64>,
}

/// How a worker that said why it stopped ended.
#[derive(Debug)]
pub enum Finished {
  Done(Outcome),
  /// The job's card isn't there (Phase 37, decision 5): nothing was done, and the job can run on the processor.
  /// `reason` is the worker's, for the run's record (audit GPU-3).
  DeviceMissing { reason: String },
  /// Listing the cards hung (audit GPU-2): the worker was ended without being waited for, nothing was done, and the
  /// job can run on the processor, as for a missing card.
  ListingHung,
}

/// How the worker's events ended, before its peak memory is read.
#[derive(Debug)]
enum Ending {
  Done(WorkerResult),
  DeviceMissing(String),
  ListingHung,
}

/// This exe as a worker, with no window: `--stt-worker` and `args`.
fn worker_command(args: &[&std::ffi::OsStr]) -> Result<Command, SttError> {
  let exe = std::env::current_exe().map_err(|e| SttError::new(SttErrorKind::Engine, format!("finding the app: {e}")))?;
  let mut command = Command::new(exe);
  command.arg(WORKER_FLAG).args(args);
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }
  Ok(command)
}

/// The graphics cards the engine in `runtime_dir` finds (Phase 37, decision 2), listed by a worker so that a driver
/// that crashes or hangs can't take the app with it. Empty if the engine won't load, finds no card, or the worker
/// fails; `ListingHung` if it hasn't answered within `timeout`, and it is ended.
pub fn devices(runtime_dir: &Path, timeout: Duration) -> Result<Vec<GpuDevice>, ListingHung> {
  let Ok(mut command) = worker_command(&[DEVICES_FLAG.as_ref(), runtime_dir.as_os_str()]) else {
    return Ok(Vec::new());
  };
  command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
  let Ok(mut child) = command.spawn() else { return Ok(Vec::new()) };
  let stopper = Stopper::for_child(&child);
  let (found, listed) = std::sync::mpsc::sync_channel(1);
  if let Some(stdout) = child.stdout.take() {
    std::thread::spawn(move || {
      let _ = found.send(devices_in(stdout));
    });
  }
  let devices = match listed.recv_timeout(timeout) {
    Ok(devices) => Ok(devices),
    Err(RecvTimeoutError::Timeout) => Err(ListingHung),
    Err(RecvTimeoutError::Disconnected) => Ok(Vec::new()),
  };
  // Done, or not answering: end it either way. Not waited for, since a driver that hangs might not let it end.
  match &stopper {
    Some(stopper) => stopper.stop(),
    None => _ = child.kill(),
  }
  devices
}

/// The `Devices` line among the probe's output.
fn devices_in(stdout: impl std::io::Read) -> Vec<GpuDevice> {
  BufReader::new(stdout)
    .lines()
    .map_while(Result::ok)
    .find_map(|line| match Event::from_line(&line) {
      Some(Event::Devices { devices }) => Some(devices),
      _ => None,
    })
    .unwrap_or_default()
}

/// Runs `job` in a worker, calling `on_event` for each `Started` and `Progress` event. Blocks until the worker exits,
/// except when listing the job's card hangs (audit GPU-2): that worker is ended and not waited for, as the probe isn't.
pub fn run(job: &Job, running: &Running, mut on_event: impl FnMut(&Event)) -> Result<Finished, SttError> {
  let mut command = worker_command(&[])?;
  command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
  if running.is_cancelled() {
    return Err(SttError::new(SttErrorKind::Cancelled, "cancelled before the engine started"));
  }
  let mut child =
    command.spawn().map_err(|e| SttError::new(SttErrorKind::Engine, format!("starting the engine: {e}")))?;
  if !running.hold(Stopper::for_child(&child)) && running.is_cancelled() {
    let _ = child.kill();
  }

  let line = serde_json::to_string(job).unwrap_or_default();
  if let Some(mut stdin) = child.stdin.take() {
    let _ = writeln!(stdin, "{line}");
  }
  let stderr_tail = Arc::new(Mutex::new(Vec::<String>::new()));
  let stderr_thread = child.stderr.take().map(|stderr| {
    let tail = Arc::clone(&stderr_tail);
    std::thread::spawn(move || {
      for line in BufReader::new(stderr).lines().map_while(Result::ok) {
        let mut tail = tail.lock().unwrap_or_else(|e| e.into_inner());
        tail.push(line);
        let excess = tail.len().saturating_sub(STDERR_LINES);
        tail.drain(..excess);
      }
    })
  });

  // Only a run on a card lists the cards, and only that has a deadline, until the worker says the card is there.
  let deadline = job.device.as_ref().map(|_| Instant::now() + LISTING_TIMEOUT);
  let outcome = child.stdout.take().and_then(|stdout| read_events(&lines_of(stdout), running, deadline, &mut on_event));
  if let Some(Ok(Ending::ListingHung)) = outcome {
    // Ended, but a driver that hangs might not let it end: neither it nor its stderr is waited for. Its job object is
    // closed with the stopper, which ends it again if it can.
    running.release();
    drop(stderr_thread);
    drop(child);
    if running.is_cancelled() {
      return Err(SttError::new(SttErrorKind::Cancelled, "cancelled"));
    }
    return Ok(Finished::ListingHung);
  }
  let status = child.wait();
  #[cfg(windows)]
  let peak = native::peak_working_set(&child);
  #[cfg(not(windows))]
  let peak = None;
  running.release();
  if let Some(thread) = stderr_thread {
    let _ = thread.join();
  }

  if running.is_cancelled() {
    return Err(SttError::new(SttErrorKind::Cancelled, "cancelled"));
  }
  match outcome {
    Some(Ok(Ending::Done(result))) => Ok(Finished::Done(Outcome { result, peak_memory_bytes: peak })),
    Some(Ok(Ending::DeviceMissing(reason))) => Ok(Finished::DeviceMissing { reason }),
    Some(Ok(Ending::ListingHung)) => Ok(Finished::ListingHung),
    Some(Err(error)) => Err(error),
    None => {
      let code = status.ok().and_then(|s| s.code());
      let tail = stderr_tail.lock().map(|t| t.join("\n")).unwrap_or_default();
      let error = crashed(code, &tail, &job.recording);
      Err(if job.device.is_some() { on_a_card(error) } else { error })
    }
  }
}

/// A worker that died during a run on a card, as the page is told it (Phase 37, decision 6): a driver reset ends it,
/// so the engine's crash and out of memory are the card's, with the engine's detail (D41). The rest stays as it is.
/// Only for a crash: the worker says itself which of its failures are the card's (`run.rs`), and the app's own, such as
/// starting the worker, never are (audit GPU-1).
pub fn on_a_card(error: SttError) -> SttError {
  match error.kind {
    SttErrorKind::Engine | SttErrorKind::OutOfMemory => SttError { kind: SttErrorKind::Gpu, ..error },
    _ => error,
  }
}

/// The worker's stdout, line by line, read on a thread of its own so that `read_events` can stop waiting for it.
fn lines_of(stdout: impl std::io::Read + Send + 'static) -> Receiver<String> {
  let (tx, lines) = std::sync::mpsc::channel();
  std::thread::spawn(move || {
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
      if tx.send(line).is_err() {
        break;
      }
    }
  });
  lines
}

/// Reads the worker's events until its stdout closes, calling `on_event` for each `Started` and `Progress` event.
/// Returns how the run ended, if the worker said. On `Failed` it ends the worker at once: the worker would otherwise
/// exit only once its other threads have worked through their queues (`run.rs`). `DeviceMissing` ends it too.
///
/// With a `deadline`, the worker must say `DeviceFound` (or `DeviceMissing`) by then. If it hasn't, listing the cards
/// has hung: the worker is ended, and the run ends with `ListingHung` without waiting for its stdout (audit GPU-2).
fn read_events(
  lines: &Receiver<String>,
  running: &Running,
  mut deadline: Option<Instant>,
  mut on_event: impl FnMut(&Event),
) -> Option<Result<Ending, SttError>> {
  let mut outcome = None;
  loop {
    let line = match deadline {
      None => match lines.recv() {
        Ok(line) => line,
        Err(_) => break,
      },
      Some(at) => match lines.recv_timeout(at.saturating_duration_since(Instant::now())) {
        Ok(line) => line,
        Err(RecvTimeoutError::Timeout) => {
          running.end();
          return Some(Ok(Ending::ListingHung));
        }
        Err(RecvTimeoutError::Disconnected) => break,
      },
    };
    match Event::from_line(&line) {
      Some(Event::DeviceFound) => deadline = None,
      Some(Event::Done(result)) => outcome = Some(Ok(Ending::Done(result))),
      Some(Event::Failed { kind, detail }) => {
        running.end();
        return Some(Err(SttError::new(kind, detail)));
      }
      Some(Event::DeviceMissing { reason }) => {
        running.end();
        return Some(Ok(Ending::DeviceMissing(reason)));
      }
      Some(event) => on_event(&event),
      None => {}
    }
  }
  outcome
}

/// The error for a worker that exited without saying why.
pub fn crashed(code: Option<i32>, stderr_tail: &str, recording: &std::path::Path) -> SttError {
  const STATUS_NO_MEMORY: i32 = 0xC000_0017_u32 as i32;
  const STATUS_ILLEGAL_INSTRUCTION: i32 = 0xC000_001D_u32 as i32;
  let kind = match code {
    Some(STATUS_NO_MEMORY) => SttErrorKind::OutOfMemory,
    Some(STATUS_ILLEGAL_INSTRUCTION) => SttErrorKind::Cpu,
    _ => SttErrorKind::Engine,
  };
  let exit = code.map(|c| format!("0x{:08X}", c as u32)).unwrap_or_else(|| "none".into());
  let detail = format!("the engine stopped unexpectedly (exit code {exit})\n{}", stderr_tail.trim());
  SttError::new(kind, without_path(detail.trim(), recording, "<recording>"))
}

#[cfg(windows)]
mod native {
  use std::os::windows::io::AsRawHandle;
  use windows::Win32::Foundation::{CloseHandle, HANDLE};
  use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectExtendedLimitInformation, SetInformationJobObject,
  };
  use windows::Win32::System::JobObjects::TerminateJobObject;
  use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
  use windows::Win32::System::Threading::TerminateProcess;

  /// A job object that kills its processes when it is closed: when the run ends, or the app does.
  pub struct JobObject(HANDLE);

  // SAFETY: a kernel handle, owned by this value and closed once in Drop; terminating it is safe from any thread.
  unsafe impl Send for JobObject {}

  impl JobObject {
    pub fn for_child(child: &std::process::Child) -> Option<Self> {
      // SAFETY: plain Win32 calls; the handle is closed in Drop.
      unsafe {
        let job = CreateJobObjectW(None, None).ok()?;
        let object = Self(job);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
          job,
          JobObjectExtendedLimitInformation,
          &limits as *const _ as *const core::ffi::c_void,
          size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .ok()?;
        AssignProcessToJobObject(job, HANDLE(child.as_raw_handle())).ok()?;
        Some(object)
      }
    }

    /// Ends every process in the job.
    pub fn terminate(&self) {
      // SAFETY: the handle is open for as long as `self` lives.
      unsafe {
        let _ = TerminateJobObject(self.0, 1);
      }
    }
  }

  /// Ends the process `process` is a handle to. One that has already exited is left as it is.
  pub fn terminate_process(process: &std::os::windows::io::OwnedHandle) {
    // SAFETY: the handle is open for as long as `process` lives, and a process's handle stays valid after it exits.
    unsafe {
      let _ = TerminateProcess(HANDLE(process.as_raw_handle()), 1);
    }
  }

  impl Drop for JobObject {
    fn drop(&mut self) {
      // SAFETY: opened in for_child, closed once.
      unsafe {
        let _ = CloseHandle(self.0);
      }
    }
  }

  /// The most memory the process ever had in RAM, readable after it exits while its handle is open.
  pub fn peak_working_set(child: &std::process::Child) -> Option<u64> {
    let mut counters = PROCESS_MEMORY_COUNTERS { cb: size_of::<PROCESS_MEMORY_COUNTERS>() as u32, ..Default::default() };
    // SAFETY: the child's handle is open until the Child is dropped.
    unsafe { GetProcessMemoryInfo(HANDLE(child.as_raw_handle()), &mut counters, counters.cb) }
      .ok()
      .map(|_| counters.PeakWorkingSetSize as u64)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_crash_says_how_the_engine_ended() {
    let recording = std::path::Path::new(r"D:\x\P01.m4a");
    let error = crashed(Some(0xC000_0017_u32 as i32), r"loading D:\x\P01.m4a", recording);
    assert_eq!(error.kind, SttErrorKind::OutOfMemory);
    assert!(error.detail.contains("0xC0000017") && error.detail.contains("<recording>"));
    assert!(!error.detail.contains("P01"));
    assert_eq!(crashed(Some(0xC000_001D_u32 as i32), "", recording).kind, SttErrorKind::Cpu);
    assert_eq!(crashed(Some(-1073740791), "", recording).kind, SttErrorKind::Engine);
    assert_eq!(crashed(None, "", recording).kind, SttErrorKind::Engine);
  }

  #[test]
  fn a_crash_on_a_card_is_the_cards() {
    let recording = std::path::Path::new("a.m4a");
    let crash = crashed(Some(0xC000_0409_u32 as i32), "vkCreateFence: Invalid device", recording);
    let error = on_a_card(crash.clone());
    assert_eq!((error.kind, error.detail), (SttErrorKind::Gpu, crash.detail), "a worker that dies on a card");
    assert_eq!(on_a_card(crashed(Some(0xC000_0017_u32 as i32), "", recording)).kind, SttErrorKind::Gpu);
    assert_eq!(on_a_card(crashed(Some(0xC000_001D_u32 as i32), "", recording)).kind, SttErrorKind::Cpu);
    for kind in [SttErrorKind::Unreadable, SttErrorKind::Cancelled, SttErrorKind::Gpu] {
      assert_eq!(on_a_card(SttError::new(kind, "x")).kind, kind);
    }
  }

  /// The worker's stdout carrying `events`, one per line, through the same reader as a run's.
  fn stdout_of(events: &[Event]) -> Receiver<String> {
    lines_of(std::io::Cursor::new(events.iter().map(|e| e.to_line() + "\n").collect::<String>().into_bytes()))
  }

  fn result() -> WorkerResult {
    use super::super::protocol::Timings;
    let timings =
      Timings { decode_sec: 0.0, words_sec: 0.0, speakers_sec: 0.0, total_sec: 0.0, threads: None, device: None };
    WorkerResult { language: None, duration_sec: 1.0, words: vec![], speaker_segments: vec![], timings }
  }

  /// A worker that says `events` after `pause`, then exits.
  fn says_after(pause: Duration, events: Vec<Event>) -> Receiver<String> {
    let (tx, lines) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
      std::thread::sleep(pause);
      for event in events {
        let _ = tx.send(event.to_line());
      }
    });
    lines
  }

  /// Audit GPU-2: a driver that hangs while listing the cards ends the run on a card at the deadline, without waiting
  /// for the worker's stdout to close.
  #[test]
  fn a_card_that_takes_too_long_to_list_ends_the_run() {
    let (_still_open, lines) = std::sync::mpsc::channel::<String>();
    let running = Running::default();
    let started = Instant::now();
    let mut seen = 0;
    let outcome = read_events(&lines, &running, Some(Instant::now() + Duration::from_millis(50)), |_| seen += 1);
    assert!(matches!(outcome, Some(Ok(Ending::ListingHung))), "{outcome:?}");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(seen, 0);
    assert!(!running.is_cancelled());
  }

  #[test]
  fn once_the_card_is_found_the_run_has_no_deadline() {
    let running = Running::default();
    let events = vec![Event::DeviceFound, Event::Started { duration_sec: None }];
    let (tx, lines) = std::sync::mpsc::channel();
    for event in events {
      tx.send(event.to_line()).unwrap();
    }
    std::thread::spawn(move || {
      std::thread::sleep(Duration::from_millis(300));
      let _ = tx.send(Event::Done(result()).to_line());
    });
    let mut seen = Vec::new();
    let outcome =
      read_events(&lines, &running, Some(Instant::now() + Duration::from_millis(50)), |e| seen.push(e.clone()));
    assert!(matches!(outcome, Some(Ok(Ending::Done(_)))), "{outcome:?}");
    assert_eq!(seen, vec![Event::Started { duration_sec: None }], "device-found isn't passed on");
  }

  #[test]
  fn a_card_found_missing_before_the_deadline_is_missing() {
    let lines = says_after(Duration::from_millis(20), vec![Event::DeviceMissing { reason: "x".into() }]);
    let outcome = read_events(&lines, &Running::default(), Some(Instant::now() + Duration::from_secs(5)), |_| {});
    assert!(matches!(outcome, Some(Ok(Ending::DeviceMissing(_)))), "{outcome:?}");
  }

  #[test]
  fn a_run_on_the_processor_has_no_deadline() {
    let events = vec![Event::Started { duration_sec: None }, Event::Done(result())];
    let lines = says_after(Duration::from_millis(200), events);
    assert!(matches!(read_events(&lines, &Running::default(), None, |_| {}), Some(Ok(Ending::Done(_)))));
    // A worker that dies before its card is listed is a crash, not a hang.
    let lines = says_after(Duration::from_millis(20), vec![]);
    assert!(read_events(&lines, &Running::default(), Some(Instant::now() + Duration::from_secs(5)), |_| {}).is_none());
  }

  #[test]
  fn the_probe_reads_its_one_line_among_the_engines_logging() {
    use super::super::protocol::GpuKind;
    let card = GpuDevice { name: "AMD Radeon 740M Graphics".into(), kind: GpuKind::IntegratedGpu, memory_bytes: 1 };
    let out = format!("ggml_vulkan: Found 1 Vulkan devices\n{}\n", Event::Devices { devices: vec![card.clone()] }.to_line());
    assert_eq!(devices_in(out.as_bytes()), vec![card]);
    assert_eq!(devices_in("ggml_vulkan: no devices\n".as_bytes()), vec![]);
    assert_eq!(devices_in(&b""[..]), vec![]);
  }

  #[cfg(windows)]
  mod stopping {
    use super::super::*;
    use super::stdout_of;
    use std::os::windows::io::AsHandle;
    use std::process::{Child, ExitStatus};
    use std::time::{Duration, Instant};

    /// A process that would run for half a minute.
    fn long_child() -> Child {
      Command::new("ping")
        .args(["-n", "30", "127.0.0.1"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
    }

    fn its_process(child: &Child) -> Option<Stopper> {
      Some(Stopper::Process(child.as_handle().try_clone_to_owned().unwrap()))
    }

    fn ended_within(child: &mut Child, wait: Duration) -> Option<ExitStatus> {
      let start = Instant::now();
      while start.elapsed() < wait {
        if let Some(status) = child.try_wait().unwrap() {
          return Some(status);
        }
        std::thread::sleep(Duration::from_millis(20));
      }
      None
    }

    #[test]
    fn cancel_ends_a_worker_through_its_job() {
      let mut child = long_child();
      let running = Running::default();
      let stopper = Stopper::for_child(&child);
      assert!(matches!(stopper, Some(Stopper::Job(_))));
      running.hold(stopper);
      running.cancel();
      assert_eq!(ended_within(&mut child, Duration::from_secs(5)).expect("still running").code(), Some(1));
      running.release();
    }

    #[test]
    fn without_a_job_cancel_ends_the_process() {
      let mut child = long_child();
      let running = Running::default();
      assert!(running.hold(its_process(&child)));
      assert!(child.try_wait().unwrap().is_none());
      running.cancel();
      assert_eq!(ended_within(&mut child, Duration::from_secs(5)).expect("still running").code(), Some(1));
      running.release();
    }

    #[test]
    fn a_cancel_before_the_worker_is_held_ends_it_when_it_is() {
      let mut child = long_child();
      let running = Running::default();
      running.cancel();
      running.hold(its_process(&child));
      assert!(ended_within(&mut child, Duration::from_secs(5)).is_some());
      running.release();
    }

    /// Audit DES-4: the worker's other threads would keep it running after a failure, so reading one ends it.
    #[test]
    fn a_failure_ends_the_worker_at_once() {
      let mut child = long_child();
      let running = Running::default();
      running.hold(its_process(&child));
      let stdout = stdout_of(&[
        Event::Started { duration_sec: Some(60.0) },
        Event::Progress { done_sec: 5.0 },
        Event::Failed { kind: SttErrorKind::Unreadable, detail: "x".into() },
      ]);
      let mut seen = 0;
      let outcome = read_events(&stdout, &running, None, |_| seen += 1);
      assert!(matches!(outcome, Some(Err(SttError { kind: SttErrorKind::Unreadable, .. }))));
      assert_eq!(seen, 2);
      assert!(ended_within(&mut child, Duration::from_secs(5)).is_some());
      assert!(!running.is_cancelled());
      running.release();
    }

    /// Phase 37, decision 5: the card isn't there, so the worker has nothing to do; the app runs the job again on the
    /// processor.
    #[test]
    fn a_missing_card_ends_the_worker_at_once() {
      let mut child = long_child();
      let running = Running::default();
      running.hold(its_process(&child));
      let reason = "the Vulkan engine found no graphics card";
      let stdout = stdout_of(&[Event::DeviceMissing { reason: reason.into() }, Event::Started { duration_sec: None }]);
      let mut seen = 0;
      let outcome = read_events(&stdout, &running, None, |_| seen += 1);
      assert!(matches!(&outcome, Some(Ok(Ending::DeviceMissing(r))) if r == reason), "audit GPU-3: {outcome:?}");
      assert_eq!(seen, 0);
      assert!(ended_within(&mut child, Duration::from_secs(5)).is_some());
      assert!(!running.is_cancelled());
      running.release();
    }

    /// Audit GPU-2: the worker that hangs while listing is ended, though the run doesn't wait for it.
    #[test]
    fn a_hang_while_listing_ends_the_worker() {
      let mut child = long_child();
      let running = Running::default();
      running.hold(its_process(&child));
      let (_still_open, lines) = std::sync::mpsc::channel::<String>();
      let outcome = read_events(&lines, &running, Some(Instant::now() + Duration::from_millis(50)), |_| {});
      assert!(matches!(outcome, Some(Ok(Ending::ListingHung))), "{outcome:?}");
      assert!(ended_within(&mut child, Duration::from_secs(5)).is_some());
      assert!(!running.is_cancelled());
      running.release();
    }

    #[test]
    fn progress_leaves_the_worker_running() {
      let mut child = long_child();
      let running = Running::default();
      running.hold(its_process(&child));
      let stdout = stdout_of(&[Event::Started { duration_sec: None }, Event::Progress { done_sec: 1.0 }]);
      assert!(read_events(&stdout, &running, None, |_| {}).is_none());
      assert!(ended_within(&mut child, Duration::from_millis(300)).is_none());
      running.release();
      let _ = child.kill();
      let _ = child.wait();
    }

    #[test]
    fn once_let_go_a_cancel_only_marks_the_run() {
      let mut child = long_child();
      let running = Running::default();
      running.hold(its_process(&child));
      running.release();
      running.cancel();
      assert!(running.is_cancelled());
      assert!(ended_within(&mut child, Duration::from_millis(300)).is_none());
      let _ = child.kill();
      let _ = child.wait();
    }
  }
}
