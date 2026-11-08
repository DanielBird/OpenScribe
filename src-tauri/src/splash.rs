//! The launch splash: the DeScribe mark, on screen from the first moments of the process until the main window is
//! ready. WebView2 takes a moment to start and can't draw anything of ours until it has, so this is plain Win32
//! (DECISIONS.md T20).

/// The mark, in the 32-unit square of `icons/source.svg`. Keep these the same as that file.
const VIEW_BOX: f32 = 32.0;
const CORNER_RADIUS: f32 = 7.0;
const BLUE: [f32; 3] = [11.0, 92.0, 173.0]; // #0b5cad, as red, green, blue
const LINE_HALF_WIDTH: f32 = 1.25;
/// Each line's start, end and height.
const LINES: [(f32, f32, f32); 3] = [(8.0, 24.0, 11.0), (8.0, 19.0, 16.0), (8.0, 22.0, 21.0)];

/// How much of a pixel lies inside a shape, from the pixel centre's distance to the shape's edge in pixels.
fn coverage(distance: f32) -> f32 {
  (0.5 - distance).clamp(0.0, 1.0)
}

/// The distance from a point to the edge of the rounded square: negative inside.
fn square_distance(x: f32, y: f32) -> f32 {
  let half = VIEW_BOX / 2.0;
  let qx = (x - half).abs() - (half - CORNER_RADIUS);
  let qy = (y - half).abs() - (half - CORNER_RADIUS);
  qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - CORNER_RADIUS
}

/// The distance from a point to the edge of a line with round ends: negative inside.
fn line_distance(x: f32, y: f32, (start, end, height): (f32, f32, f32)) -> f32 {
  (start - x).max(x - end).max(0.0).hypot(y - height) - LINE_HALF_WIDTH
}

/// The mark as `size` × `size` premultiplied BGRA pixels, top row first. Computed rather than loaded, so it's sharp at
/// every display scaling and needs no image file or decoder.
#[cfg_attr(not(windows), allow(dead_code))]
fn mark_pixels(size: u32) -> Vec<u8> {
  let scale = size as f32 / VIEW_BOX;
  let mut pixels = Vec::with_capacity((size * size * 4) as usize);
  for row in 0..size {
    for column in 0..size {
      let (x, y) = ((column as f32 + 0.5) / scale, (row as f32 + 0.5) / scale);
      let alpha = coverage(square_distance(x, y) * scale);
      let white = LINES
        .iter()
        .map(|line| coverage(line_distance(x, y, *line) * scale))
        .fold(0.0, f32::max);
      let channel = |blue: f32| ((blue + (255.0 - blue) * white) * alpha).round() as u8;
      pixels.extend([channel(BLUE[2]), channel(BLUE[1]), channel(BLUE[0]), (alpha * 255.0).round() as u8]);
    }
  }
  pixels
}

#[cfg(windows)]
pub use native::Splash;

#[cfg(windows)]
mod native {
  use std::sync::atomic::{AtomicBool, Ordering};
  use std::sync::mpsc;

