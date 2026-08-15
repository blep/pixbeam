/// A raw frame as delivered by the capture card.
///
/// The capture card (UGREEN 25773 / MS2131) delivers **YUYV 4:2:2**: luma
/// (Y) at full resolution, chroma (U/V) subsampled 2:1 horizontally. Each
/// pair of pixels is stored as four bytes `Y0 U0 Y1 V0`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedFrame {
    /// Frame width in pixels.
    pub width: u32,
    /// Frame height in pixels.
    pub height: u32,
    /// YUYV 4:2:2 interleaved bytes, `width * height * 2` long.
    pub yuyv: Vec<u8>,
}

impl CapturedFrame {
    /// Number of bytes a YUYV 4:2:2 frame of this size should carry.
    pub fn expected_len(&self) -> usize {
        (self.width * self.height * 2) as usize
    }
}
