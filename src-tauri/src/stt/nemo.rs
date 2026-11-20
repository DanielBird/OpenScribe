//! NVIDIA's NeMo-Speech.cpp v0.3.0 through its C API (`nemo_speech/asr.h`, `diar.h`; DECISIONS.md D51), loaded from
//! the runtime folder at run time with `LoadLibraryExW`, so nothing links against it and the app starts without it.
//! Used only in the worker process.
//!
//! Settings the C API leaves to the caller, from the NeMo source (the spike drove only `diar.h`):
//! - `gpu`: `-1` is the processor, and must be explicit (the C++ default is GPU 0). `N` is the Nth ggml device of type
//!   GPU or integrated GPU, counted as `runtime/ggml/backend.cpp` counts (`gpu_index`). Only the Vulkan engine has any
//!   (Phase 37). The processor engine is built without a GPU backend.
//! - one piece of audio per call, never batched (`batching: null`): batching chunks on a card is broken in v0.3.0, an
//!   assert or, worse, empty words with no error (Phase 37, Task 1).
//! - word times and punctuation must be asked for (`recognition_options_default()` is zeroed): without punctuation
//!   the text comes back lower-case and unpunctuated. As the CLI does (`app/transcribe.cpp`).
//! - word times are int32 milliseconds; segments are seconds.
//! - threads can't be set: words use min(8, hardware threads), the diarizer 4 (`ggml_runtime::Params`).

use super::protocol::{Device, GpuDevice, GpuKind};
use std::ffi::{CStr, CString, c_char, c_void};
use std::path::Path;

/// Loads `dll` from `dir`, which also holds its dependencies: they are found there, then in System32, and nowhere
/// else. The module is never freed (the worker exits instead).
#[cfg(windows)]
fn open(dir: &Path, dll: &str) -> Result<windows::Win32::Foundation::HMODULE, String> {
  use windows::Win32::System::LibraryLoader::{
    LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32, LoadLibraryExW,
  };
  let path = windows::core::HSTRING::from(dir.join(dll).as_os_str());
  // SAFETY: loading a library; its exports are read with `sym!`.
  unsafe { LoadLibraryExW(&path, None, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32) }
    .map_err(|e| format!("loading the engine ({dll}): {e}"))
}

/// The export `$name` of `$module`, as the type of the field it is assigned to. Returns early with an error if absent.
#[cfg(windows)]
macro_rules! sym {
  ($module:expr, $name:literal) => {{
    // SAFETY: the export's type is the one its header declares for it (asr.h, diar.h, ggml-backend.h).
    let p = unsafe {
      windows::Win32::System::LibraryLoader::GetProcAddress($module, windows::core::PCSTR(concat!($name, "\0").as_ptr()))
    }
    .ok_or(concat!("the engine has no ", $name))?;
    // The target type is the field's, written once in the struct.
    #[allow(clippy::missing_transmute_annotations)]
    let f = unsafe { std::mem::transmute::<unsafe extern "system" fn() -> isize, _>(p) };
    f
  }};
}

/// 0 is OK. 2 is out of memory.
pub type Status = i32;
pub const STATUS_OUT_OF_MEMORY: Status = 2;

/// A failed call, with the engine's own message.
#[derive(Debug, Clone)]
pub struct EngineError {
  pub status: Status,
  pub message: String,
}

impl EngineError {
  pub fn is_out_of_memory(&self) -> bool {
    self.status == STATUS_OUT_OF_MEMORY || self.message.to_ascii_lowercase().contains("out of memory")
  }
}

impl std::fmt::Display for EngineError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{} (status {})", self.message, self.status)
  }
}

#[repr(C)]
struct BackendConfig {
  size: usize,
  gpu: i32,
}

#[repr(C)]
struct ModelConfig {
  size: usize,
  path: *const c_char,
  name: *const c_char,
}

