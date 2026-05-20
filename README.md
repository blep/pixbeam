# pixbeam

> ⚠️ **Work in progress — untested.** The code has not yet been run
> end-to-end on real hardware. The sender/receiver apps have not been
> tested yet.

A practical demo exploring **RaptorQ fountain codes** (RFC 6330) for
reliable file transfer over an unreliable optical channel: any screen →
phone camera, no Wi-Fi, no cables, no back-channel.

The sender displays an endless animated stream of Version 40-L QR codes
on any device with a browser and a display — laptop, desktop, tablet, TV,
e-reader, or embedded screen. The receiver scans them with a phone camera
and reconstructs the original file. Because RaptorQ is a fountain code,
the receiver can start at any time, miss arbitrary frames, and still
recover the file once it has collected enough unique encoded symbols — no
retransmission, no acknowledgement.

This project is a self-contained web app deployable as a static site
(GitHub Pages or local file serving).

> **Disclaimer**: pixbeam is a fun, vibe-coded experiment — not
> production software. Use it to learn about fountain codes, or transfer
> files in unusual situations. Don't rely on it for anything critical.
> Worked on the archi with DeepSeek while learning about fountain code
> properties, implemented by Claude Code.
>
> **Tip**: transfer compressed archives (`.zip`, `.gz`, …) rather than
> raw files. Compression formats embed a checksum (CRC-32 for ZIP, gzip
> header checksum for `.tar.gz`), so the receiving application will tell
> you immediately if the transfer was corrupted. It's the simplest
> integrity check you can get for free.

---

## Using pixbeam

### Requirements

- **Sender**: any browser on any device with a display — laptop, desktop,
  tablet, TV, Raspberry Pi, etc.
- **Receiver**: any mobile browser with camera access (HTTPS required —
  GitHub Pages provides this)
- No installation, no account, no server

### Live demo

