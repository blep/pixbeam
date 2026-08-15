# pixbeam

> A practical demo for exploring high-throughput data transfer via image
> encoding through an HDMI video capture card, which has imperfect color
> capture due to YUV 4:2:2 compression/encoding.

pixbeam sends data from one machine to another using only light: the
**emitter** encodes bytes into full-screen images, an **HDMI capture card**
picks up that signal, and the **receiver** decodes the images back into the
original file.

The catch — and the point of this project — is that the capture card does not
see colors faithfully. It converts the signal to **YUV 4:2:2**, storing
color (chroma) at half the horizontal resolution of brightness (luma).
Choosing an encoding that survives that conversion is the core engineering
problem here.

The first prototype transmitted files as an endless stream of QR codes
(version 40, RaptorQ fountain coding). It worked, but was slow (a QR code is
only ~3 KB per frame) and targeted a phone camera. This project replaces QR
codes with a custom, high-density pixel encoding optimized for a fixed
capture card — the same framing ideas carry over (integrity checks,
metadata bootstrap, fountain-coded blocks). The QR prototype is archived on
the `main_old_qrcode` branch.

## What's in this repo

| Component | Kind | Role |
|---|---|---|
| **`pixbeam`** (`crates/pixbeam`) | Rust GUI (egui) | **the main crate** — receiver control + progress |
| `pixbeam_decoder` | Rust lib | capture card input, pixel → packet decoding |
| `pixbeam_sticher` | Rust lib | accumulates decoded packets into the output file |
| `pixbeam_calibrate` | Rust GUI | shows YUV test colors, grabs what the card delivers |
| **`pixbeam`** (`pixbeam/`) | Python package | **the emitter** — displays encoded frames |

## Quickstart

Prerequisites:

- Rust toolchain (edition 2024; tested with 1.96)
- [uv](https://docs.astral.sh/uv/) for the Python side
- An HDMI capture card exposing a V4L2 device (e.g. `/dev/video4`)

Receive (Rust):

```bash
cargo run -p pixbeam
```

Calibrate colors (Rust):

```bash
cargo run -p pixbeam_calibrate
```

Emit (Python):

```bash
uv venv --python 3.14 .venv
uv pip install -r requirements.txt
uv run python pixbeam/main.py --file some.bin
```

Press `Escape` in the emitter window to quit.

## Status

- [x] Workspace scaffolded: 4 Rust crates + Python emitter package
- [x] Emitter window: pixel-perfect Tk display with update loops
- [ ] Capture (V4L2) — the decoder crate reports "not streaming" placeholders
- [ ] Pixel-encoding protocol (frame layout, framing, block-0 metadata)
- [ ] Emitter encodes real data (currently a data-seeded test pattern)
- [ ] End-to-end transfer + calibration workflow

See `AGENTS.md` for the architecture and development rules.