#[repr(C)]
struct RecognizerConfig {
  size: usize,
  backend: *const BackendConfig,
  model: *const ModelConfig,
  streaming: *const c_void,
  decoder: *const c_void,
  vad: *const c_void,
  endpointing: *const c_void,
  postproc: *const c_void,
  diar: *const c_void,
  batching: *const c_void,
  salm: *const c_void,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct RecognitionOptions {
  size: usize,
  request_id: *const c_char,
  language_code: *const c_char,
  interim_results: bool,
  enable_word_time_offsets: bool,
  enable_automatic_punctuation: bool,
  verbatim_transcripts: bool,
  profanity_filter: bool,
  stop_history_eou_ms: i32,
  speech_contexts: *const c_void,
  speech_context_count: usize,
  max_alternatives: i32,
  enable_speaker_diarization: bool,
  max_speaker_count: i32,
}

#[repr(C)]
struct DiarModelConfig {
  size: usize,
  model_path: *const c_char,
  gpu: i32,
  preset: *const c_char,
  chunk_frames: i32,
  right_context_frames: i32,
  left_context_frames: i32,
  fifo_frames: i32,
  spkcache_frames: i32,
  update_period_frames: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct DiarSegment {
  start_time: f64,
  end_time: f64,
  speaker: i32,
}

type Opaque = *mut c_void;

/// The C API's functions, from `nemo_speech_asr_c.dll`.
#[allow(clippy::type_complexity)]
pub struct Api {
  last_error: unsafe extern "C" fn() -> *const c_char,
  options_default: unsafe extern "C" fn() -> RecognitionOptions,
  asr_create: unsafe extern "C" fn(*const RecognizerConfig, *mut Opaque) -> Status,
  asr_destroy: unsafe extern "C" fn(Opaque),
  recognize: unsafe extern "C" fn(Opaque, *const RecognitionOptions, *const f32, usize, i32, *mut Opaque) -> Status,
  word_count: unsafe extern "C" fn(Opaque, usize) -> usize,
  word_text: unsafe extern "C" fn(Opaque, usize, usize) -> *const c_char,
  word_start: unsafe extern "C" fn(Opaque, usize, usize) -> i32,
  word_end: unsafe extern "C" fn(Opaque, usize, usize) -> i32,
  word_confidence: unsafe extern "C" fn(Opaque, usize, usize) -> f32,
  language_count: unsafe extern "C" fn(Opaque, usize) -> usize,
  language_code: unsafe extern "C" fn(Opaque, usize, usize) -> *const c_char,
  result_destroy: unsafe extern "C" fn(Opaque),
  diar_create: unsafe extern "C" fn(*const DiarModelConfig, *mut Opaque) -> Status,
  diar_destroy: unsafe extern "C" fn(Opaque),
  diar_open: unsafe extern "C" fn(Opaque, *mut Opaque) -> Status,
  diar_push: unsafe extern "C" fn(Opaque, *const f32, usize, i32) -> Status,
  diar_finish: unsafe extern "C" fn(Opaque) -> Status,
  diar_close: unsafe extern "C" fn(Opaque),
  diar_segments: unsafe extern "C" fn(Opaque, *const c_void, *mut DiarSegment, usize, *mut usize) -> Status,
}

// SAFETY: the functions are plain C entry points; which thread calls them is the C API's business (it keeps its last
// error per thread, and each recognizer and stream is used from one thread here).
unsafe impl Send for Api {}
unsafe impl Sync for Api {}

impl Api {
  /// Loads `nemo_speech_asr_c.dll` from `dir`, which also holds its dependencies (the ggml libraries, the MSVC and
  /// OpenMP runtimes): they are found there, then in System32, and nowhere else.
  #[cfg(windows)]
  pub fn load(dir: &Path) -> Result<Self, String> {
    let m = open(dir, "nemo_speech_asr_c.dll")?;
    Ok(Self {
      last_error: sym!(m, "nemo_speech_asr_last_error"),
      options_default: sym!(m, "nemo_speech_asr_recognition_options_default"),
      asr_create: sym!(m, "nemo_speech_asr_create"),
      asr_destroy: sym!(m, "nemo_speech_asr_destroy"),
      recognize: sym!(m, "nemo_speech_asr_recognize_f32"),
      word_count: sym!(m, "nemo_speech_asr_result_word_count"),
      word_text: sym!(m, "nemo_speech_asr_result_word_text"),
      word_start: sym!(m, "nemo_speech_asr_result_word_start_time"),
      word_end: sym!(m, "nemo_speech_asr_result_word_end_time"),
      word_confidence: sym!(m, "nemo_speech_asr_result_word_confidence"),
      language_count: sym!(m, "nemo_speech_asr_result_language_count"),
      language_code: sym!(m, "nemo_speech_asr_result_language_code"),
      result_destroy: sym!(m, "nemo_speech_asr_result_destroy"),
      diar_create: sym!(m, "nemo_speech_diar_create"),
      diar_destroy: sym!(m, "nemo_speech_diar_destroy"),
      diar_open: sym!(m, "nemo_speech_diar_stream_open"),
      diar_push: sym!(m, "nemo_speech_diar_stream_push_f32"),
      diar_finish: sym!(m, "nemo_speech_diar_stream_finish"),
      diar_close: sym!(m, "nemo_speech_diar_stream_close"),
      diar_segments: sym!(m, "nemo_speech_diar_segments"),
    })
  }

