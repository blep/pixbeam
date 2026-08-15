use crate::frame::CapturedFrame;

/// Errors produced while capturing frames from the capture card.
#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    /// No capture device exists at the requested path.
    #[error("no capture device at {path}")]
    NoDevice { path: String },
    /// The device exists but is not streaming.
    #[error("capture device {path} is not streaming")]
    NotStreaming { path: String },
    /// The device produced a frame in an unsupported format.
    #[error("unsupported frame format from {path}")]
    UnsupportedFormat { path: String },
}

/// A source of [`CapturedFrame`]s — the HDMI capture card.
pub trait CaptureSource {
    /// Grab the next frame, blocking until one is available.
    fn next_frame(&mut self) -> Result<CapturedFrame, CaptureError>;
}

/// V4L2 wrapper around the HDMI capture card (e.g. `/dev/video4`).
///
/// TODO(v4l2): implement the real V4L2 ioctl path (YUYV 4:2:2 capture,
/// mmap streaming). Until then `next_frame` reports
/// [`CaptureError::NotStreaming`].
#[derive(Debug, Clone)]
pub struct V4l2Capture {
    path: String,
}

impl V4l2Capture {
    /// Create a wrapper for the device at `path`.
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }

    /// The device path this capture is bound to.
    pub fn path(&self) -> &str {
        &self.path
    }
}

impl CaptureSource for V4l2Capture {
    fn next_frame(&mut self) -> Result<CapturedFrame, CaptureError> {
        Err(CaptureError::NotStreaming {
            path: self.path.clone(),
        })
    }
}
