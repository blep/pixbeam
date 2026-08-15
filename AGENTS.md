# AGENTS.md

This file provides guidance to AI coding agents (and humans) working with code in this repository.

## Commands

```bash
# Build / check
cargo build
cargo check

# Run the receiver GUI (the main app)
cargo run -p pixbeam

# Run the calibration UI
cargo run -p pixbeam_calibrate

# Run with debug logging (typical dev)
RUST_LOG=pixbeam=debug cargo run -p pixbeam

# Tests
cargo test                       # runs all workspace members' tests

# Run a single test by name
cargo test -p pixbeam_decoder crc16_ccitt_check_value

# Lints / formatting (workspace-wide)
cargo clippy --all-targets --workspace
cargo fmt --all --check

# Python emitter package (after `uv venv --python 3.14 .venv` +
# `uv pip install -r requirements.txt`)
uv run python pixbeam/main.py --file some.bin
```

## Project Vision

**pixbeam** is a practical demo for exploring high-throughput data transfer
via image encoding through an HDMI video capture card, which has imperfect
color capture due to YUV 4:2:2 compression/encoding.

The emitter (Python, `pixbeam/`) encodes data into full-screen images; the
receiver (Rust, this workspace) captures those images through the HDMI
capture card and decodes them back into a file. The old QR-code/RaptorQ
prototype lives on the `main_old_qrcode` branch (npm/vite project) — its
protocol lessons (CRC16 integrity framing, block-0 metadata bootstrap,
fountain-code reception) inform the new pixel-encoding protocol but are not
the current design.

## Architecture Overview

pixbeam is a **Cargo workspace** of independently reusable crates plus a
Python emitter package:

```text
crates/pixbeam            receiver GUI (egui): controls the reception
                          pipeline and visualizes progress
crates/pixbeam_decoder    capture-card input + pixel decoding:
                          CapturedFrame (YUYV 4:2:2) → DecodedPacket
crates/pixbeam_sticher    accumulates DecodedPackets into an output file
crates/pixbeam_calibrate  calibration UI: displays YUV test colors, grabs
                          what the capture card delivers, compares
pixbeam/                  Python emitter package (main.py) — displays
                          encoded data frames on screen; the eventual sender
```

### Data flow

```text
emitter (Python, screen) ──HDMI──▶ capture card (/dev/video4, YUYV 4:2:2)
    ──USB──▶ pixbeam_decoder ──DecodedPacket──▶ pixbeam_sticher ──▶ file
                              ▲
                   pixbeam (GUI): start/stop + progress
```

`pixbeam_calibrate` is a sibling tool: it shows a known color grid and grabs
capture-card frames of that same screen to measure what YUV 4:2:2 changes.

### Dependency directions

```text
pixbeam (app) ──▶ pixbeam_sticher ──▶ pixbeam_decoder
pixbeam_calibrate ──▶ pixbeam_decoder   (standalone, no sticher dep)
pixbeam_decoder     (no workspace deps)
```

### Design decisions

- **The executable is a crate** (`crates/pixbeam`, `src/main.rs` thin +
  `src/lib.rs` with the app module). Rationale: uniform workspace (one layout
  for libs and bins), the app shares types with the libs, and future
  troubleshooting UIs become `src/bin/*.rs` binaries in the same crate. The
  alternative (root package + `crates/`) mixes two layouts and complicates
  per-crate reuse. There are **two** binaries in the workspace
  (`pixbeam`, `pixbeam_calibrate`), so `cargo run` alone is ambiguous —
  always use `cargo run -p <crate>`.
- **`DecodedPacket` lives in `pixbeam_decoder`** — the producer owns the
  contract; `pixbeam_sticher` and the app depend on the decoder for the
  type. Capture (V4L2) also lives in the decoder crate: the decoder is the
  camera-side crate.
- **egui/eframe 0.35 from crates.io, default features** (the wgpu backend is
  the default in 0.35). No fork: zikmu_vault's `third-parties/egui` fork adds
  an egui_extras feature this project does not need.
- **eframe 0.35 API differs from most online examples**: `eframe::App` is
  implemented as `fn ui(&mut self, ui: &mut egui::Ui, frame: &mut Frame)` —
  not the classic `fn update(ctx, frame)`. Panels are the unified
  `egui::Panel::top(...)` / `egui::CentralPanel` (no `TopBottomPanel`). Do
  not port older egui snippets verbatim.