  #[cfg(not(windows))]
  pub fn load(_dir: &Path) -> Result<Self, String> {
    Err("the engine runs on Windows only".into())
  }

  fn error(&self, what: &str, status: Status) -> EngineError {
    // SAFETY: the engine's thread-local message, copied at once.
    let message = unsafe {
      let p = (self.last_error)();
      if p.is_null() { String::new() } else { CStr::from_ptr(p).to_string_lossy().into_owned() }
    };
    EngineError { status, message: format!("{what}: {message}") }
  }
}

/// ggml's device types (`enum ggml_backend_dev_type`, ggml-backend.h): CPU 0, GPU 1, IGPU 2, ACCEL 3, META 4.
const DEV_TYPE_GPU: i32 = 1;
const DEV_TYPE_IGPU: i32 = 2;

/// ggml's device registry (Phase 37, decision 2). The registry is exported by `ggml.dll`, the devices' accessors by
/// `ggml-base.dll` (Task 1). Listing devices doesn't start one: Vulkan reads its settings when a model starts it.
#[allow(clippy::type_complexity)]
pub struct Registry {
  dev_count: unsafe extern "C" fn() -> usize,
  dev_get: unsafe extern "C" fn(usize) -> Opaque,
  dev_type: unsafe extern "C" fn(Opaque) -> i32,
  dev_description: unsafe extern "C" fn(Opaque) -> *const c_char,
  dev_memory: unsafe extern "C" fn(Opaque, *mut usize, *mut usize),
}

/// One of ggml's devices, of any type.
#[derive(Debug, Clone, PartialEq)]
pub struct RawDevice {
  pub name: String,
  pub kind: i32,
  pub total_bytes: u64,
}

impl Registry {
  /// Loads the registry from the engine in `dir`. For the Vulkan engine this fails where Windows has no
  /// `vulkan-1.dll`.
  #[cfg(windows)]
  pub fn load(dir: &Path) -> Result<Self, String> {
    let ggml = open(dir, "ggml.dll")?;
    let base = open(dir, "ggml-base.dll")?;
    Ok(Self {
      dev_count: sym!(ggml, "ggml_backend_dev_count"),
      dev_get: sym!(ggml, "ggml_backend_dev_get"),
      dev_type: sym!(base, "ggml_backend_dev_type"),
      dev_description: sym!(base, "ggml_backend_dev_description"),
      dev_memory: sym!(base, "ggml_backend_dev_memory"),
    })
  }

  #[cfg(not(windows))]
  pub fn load(_dir: &Path) -> Result<Self, String> {
    Err("the engine runs on Windows only".into())
  }

