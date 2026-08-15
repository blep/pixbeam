//! pixbeam calibrate — calibration UI entry point.
//!
//! Displays a grid of YUV test colors and captures what the capture card
//! actually delivers, to calibrate which colors pass through YUV 4:2:2
//! compression/encoding unchanged.

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("pixbeam calibrate")
            .with_inner_size([960.0, 640.0]),
        ..Default::default()
    };
    eframe::run_native(
        "pixbeam-calibrate",
        options,
        Box::new(|cc| Ok(Box::new(pixbeam_calibrate::CalibrateApp::new(cc)))),
    )
}