  use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
  use windows::Win32::Graphics::Gdi::{
    AC_SRC_ALPHA, AC_SRC_OVER, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION, CreateCompatibleDC, CreateDIBSection,
    DIB_RGB_COLORS, DeleteDC, DeleteObject, GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint,
    SelectObject,
  };
  use windows::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForMonitor, MDT_EFFECTIVE_DPI, SetThreadDpiAwarenessContext,
  };
  use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW, GetWindowThreadProcessId,
    MSG, PostThreadMessageW, RegisterClassW, SW_SHOWNOACTIVATE, ShowWindow, ULW_ALPHA, UpdateLayeredWindow, WM_QUIT,
    WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
  };
  use windows::core::{Error, Result, w};

  /// The mark's width and height on a display at 100 %.
  const LOGICAL_SIZE: u32 = 128;

  /// The splash on screen. Holds its thread's id, not its window, so it can be closed from any thread.
  pub struct Splash {
    thread_id: u32,
    closed: AtomicBool,
  }

  impl Splash {
    /// Puts the splash up, and returns once it's on screen. `None` if that failed: the app starts without one.
    pub fn show() -> Option<Self> {
      let (ready, on_screen) = mpsc::channel();
      // Its own thread, so it stays responsive while the main thread waits for WebView2.
      std::thread::Builder::new().spawn(move || run(ready)).ok()?;
      let thread_id = on_screen.recv().ok()?;
      Some(Self { thread_id, closed: AtomicBool::new(false) })
    }

    /// Takes the splash down. Calling it again does nothing.
    pub fn close(&self) {
      if !self.closed.swap(true, Ordering::SeqCst) {
        let _ = unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) };
      }
    }
  }

  /// The splash thread: reports its id once the window is up, then waits for `close`. On a failure it returns without
  /// reporting, which `show` sees as the channel closing.
  fn run(ready: mpsc::Sender<u32>) {
    let Ok(window) = open() else { return };
    let _ = ready.send(unsafe { GetWindowThreadProcessId(window, None) });
    let mut message = MSG::default();
    unsafe {
      while GetMessageW(&mut message, None, 0, 0).0 > 0 {
        DispatchMessageW(&message);
      }
      let _ = DestroyWindow(window);
    }
  }

  fn open() -> Result<HWND> {
    unsafe {
      // This thread runs before Tauri makes the process aware of display scaling; without it the mark would be blurred.
      SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

      let (area, dpi) = monitor_under_pointer()?;
      let size = (LOGICAL_SIZE * dpi / 96) as i32;
      let left = area.left + (area.right - area.left - size) / 2;
      let top = area.top + (area.bottom - area.top - size) / 2;

      let instance = HINSTANCE::from(GetModuleHandleW(None)?);
      let class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: w!("DeScribeSplash"),
        ..Default::default()
      };
      if RegisterClassW(&class) == 0 {
        return Err(Error::from_thread());
      }
      // A tool window has no taskbar button, and no-activate leaves the foreground for the main window.
      let window = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        w!("DeScribeSplash"),
        w!("DeScribe"),
        WS_POPUP,
        left,
        top,
        size,
        size,
        None,
        None,
        Some(instance),
        None,
      )?;
      draw(window, POINT { x: left, y: top }, size)?;
      let _ = ShowWindow(window, SW_SHOWNOACTIVATE);
      Ok(window)
    }
  }

  /// The work area and scaling of the monitor under the pointer, which is where the user has just launched the app.
  fn monitor_under_pointer() -> Result<(RECT, u32)> {
    unsafe {
      let mut pointer = POINT::default();
      GetCursorPos(&mut pointer)?;
      let monitor = MonitorFromPoint(pointer, MONITOR_DEFAULTTONEAREST);
      let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
      if !GetMonitorInfoW(monitor, &mut info).as_bool() {
        return Err(Error::from_thread());
      }
      let (mut dpi, mut dpi_y) = (96, 96);
      GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi, &mut dpi_y)?;
      Ok((info.rcWork, dpi))
    }
  }

  /// Gives the layered window its image, once. Windows keeps it, so there's nothing to repaint.
  fn draw(window: HWND, position: POINT, size: i32) -> Result<()> {
    let pixels = super::mark_pixels(size as u32);
    let info = BITMAPINFO {
      bmiHeader: BITMAPINFOHEADER {
        biSize: size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: size,
        biHeight: -size, // top row first
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
      },
      ..Default::default()
    };
    let extent = SIZE { cx: size, cy: size };
    let origin = POINT::default();
    let blend = BLENDFUNCTION {
      BlendOp: AC_SRC_OVER as u8,
      BlendFlags: 0,
      SourceConstantAlpha: 255,
      AlphaFormat: AC_SRC_ALPHA as u8,
    };
    unsafe {
      let mut bits = std::ptr::null_mut();
      let bitmap = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)?;
      std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits.cast::<u8>(), pixels.len());
      let context = CreateCompatibleDC(None);
      let previous = SelectObject(context, bitmap.into());
      let result = UpdateLayeredWindow(
        window,
        None,
        Some(&raw const position),
        Some(&raw const extent),
        Some(context),
        Some(&raw const origin),
        COLORREF(0),
        Some(&raw const blend),
        ULW_ALPHA,
      );
      SelectObject(context, previous);
      let _ = DeleteDC(context);
      let _ = DeleteObject(bitmap.into());
      result
    }
  }

  unsafe extern "system" fn window_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
  }
}

#[cfg(not(windows))]
pub struct Splash;

#[cfg(not(windows))]
impl Splash {
  pub fn show() -> Option<Self> {
    None
  }

  pub fn close(&self) {}
}

#[cfg(test)]
mod tests {
  use super::*;

  const SIZES: [u32; 5] = [128, 160, 192, 256, 384];

  /// The BGRA pixel at a point in the SVG's 32-unit square.
  fn pixel(pixels: &[u8], size: u32, x: f32, y: f32) -> [u8; 4] {
    let scale = size as f32 / VIEW_BOX;
    let (column, row) = ((x * scale) as usize, (y * scale) as usize);
    let start = (row * size as usize + column) * 4;
    pixels[start..start + 4].try_into().unwrap()
  }

  #[test]
  fn has_four_bytes_a_pixel() {
    for size in SIZES {
      assert_eq!(mark_pixels(size).len(), (size * size * 4) as usize);
    }
  }

  #[test]
  fn the_corners_are_transparent() {
    for size in SIZES {
      let pixels = mark_pixels(size);
      for (x, y) in [(0.0, 0.0), (31.9, 0.0), (0.0, 31.9), (31.9, 31.9)] {
        assert_eq!(pixel(&pixels, size, x, y), [0, 0, 0, 0], "size {size}, at ({x}, {y})");
      }
    }
  }

  #[test]
  fn the_body_is_opaque_brand_blue() {
    for size in SIZES {
      assert_eq!(pixel(&mark_pixels(size), size, 28.0, 16.0), [0xad, 0x5c, 0x0b, 255], "size {size}");
    }
  }

  #[test]
  fn each_line_is_white_along_its_centre() {
    for size in SIZES {
      let pixels = mark_pixels(size);
      for (start, end, height) in LINES {
        let at = pixel(&pixels, size, (start + end) / 2.0, height);
        assert_eq!(at, [255, 255, 255, 255], "size {size}, the line at {height}");
      }
    }
  }

  #[test]
  fn no_colour_exceeds_alpha() {
    for size in SIZES {
      for bgra in mark_pixels(size).chunks_exact(4) {
        assert!(bgra[..3].iter().all(|channel| *channel <= bgra[3]), "size {size}: {bgra:?}");
      }
    }
  }
}