  /// Every device, in ggml's order, the processor included.
  pub fn list(&self) -> Vec<RawDevice> {
    // SAFETY: plain C accessors on devices the registry owns for the process's lifetime; the description is copied.
    unsafe {
      (0..(self.dev_count)())
        .filter_map(|i| {
          let dev = (self.dev_get)(i);
          if dev.is_null() {
            return None;
          }
          let text = (self.dev_description)(dev);
          let name = if text.is_null() { String::new() } else { CStr::from_ptr(text).to_string_lossy().trim().to_owned() };
          let (mut free, mut total) = (0usize, 0usize);
          (self.dev_memory)(dev, &mut free, &mut total);
          Some(RawDevice { name, kind: (self.dev_type)(dev), total_bytes: total as u64 })
        })
        .collect()
    }
  }
}

/// The graphics cards among ggml's devices, in its order: GPUs and integrated GPUs. The processor, accelerators and
/// software renderers that report as the processor are left out. A card whose driver gives no description is named by
/// its place, "Graphics card 2", since the page refuses an empty name and would list no card at all (audit GPU-5). It
/// is named, not dropped: `gpu_index` counts every card, so dropping one would move the cards after it.
pub fn gpus(devices: &[RawDevice]) -> Vec<GpuDevice> {
  devices
    .iter()
    .filter_map(|d| {
      let kind = match d.kind {
        DEV_TYPE_GPU => GpuKind::Gpu,
        DEV_TYPE_IGPU => GpuKind::IntegratedGpu,
        _ => return None,
      };
      Some((d, kind))
    })
    .enumerate()
    .map(|(i, (d, kind))| {
      let name = match d.name.trim() {
        "" => format!("Graphics card {}", i + 1),
        name => name.to_owned(),
      };
      GpuDevice { name, kind, memory_bytes: d.total_bytes }
    })
    .collect()
}

/// The engine's `gpu` index for the saved card: its place among `gpus`. None if there's no such card.
pub fn gpu_index(gpus: &[GpuDevice], device: &Device) -> Option<i32> {
  let mut same = gpus.iter().enumerate().filter(|(_, g)| g.name == device.name);
  same.nth(device.nth as usize).and_then(|(i, _)| i32::try_from(i).ok())
}

/// A model's path as the engine wants it: UTF-8. It opens models with ggml's `ggml_fopen`, which converts UTF-8 to wide
/// characters and calls `_wfopen`, so a user folder with ø or ü works (audit DES-1;
/// `run::tests::model_paths_with_non_ascii_letters_load`). Not the ANSI code page.
fn c_path(path: &Path) -> Result<CString, EngineError> {
  CString::new(path.to_string_lossy().into_owned())
    .map_err(|_| EngineError { status: 1, message: "a model path holds a NUL".into() })
}

/// One recognised word, in seconds from the start of the audio given.
#[derive(Debug, Clone, PartialEq)]
pub struct RawWord {
  pub text: String,
  pub start: f64,
  pub end: f64,
  pub confidence: f32,
}

/// The words model, loaded once and used from one thread.
pub struct Words<'a> {
  api: &'a Api,
  handle: Opaque,
  options: RecognitionOptions,
  /// Languages the model reported, if any (Parakeet reports none).
  pub languages: Vec<String>,
}

impl<'a> Words<'a> {
  /// Loads the model on the processor (`gpu` -1) or the card `gpu` counts to (`gpu_index`).
  pub fn load(api: &'a Api, model: &Path, gpu: i32) -> Result<Self, EngineError> {
    let path = c_path(model)?;
    let backend = BackendConfig { size: size_of::<BackendConfig>(), gpu };
    let model = ModelConfig { size: size_of::<ModelConfig>(), path: path.as_ptr(), name: std::ptr::null() };
    let config = RecognizerConfig {
      size: size_of::<RecognizerConfig>(),
      backend: &backend,
      model: &model,
      streaming: std::ptr::null(),
      decoder: std::ptr::null(),
      vad: std::ptr::null(),
      endpointing: std::ptr::null(),
      postproc: std::ptr::null(),
      diar: std::ptr::null(),
      batching: std::ptr::null(),
      salm: std::ptr::null(),
    };
    // SAFETY: the configs outlive the call; the options are a plain struct the engine fills.
    let mut options = unsafe { (api.options_default)() };
    if options.size != size_of::<RecognitionOptions>() {
      return Err(EngineError {
        status: 1,
        message: format!("the engine's options are {} bytes, this build expects {}", options.size, size_of::<RecognitionOptions>()),
      });
    }
    options.enable_word_time_offsets = true;
    options.enable_automatic_punctuation = true;
    options.verbatim_transcripts = false;
    let mut handle: Opaque = std::ptr::null_mut();
    // SAFETY: as above.
    let status = unsafe { (api.asr_create)(&config, &mut handle) };
    if status != 0 || handle.is_null() {
      return Err(api.error("loading the words model", status));
    }
    Ok(Self { api, handle, options, languages: Vec::new() })
  }

