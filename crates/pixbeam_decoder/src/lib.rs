//! Decoding of optically transmitted data captured by the camera.
//!
//! The HDMI capture card delivers YUYV 4:2:2 frames ([`CapturedFrame`]);
//! [`FrameDecoder`] turns them into [`DecodedPacket`]s that the
//! `pixbeam_sticher` crate accumulates into a file.

pub mod capture;
pub mod decoder;
pub mod frame;
pub mod packet;

pub use capture::{CaptureError, CaptureSource, V4l2Capture};
pub use decoder::{DecodeError, FrameDecoder};
pub use frame::CapturedFrame;
pub use packet::{DecodedPacket, crc16_ccitt};
