//! Starting the worker process and listening to it (DECISIONS.md D51, D53).
//!
//! The worker is this exe again, with `--stt-worker`. It runs in a job object that kills it if the app ends, so it can
//! never outlive the window. Cancel ends the job, which frees all the engine's memory at once (Phase 33: 50 ms).
//! Its peak memory is read through its process handle after it exits.

use super::error::{SttError, SttErrorKind, without_path};
use super::protocol::{Event, Job, WORKER_FLAG, WorkerResult};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Arc, Mutex};

/// The last lines of the engine's own logging, kept for a crash's detail.
const STDERR_LINES: usize = 12;

/// One running worker, as cancel sees it.
#[derive(Default)]
pub struct Running {
  cancelled: AtomicBool,
  /// The job object's handle, while the worker runs (0 before and after).
  job: AtomicIsize,
}

impl Running {
  /// Ends the worker, if it is running, and marks the run cancelled.
  pub fn cancel(&self) {
    self.cancelled.store(true, Ordering::SeqCst);
    #[cfg(windows)]
    {
      let job = self.job.load(Ordering::SeqCst);
      if job != 0 {
        // SAFETY: the handle stays open until `run` has finished with the job, after which it is set to 0 first.
        unsafe {
          let _ = windows::Win32::System::JobObjects::TerminateJobObject(
            windows::Win32::Foundation::HANDLE(job as *mut core::ffi::c_void),
            1,
          );
        }
      }
    }
  }

  pub fn is_cancelled(&self) -> bool {
    self.cancelled.load(Ordering::SeqCst)
  }
}

/// What a finished worker gave.
pub struct Outcome {
  pub result: WorkerResult,
  pub peak_memory_bytes: Option<u64>,
}

/// Runs `job` in a worker, calling `on_event` for each `Started` and `Progress` event. Blocks until the worker exits.
pub fn run(job: &Job, running: &Running, mut on_event: impl FnMut(&Event)) -> Result<Outcome, SttError> {
  let exe = std::env::current_exe().map_err(|e| SttError::new(SttErrorKind::Engine, format!("finding the app: {e}")))?;
  let mut command = Command::new(exe);
  command.arg(WORKER_FLAG).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }
  if running.is_cancelled() {
    return Err(SttError::new(SttErrorKind::Cancelled, "cancelled before the engine started"));
  }
  let mut child =
    command.spawn().map_err(|e| SttError::new(SttErrorKind::Engine, format!("starting the engine: {e}")))?;
  #[cfg(windows)]
  let job_object = native::JobObject::for_child(&child);
  #[cfg(windows)]
  if let Some(object) = &job_object {
    running.job.store(object.raw(), Ordering::SeqCst);
  }
  if running.is_cancelled() {
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

  let mut outcome: Option<Result<WorkerResult, SttError>> = None;
  if let Some(stdout) = child.stdout.take() {
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
      match Event::from_line(&line) {
        Some(Event::Done(result)) => outcome = Some(Ok(result)),
        Some(Event::Failed { kind, detail }) => outcome = Some(Err(SttError::new(kind, detail))),
        Some(event) => on_event(&event),
        None => {}
      }
    }
  }
  let status = child.wait();
  #[cfg(windows)]
  let peak = native::peak_working_set(&child);
  #[cfg(not(windows))]
  let peak = None;
  running.job.store(0, Ordering::SeqCst);
  #[cfg(windows)]
  drop(job_object);
  if let Some(thread) = stderr_thread {
    let _ = thread.join();
  }

  if running.is_cancelled() {
    return Err(SttError::new(SttErrorKind::Cancelled, "cancelled"));
  }
  match outcome {
    Some(Ok(result)) => Ok(Outcome { result, peak_memory_bytes: peak }),
    Some(Err(error)) => Err(error),
    None => {
      let code = status.ok().and_then(|s| s.code());
      let tail = stderr_tail.lock().map(|t| t.join("\n")).unwrap_or_default();
      Err(crashed(code, &tail, &job.recording))
    }
  }
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
  use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};

  /// A job object that kills its processes when it is closed: when the run ends, or the app does.
  pub struct JobObject(HANDLE);

  // SAFETY: a kernel handle, used from one thread at a time (terminate is safe from any thread).
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

    pub fn raw(&self) -> isize {
      self.0.0 as isize
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
}
