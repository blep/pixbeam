/// A test color patch in the calibration grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColorPatch {
    /// Short human-readable name.
    pub name: &'static str,
    /// sRGB value sent to the display.
    pub rgb: (u8, u8, u8),
}

/// The calibration grid: colors spanning the YUV gamut.
///
/// TODO(pixel-encoding): extend once the emitter protocol defines which
/// colors are used for data (aim for patches that survive YUV 4:2:2
/// chroma subsampling unchanged).
pub const PATCHES: &[ColorPatch] = &[
    ColorPatch {
        name: "black",
        rgb: (0, 0, 0),
    },
    ColorPatch {
        name: "white",
        rgb: (255, 255, 255),
    },
    ColorPatch {
        name: "gray 50%",
        rgb: (128, 128, 128),
    },
    ColorPatch {
        name: "red",
        rgb: (255, 0, 0),
    },
    ColorPatch {
        name: "green",
        rgb: (0, 255, 0),
    },
    ColorPatch {
        name: "blue",
        rgb: (0, 0, 255),
    },
    ColorPatch {
        name: "yellow",
        rgb: (255, 255, 0),
    },
    ColorPatch {
        name: "cyan",
        rgb: (0, 255, 255),
    },
    ColorPatch {
        name: "magenta",
        rgb: (255, 0, 255),
    },
];