- **Capture contract**: the capture card (UGREEN 25773 / MS2131) delivers
  **YUYV 4:2:2** — luma at full resolution, chroma subsampled 2:1
  horizontally. `CapturedFrame` carries exactly that (`width`, `height`,
  `yuyv` = `width * height * 2` bytes). Any future conversion (e.g. to RGB
  for display) happens in the consumer, never in the capture path. Capture
  card quirks: can black-screen on a 2560x1600 EDID (force a lower mode),
  link dies on suspend (re-apply the mode afterwards); see the
  `linux-video-capture` Hermes skill for probing details.
- **App identity**: window title `pixbeam`, app_id `pixbeam` (matches the
  future `.desktop` entry). Calibration tool: `pixbeam calibrate` /
  `pixbeam-calibrate`.
- **Python emitter**: `pixbeam/` is a normal package; run with the uv
  environment at the repo root (`.venv`, Python 3.14, deps from
  `requirements.txt`). It is the eventual sender: encode data → fullscreen
  image stream on the display connected to the capture card. Display core:
  `PixelPerfectDisplay` — a borderless Tk window positioned at exact pixel
  coordinates (from the user's reference example).

### Threading model (current & planned)

- **Current**: the UI is single-threaded; capture/decode is not wired up yet
  (placeholders report `NotStreaming`/`NoContent`).
- **Planned**: capture runs on a dedicated thread feeding a bounded queue
  with drop-oldest overflow; the app drains the queue each UI frame, decodes,
  and feeds the assembler. **Unidirectional channels only** — the UI owns its
  state, updated only by draining events each frame. The UI thread holds
  **zero mutexes**; all display state is owned directly by the App.
  `ctx.request_repaint()` drives the real-time loop.

### Dev Constraints

- **Zero compiler warnings.** Fix the root cause (remove dead code, adjust
  patterns); never add `#[allow(...)]` and never `_`-prefix a field as a
  permanent fix.
- **No `unwrap()`/`expect()` in production code paths.** Use `?`, `.ok()`, or
  explicit pattern matching. `expect()` is only acceptable in `main.rs` for
  truly unrecoverable startup failures (with a `// SAFETY:` comment).
- **Domain errors via `thiserror`** enums per crate; propagate with `?`.
- **Tooltips on every interactive element** (`.on_hover_text(...)`).
- **Theme-aware colours only** — derive from `ui.visuals()`, never hardcode
  RGB.
- **SVG-only icons** (once icons appear): `assets/icons/*.svg` embedded via
  `include_str!`, stroke always `white`, tinted at render time. Never render
  icons via text glyphs.
- **`docs/`** holds design docs (`protocol.md` planned — the pixel-encoding
  frame layout, packet framing, and block-0 metadata format derived from the
  QR heritage).
- `mod.rs` is a **facade** — submodule declarations + `pub use` re-exports
  only, never substantial logic. Implementation lives in named files, one
  responsibility each; split when a module gains a second responsibility.
- `lib.rs` is the crate-level facade: module declarations, crate
  configuration, and public re-exports only. Never implement business logic,
  define more than 3-5 structs, or exceed ~80 lines in `lib.rs`. Each
  significant type belongs in its own named file under a logical module.

### Module map

```text
crates/pixbeam/src/
  main.rs        — eframe::run_native
  lib.rs         — pub mod app
  app.rs         — PixbeamApp (eframe::App): start/stop + progress UI
crates/pixbeam_decoder/src/
  lib.rs         — facade
  frame.rs       — CapturedFrame (YUYV 4:2:2)
  packet.rs      — DecodedPacket + crc16_ccitt (protocol heritage)
  decoder.rs     — FrameDecoder + DecodeError (pixel → packet; TODO)
  capture.rs     — CaptureSource trait + V4l2Capture (V4L2; TODO)
crates/pixbeam_sticher/src/
  lib.rs         — facade
  assembler.rs   — FileAssembler + Progress (arrival-order append; TODO
                   block-0 metadata + ordering)
crates/pixbeam_calibrate/src/
  main.rs        — eframe::run_native
  lib.rs         — facade
  app.rs         — CalibrateApp (eframe::App): pattern grid + grab frame
  pattern.rs     — ColorPatch + PATCHES calibration grid
pixbeam/         — Python emitter package (main.py + __init__.py)
```

### Key Reference Documents

- `README.md` — project vision, quickstart, prerequisites
- `docs/` — (planned) `protocol.md`: pixel-encoding frame layout, packet
  framing, block-0 metadata bootstrap (inherits CRC16 framing + block-0
  ideas from `main_old_qrcode`'s `docs/archi.md`)
- `main_old_qrcode` branch — the archived QR/RaptorQ prototype (npm/vite);
  read `docs/archi.md` there for the protocol heritage
