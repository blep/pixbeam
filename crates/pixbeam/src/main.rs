//! pixbeam receiver — GUI entry point.
//!
//! Controls the reception pipeline (capture card → decoder → file) and
//! visualizes its progress.

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("pixbeam")
            .with_inner_size([960.0, 640.0]),
        ..Default::default()
    };
    eframe::run_native(
        "pixbeam",
        options,
        Box::new(|cc| Ok(Box::new(pixbeam::PixbeamApp::new(cc)))),
    )
}