- [Sender](https://blep.github.io/pixbeam/sender.html)
- [Receiver](https://blep.github.io/pixbeam/receiver.html)

### Transferring a file

1. Open the **Sender** page on any device with a screen and a browser.
2. Drop or select any file. The screen fills with an animated QR stream.
3. Open the **Receiver** page on your phone and tap **Start camera**.
4. Point the camera at the sender's screen. A progress bar shows
   decoding progress per block.
5. When the transfer is complete the file downloads automatically.

### Tips

- **Distance**: 30–60 cm works well for a typical phone camera and
  laptop/tablet screen. Larger displays (TV, monitor) can be read from
  further away.
- **Lighting**: avoid strong reflections on the sender's screen. Matte
  screens work better than glossy.
- **Frame rate**: the sender targets ~12 fps. If the phone camera
  struggles, increase ambient light or reduce the browser zoom level.
- **Large files**: throughput is ~29 KB/s at 10 fps. A 10 MB file takes
  ~6 minutes; plan accordingly. Files above ~42 GB are rejected (protocol
  limit).

---

## Developer guide

### Architecture

The design is documented in detail in [docs/archi.md](docs/archi.md).
Key points:

- Each QR code carries **2,953 bytes**: a 2-byte CRC16 integrity field,
  a 1-byte block number, and a 2,950-byte RaptorQ `EncodingPacket`.
- Files are split into **source blocks** (≤166 MB each). Block 0 is a
  tiny 16-byte metadata block that the receiver decodes first to learn
  the file size and block count.
- The sender generates symbols indefinitely using **exponential repair
  doubling** — no cycling, no fixed pool limit — so the transfer makes
  progress at any loss rate.
- The receiver buffers symbols for data blocks that arrive before Block 0
  is decoded, then replays them once metadata is known.

### Building and running locally

```bash
# Install dependencies (pnpm required)
pnpm install

# Start development server (all three pages served with HMR)
pnpm dev
# Sender:   http://localhost:5173/sender.html
# Receiver: http://localhost:5173/receiver.html

# Type-check
pnpm exec tsc --noEmit

# Production build → dist/
pnpm build

# Preview production build locally
pnpm preview
```

### Testing

```bash
# CI tests — fast protocol unit tests + QR smoke tests (~5 s)
pnpm test

# Local tests — optical channel simulation with real QR images (minutes)
# Requires: sharp (native, installed as optional dep)
pnpm test:local

# Stress tests — large files, high loss, dual-receiver (hours)
pnpm test:stress

# Reproduce a specific failure by seed
SEED=3141592653 pnpm test:local
```

See [docs/testing.md](docs/testing.md) for the full testing strategy,
channel simulation design, and how deterministic seeding works.

### GitHub Actions

There is one workflow:
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

#### What it does

| Job              | Steps                                                     |
|------------------|-----------------------------------------------------------|
| `test-and-build` | Install deps → type-check → lint → CI tests → Vite build |
|                  | → upload `dist/` as a Pages artifact                      |
| `deploy`         | Deploy the artifact to GitHub Pages (only on `main`)      |

The `deploy` job depends on `test-and-build`, so a failing test or type
error blocks deployment.

#### When it runs — automatically

| Event                          | `test-and-build` | `deploy` |
|--------------------------------|:----------------:|:--------:|
| Push to `main`                 | ✅               | ✅       |
| Pull request targeting `main`  | ✅               | ✗        |

PRs get full CI validation but never touch the live site.

#### One-time setup required

Deployment will silently skip until GitHub Pages is enabled:

1. **Settings → Pages → Source → GitHub Actions**
   (not "Deploy from a branch")
2. Write permission to Pages is already declared in the workflow file
   (`permissions: pages: write, id-token: write`) — no extra setting
   needed.

After the first successful push to `main` the site will be live at:

```
https://<your-github-username>.github.io/pixbeam/
```

The base URL `/pixbeam/` is hardcoded in `vite.config.ts`. If you fork
under a different repository name, update `base` to match.

### Repository layout

```
pixbeam/
├── index.html        # Landing page (links to sender and receiver)
├── sender.html       # Sender app entry point
├── receiver.html     # Receiver app entry point
│
├── src/
│   ├── lib/          # Pure protocol logic — no browser APIs
│   │   ├── constants.ts  # MTU, MAX_BYTES_PER_BLOCK, …
│   │   ├── crc16.ts      # CRC16-CCITT, buildQRPayload(), isValidPayload()
│   │   ├── metadata.ts   # Block 0 header encode/decode
│   │   ├── blocks.ts     # File splitting, block lengths
│   │   ├── sender.ts     # Sender class (infinite EncodingPacket iterator)
│   │   └── receiver.ts   # Receiver state machine
│   ├── sender/       # Sender UI (vanilla TypeScript + CSS)
│   └── receiver/     # Receiver UI (vanilla TypeScript + CSS)
│
├── tests/
│   ├── helpers/      # PRNG, makeTestFile, ProtocolDriver, VirtualChannel
│   ├── ci/           # Fast unit + QR smoke tests (run in CI)
│   ├── local/        # Optical channel + multi-block tests (run locally)
│   └── stress/       # Large-file stress tests
│
├── docs/
│   ├── archi.md      # Full protocol specification
│   └── testing.md    # Testing strategy and channel simulation design
│
├── vite.config.ts
├── vitest.config.ts
└── .github/workflows/ci.yml
```

### Tech stack

| Concern  | Choice                                                       |
|----------|--------------------------------------------------------------|
| Build    | Vite 5 + TypeScript                                          |
| UI       | Vanilla TypeScript (no framework)                            |
| RaptorQ  | [`raptorq`](https://www.npmjs.com/package/raptorq) — Rust + WASM, RFC 6330 |
| QR encode| [`qrcode`](https://www.npmjs.com/package/qrcode)             |
| QR decode| [`jsqr`](https://www.npmjs.com/package/jsqr)                 |
| Tests    | Vitest                                                       |
| CI/CD    | GitHub Actions → GitHub Pages                                |