  /// Recognises one piece of mono audio at `rate` samples a second. Times are seconds from the piece's start.
  pub fn recognize(&mut self, samples: &[f32], rate: u32) -> Result<Vec<RawWord>, EngineError> {
    if samples.is_empty() {
      return Ok(Vec::new());
    }
    let api = self.api;
    let mut result: Opaque = std::ptr::null_mut();
    // SAFETY: the samples and options outlive the call; the result is read, then destroyed.
    unsafe {
      let status = (api.recognize)(self.handle, &self.options, samples.as_ptr(), samples.len(), rate as i32, &mut result);
      if status != 0 || result.is_null() {
        return Err(api.error("recognising words", status));
      }
      let count = (api.word_count)(result, 0);
      let mut words = Vec::with_capacity(count);
      for i in 0..count {
        let text = (api.word_text)(result, 0, i);
        let text = if text.is_null() { String::new() } else { CStr::from_ptr(text).to_string_lossy().into_owned() };
        words.push(RawWord {
          text,
          start: (api.word_start)(result, 0, i) as f64 / 1000.0,
          end: (api.word_end)(result, 0, i) as f64 / 1000.0,
          confidence: (api.word_confidence)(result, 0, i),
        });
      }
      for i in 0..(api.language_count)(result, 0) {
        let code = (api.language_code)(result, 0, i);
        if !code.is_null() {
          let code = CStr::from_ptr(code).to_string_lossy().into_owned();
          if !code.is_empty() && !self.languages.contains(&code) {
            self.languages.push(code);
          }
        }
      }
      (api.result_destroy)(result);
      Ok(words)
    }
  }
}

impl Drop for Words<'_> {
  fn drop(&mut self) {
    // SAFETY: created by asr_create, destroyed once.
    unsafe { (self.api.asr_destroy)(self.handle) }
  }
}

/// One speaker segment, in seconds; `speaker` from 0.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RawSegment {
  pub speaker: u32,
  pub start: f64,
  pub end: f64,
}

/// The speakers model and one stream over the whole recording, used from one thread.
pub struct Speakers<'a> {
  api: &'a Api,
  model: Opaque,
  stream: Opaque,
}

impl<'a> Speakers<'a> {
  /// Loads the model with the `v3-offline` geometry (10× faster on a file than the default) and opens a stream, on the
  /// processor (`gpu` -1) or the card `gpu` counts to.
  pub fn load(api: &'a Api, model: &Path, gpu: i32) -> Result<Self, EngineError> {
    let path = c_path(model)?;
    let preset = CString::new("v3-offline").unwrap_or_default();
    let config = DiarModelConfig {
      size: size_of::<DiarModelConfig>(),
      model_path: path.as_ptr(),
      gpu,
      preset: preset.as_ptr(),
      chunk_frames: 0,
      right_context_frames: 0,
      left_context_frames: -1,
      fifo_frames: 0,
      spkcache_frames: 0,
      update_period_frames: 0,
    };
    let mut handle: Opaque = std::ptr::null_mut();
    // SAFETY: the config outlives the call.
    let status = unsafe { (api.diar_create)(&config, &mut handle) };
    if status != 0 || handle.is_null() {
      return Err(api.error("loading the speakers model", status));
    }
    let mut stream: Opaque = std::ptr::null_mut();
    // SAFETY: the model outlives the stream (Drop closes the stream first).
    let status = unsafe { (api.diar_open)(handle, &mut stream) };
    if status != 0 || stream.is_null() {
      // SAFETY: destroyed once, here, since Self is never built.
      unsafe { (api.diar_destroy)(handle) };
      return Err(api.error("opening the speakers stream", status));
    }
    Ok(Self { api, model: handle, stream })
  }

  pub fn push(&mut self, samples: &[f32], rate: u32) -> Result<(), EngineError> {
    // SAFETY: the samples outlive the call.
    let status = unsafe { (self.api.diar_push)(self.stream, samples.as_ptr(), samples.len(), rate as i32) };
    if status != 0 { Err(self.api.error("labelling speakers", status)) } else { Ok(()) }
  }

  /// Flushes the stream and returns every segment.
  pub fn finish(&mut self) -> Result<Vec<RawSegment>, EngineError> {
    let api = self.api;
    // SAFETY: the two-call pattern of diar.h: count, then fill a buffer of that size.
    unsafe {
      let status = (api.diar_finish)(self.stream);
      if status != 0 {
        return Err(api.error("finishing the speakers", status));
      }
      let mut count = 0usize;
      let _ = (api.diar_segments)(self.stream, std::ptr::null(), std::ptr::null_mut(), 0, &mut count);
      let mut buffer = vec![DiarSegment::default(); count];
      let status = (api.diar_segments)(self.stream, std::ptr::null(), buffer.as_mut_ptr(), count, &mut count);
      if status != 0 {
        return Err(api.error("reading the speaker segments", status));
      }
      Ok(
        buffer[..count.min(buffer.len())]
          .iter()
          .filter(|s| s.speaker >= 1)
          .map(|s| RawSegment { speaker: (s.speaker - 1) as u32, start: s.start_time, end: s.end_time })
          .collect(),
      )
    }
  }
}

