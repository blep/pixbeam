use crate::frame::CapturedFrame;
use crate::packet::DecodedPacket;

/// Errors produced while decoding a captured frame.
#[derive(Debug, thiserror::Error)]
pub enum DecodeError {
    /// The frame carried no decodable content (blank, misaligned, or noise).
    #[error("frame has no decodable content")]
    NoContent,
    /// The frame decoded, but its integrity check failed.
    #[error("packet integrity check failed")]
    Integrity,
}

/// Decodes [`CapturedFrame`]s into [`DecodedPacket`]s.
///
/// The receiver-side counterpart of the emitter's image encoding. Consumed
/// by the `pixbeam` GUI app and reused by tests/tools.
#[derive(Debug, Default)]
pub struct FrameDecoder {
    /// Total packets successfully decoded since creation.
    pub decoded_packets: u64,
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Decode one captured frame into at most one packet.
    ///
    /// Returns `Ok(None)` for frames with no decodable content.
    ///
    /// TODO(pixel-encoding): implement pixel → packet decoding once the
    /// emitter's frame format is defined.
    pub fn decode_frame(
        &mut self,
        _frame: &CapturedFrame,
    ) -> Result<Option<DecodedPacket>, DecodeError> {
        Ok(None)
    }
}
