use eframe::egui;

use pixbeam_decoder::{FrameDecoder, V4l2Capture};
use pixbeam_sticher::{AssemblerError, FileAssembler};

/// Reception pipeline state shown in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceptionState {
    /// Not capturing.
    Stopped,
    /// Capturing, decoding and writing packets.
    Running,
}

/// The pixbeam receiver UI: controls reception and visualizes progress.
pub struct PixbeamApp {
    state: ReceptionState,
    decoder: FrameDecoder,
    capture: V4l2Capture,
    assembler: Option<FileAssembler>,
    output_name: String,
    error: Option<String>,
}

impl PixbeamApp {
    pub fn new(_cc: &eframe::CreationContext<'_>) -> Self {
        Self {
            state: ReceptionState::Stopped,
            decoder: FrameDecoder::new(),
            capture: V4l2Capture::new("/dev/video4"),
            assembler: None,
            output_name: "received.bin".to_owned(),
            error: None,
        }
    }

    fn start(&mut self) {
        match FileAssembler::new(self.output_name.clone()) {
            Ok(assembler) => {
                self.assembler = Some(assembler);
                self.state = ReceptionState::Running;
                self.error = None;
            }
            Err(AssemblerError::CreateFile { path, source }) => {
                self.error = Some(format!("cannot create {}: {source}", path.display()));
            }
            Err(error) => self.error = Some(error.to_string()),
        }
        // TODO(capture): spawn the capture thread feeding `self.decoder`.
    }

    fn stop(&mut self) {
        // TODO(finalize): flush pending decoded blocks once the protocol is defined.
        self.state = ReceptionState::Stopped;
    }
}

impl eframe::App for PixbeamApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        egui::Panel::top("controls").show(ui, |ui| {
            ui.horizontal(|ui| {
                match self.state {
                    ReceptionState::Stopped => {
                        if ui
                            .button("Start reception")
                            .on_hover_text(
                                "Begin capturing frames from the capture card and decoding them",
                            )
                            .clicked()
                        {
                            self.start();
                        }
                    }
                    ReceptionState::Running => {
                        if ui
                            .button("Stop reception")
                            .on_hover_text("Stop capturing; the output file is finalized")
                            .clicked()
                        {
                            self.stop();
                        }
                    }
                }
                ui.label(egui::RichText::new(format!("State: {:?}", self.state)).monospace())
                    .on_hover_text("Reception pipeline state");
                ui.label(format!("Device: {}", self.capture.path()))
                    .on_hover_text("V4L2 capture device used as video input");
            });
            if let Some(error) = &self.error {
                ui.colored_label(ui.visuals().error_fg_color, error)
                    .on_hover_text("Last error from the reception pipeline");
            }
        });

        egui::CentralPanel::default().show(ui, |ui| {
            let progress = self
                .assembler
                .as_ref()
                .map(|assembler| assembler.progress())
                .unwrap_or(pixbeam_sticher::Progress {
                    packets: 0,
                    bytes: 0,
                });
            ui.label(
                egui::RichText::new(format!(
                    "Packets decoded: {}",
                    self.decoder.decoded_packets
                ))
                .monospace(),
            )
            .on_hover_text("Packets successfully decoded from captured frames");
            ui.label(
                egui::RichText::new(format!("Packets written: {}", progress.packets)).monospace(),
            )
            .on_hover_text("Packets appended to the output file");
            ui.label(
                egui::RichText::new(format!("Bytes written: {}", progress.bytes)).monospace(),
            )
            .on_hover_text("Bytes written to the output file so far");
            ui.add(
                egui::ProgressBar::new(0.0)
                    .text("Waiting for block 0 (metadata) to size the transfer"),
            )
            .on_hover_text("Overall transfer progress — 0 until the metadata block is decoded");
            ui.label(format!("Output: {}", self.output_name))
                .on_hover_text("File the received data is accumulated into");
        });
    }
}