impl Drop for Speakers<'_> {
  fn drop(&mut self) {
    // SAFETY: the stream first, then the model it came from, each once.
    unsafe {
      (self.api.diar_close)(self.stream);
      (self.api.diar_destroy)(self.model);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn structs_match_the_c_api_on_x64() {
    // The sizes the C structs have with MSVC on x64 (asr.h, diar.h): a mismatch would corrupt every call.
    assert_eq!(size_of::<BackendConfig>(), 16);
    assert_eq!(size_of::<ModelConfig>(), 24);
    assert_eq!(size_of::<RecognizerConfig>(), 88);
    assert_eq!(size_of::<RecognitionOptions>(), 72);
    assert_eq!(size_of::<DiarModelConfig>(), 56);
    assert_eq!(size_of::<DiarSegment>(), 24);
  }

  fn raw(name: &str, kind: i32) -> RawDevice {
    RawDevice { name: name.into(), kind, total_bytes: 1 << 30 }
  }

  fn card(name: &str, nth: u32) -> Device {
    Device { name: name.into(), nth }
  }

  #[test]
  fn only_graphics_cards_are_listed_in_ggmls_order() {
    let listed = gpus(&[
      raw("llvmpipe (LLVM 15.0.7, 256 bits)", 0),
      raw("NVIDIA GeForce RTX 2070 SUPER", DEV_TYPE_GPU),
      raw("Some NPU", 3),
      raw("Intel(R) UHD Graphics 770", DEV_TYPE_IGPU),
      raw("Meta", 4),
      raw("13th Gen Intel(R) Core(TM) i7-13700K", 0),
    ]);
    let names: Vec<_> = listed.iter().map(|g| (g.name.as_str(), g.kind)).collect();
    assert_eq!(
      names,
      [("NVIDIA GeForce RTX 2070 SUPER", GpuKind::Gpu), ("Intel(R) UHD Graphics 770", GpuKind::IntegratedGpu)]
    );
    assert_eq!(listed[0].memory_bytes, 1 << 30);
  }

  #[test]
  fn a_card_with_no_description_is_named_by_its_place() {
    // The page refuses an empty name, and with it every card (audit GPU-5).
    let listed = gpus(&[
      raw("13th Gen Intel(R) Core(TM) i7-13700K", 0),
      raw("", DEV_TYPE_IGPU),
      raw("NVIDIA RTX A2000", DEV_TYPE_GPU),
      raw("   ", DEV_TYPE_GPU),
    ]);
    let names: Vec<_> = listed.iter().map(|g| g.name.as_str()).collect();
    assert_eq!(names, ["Graphics card 1", "NVIDIA RTX A2000", "Graphics card 3"]);
    assert_eq!(listed[0].kind, GpuKind::IntegratedGpu);
  }

  #[test]
  fn a_card_with_no_description_keeps_the_cards_after_it_in_place() {
    // Dropping the unnamed card instead would move the A2000 to the engine's 0, the wrong card.
    let listed = gpus(&[raw("", DEV_TYPE_IGPU), raw("NVIDIA RTX A2000", DEV_TYPE_GPU)]);
    assert_eq!(gpu_index(&listed, &card("Graphics card 1", 0)), Some(0));
    assert_eq!(gpu_index(&listed, &card("NVIDIA RTX A2000", 0)), Some(1));
  }

  #[test]
  fn a_saved_card_resolves_to_the_engines_index() {
    let listed = gpus(&[
      raw("13th Gen Intel(R) Core(TM) i7-13700K", 0),
      raw("AMD Radeon 740M Graphics", DEV_TYPE_IGPU),
      raw("NVIDIA RTX A2000", DEV_TYPE_GPU),
      raw("NVIDIA RTX A2000", DEV_TYPE_GPU),
    ]);
    assert_eq!(gpu_index(&listed, &card("AMD Radeon 740M Graphics", 0)), Some(0), "the processor doesn't count");
    assert_eq!(gpu_index(&listed, &card("NVIDIA RTX A2000", 0)), Some(1));
    assert_eq!(gpu_index(&listed, &card("NVIDIA RTX A2000", 1)), Some(2), "two identical cards");
    assert_eq!(gpu_index(&listed, &card("NVIDIA RTX A2000", 2)), None);
    assert_eq!(gpu_index(&listed, &card("AMD Radeon 780M Graphics", 0)), None, "a card that's gone");
    assert_eq!(gpu_index(&[], &card("AMD Radeon 740M Graphics", 0)), None);
  }
}
