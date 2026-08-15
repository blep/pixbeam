use eframe::egui;

use pixbeam_decoder::{CaptureError, CaptureSource, V4l2Capture};

use crate::pattern::PATCHES;

/// Calibration UI: show the pattern, grab what the capture card delivers.
pub struct CalibrateApp {
    capture: V4l2Capture,
    last_frame: Option<(u32, u32)>,
    error: Option<String>,
}

impl CalibrateApp {
    pub fn new(_cc: &eframe::CreationContext<'_>) -> Self {
        Self {
            capture: V4l2Capture::new("/dev/video4"),
            last_frame: None,
            error: None,
        }
    }

    fn grab_frame(&mut self) {
        match self.capture.next_frame() {
            Ok(frame) => {
                self.last_frame = Some((frame.width, frame.height));
                self.error = None;
            }
            Err(CaptureError::NotStreaming { path }) => {
                self.error = Some(format!(
                    "{path} is not streaming — start the emitter or another capture consumer first"
                ));
            }
            Err(error) => self.error = Some(error.to_string()),
        }
    }
}

impl eframe::App for CalibrateApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        egui::Panel::top("controls").show(ui, |ui| {
            ui.horizontal(|ui| {
                if ui
                    .button("Grab frame")
                    .on_hover_text("Capture one frame from the capture card input")
                    .clicked()
                {
                    self.grab_frame();
                }
                ui.label(format!("Device: {}", self.capture.path()))
                    .on_hover_text("V4L2 capture device used as video input");
            });
            if let Some(error) = &self.error {
                ui.colored_label(ui.visuals().warn_fg_color, error)
                    .on_hover_text("Last capture error");
            }
            if let Some((width, height)) = self.last_frame {
                ui.label(format!("Last frame: {width}x{height} YUYV 4:2:2"))
                    .on_hover_text("Dimensions of the most recent captured frame");
            }
        });

        egui::CentralPanel::default().show(ui, |ui| {
            ui.heading("Calibration pattern");
            ui.label("Show this pattern fullscreen on the display under test, then grab a frame and compare the colors the capture card reports against what was sent.");
            egui::Grid::new("patches")
                .num_columns(4)
                .spacing([16.0, 8.0])
                .striped(true)
                .show(ui, |ui| {
                    ui.strong("Patch");
                    ui.strong("Name");
                    ui.strong("Sent (sRGB)");
                    ui.strong("Captured");
                    ui.end_row();

                    for patch in PATCHES {
                        let color =
                            egui::Color32::from_rgb(patch.rgb.0, patch.rgb.1, patch.rgb.2);
                        let (rect, response) =
                            ui.allocate_exact_size(egui::vec2(48.0, 20.0), egui::Sense::hover());
                        ui.painter().rect_filled(rect, 3.0, color);
                        response.on_hover_text(format!(
                            "{} sent as sRGB({}, {}, {})",
                            patch.name, patch.rgb.0, patch.rgb.1, patch.rgb.2
                        ));
                        ui.label(patch.name);
                        ui.label(format!("{},{},{}", patch.rgb.0, patch.rgb.1, patch.rgb.2));
                        ui.label("—"); // TODO(pixel-encoding): read back from captured frame
                        ui.end_row();
                    }
                });
            ui.separator();
            ui.label("Tip: colors that share luma but differ only in chroma are the ones YUV 4:2:2 can corrupt — check those first.");
        });
    }
}
