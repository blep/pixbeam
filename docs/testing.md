## Testing Strategy

### 1. Philosophy

The test suite is split into two tiers:

- **CI tests** — run on every push, complete in under 60 seconds. They test protocol correctness by injecting raw payloads directly (no QR encoding/decoding). A handful of QR‑layer smoke tests are included with very small payloads.
- **Local tests** — run manually before significant merges. They exercise the full pipeline: real QR image generation, simulated camera distortion, and large file transfers. These take minutes to hours.

The protocol logic (RaptorQ encoding, block splitting, metadata parsing, receiver state machine) is the bulk of the CI test surface. QR generation/decoding is slow (~50 ms per Version 40‑L code) and tested shallowly in CI; thorough optical channel simulation lives in local tests only.

**Separation of concerns**: for tests to work, sender and receiver implementations must expose their protocol logic decoupled from I/O — i.e. a `Sender` class that yields raw 2,953-byte payloads and a `Receiver` class that accepts them, independent of the camera, screen, and QR codecs.

---

### 2. Test Infrastructure

#### 2.1 Libraries

| Library | Purpose | Tier |
|---------|---------|------|
| `vitest` (or `jest`) | Test runner | Both |
| `raptorq` | RaptorQ encode/decode | Both |
| `qrcode` | Generate real QR images | Local |
| `canvas` (`node-canvas`) | Render and distort QR images | Local |
| `jsQR` | Decode QR images (simulates phone camera) | Local |
| `sharp` | Advanced optical distortions (blur, noise, resize) | Local |

#### 2.2 Deterministic Randomness

Every source of randomness in the test suite — packet drops, burst-loss timing, distortion magnitudes, test-file content — is driven by a **seeded PRNG**. This guarantees that any failure or performance anomaly can be reproduced exactly by re-running with the same seed.

**PRNG** — a fast, seedable 32-bit generator (mulberry32):

```javascript
function makePRNG(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0, 1)
  };
}
```

**Seed selection and logging** — each test picks a seed (from `process.env.SEED` if set, otherwise a random 32-bit integer) and prints it before running:

```javascript
function resolveTestSeed() {
  const seed = process.env.SEED !== undefined
    ? parseInt(process.env.SEED, 10)
    : (Math.random() * 0xFFFFFFFF) >>> 0;
  console.log(`[pixbeam-test] seed=${seed}  (re-run with SEED=${seed} to reproduce)`);
  return seed;
}
```

To reproduce a specific run:

```bash
SEED=3141592653 npm run test:local
```

**All randomised helpers receive a PRNG instance** created from this seed — none use `Math.random()` directly. A single seed deterministically controls the entire test run.

#### 2.3 Core Test Helpers

**`makeTestFile`** — generates a deterministic file of known content:

```javascript
function makeTestFile(sizeBytes, rng) {
  const buf = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++)
    buf[i] = (rng() * 256) >>> 0;
  return buf;
}
```

**`ProtocolDriver`** — drives a full encode/decode cycle entirely in memory, skipping QR. Used for all CI tests.

```javascript
class ProtocolDriver {
  constructor(fileBytes) {
    this.sender   = new Sender(fileBytes);   // yields { blockNum, packet: Uint8Array }
    this.receiver = new Receiver();
  }

  // dropFn(frameIndex, blockNum, esi) → true to drop the frame; receives the PRNG-driven
  // decision from the caller so this class stays pure.
  run(dropFn = () => false) {
    let frameIndex = 0;
    for (const { blockNum, packet } of this.sender) {
      const payload = buildQRPayload(blockNum, packet);
      if (!dropFn(frameIndex++, blockNum, esi(packet)))
        this.receiver.receive(payload);
      if (this.receiver.isComplete()) break;
    }
    return this.receiver.getFile(); // Uint8Array
  }
}
```

**`VirtualChannel`** — wraps QR generation → distortion → QR decoding. Used in local tests. Takes a PRNG instance so all stochastic decisions are seeded.

```javascript
class VirtualChannel {
  constructor(profile, rng) {
    this.profile = profile;
    this.rng = rng;
    this.frameCount = 0;
  }

  // Returns decoded 2,953-byte payload or null (frame lost/unreadable).
  async passThrough(rawPayload) {
    const frame = this.frameCount++;

    // Burst loss: drop `burstLen` consecutive frames every `burstEvery` frames
    if (this.profile.burstEvery) {
      const pos = frame % this.profile.burstEvery;
      if (pos < this.profile.burstLen) return null;
    }

    // Random loss driven by seeded PRNG — not Math.random()
    if (this.rng() < (this.profile.lossRate ?? 0)) return null;

    // Distortion magnitudes are fixed per-profile (deterministic); only pixel-level
    // noise uses the PRNG so that the noise pattern differs each frame
    const qrImage  = await generateQRImage(rawPayload);
    const distorted = await applyDistortions(qrImage, this.profile, this.rng);
    return decodeQRImage(distorted); // jsQR → Uint8Array | null
  }
}
```

**`ChannelProfile`** — bundles loss rate and distortion parameters. Distortion values are exact numbers (not ranges), so only the noise pattern and loss decisions vary per seed.

```javascript
const PROFILES = {
  perfect:  { lossRate: 0,    blur: 0,   noise: 0,    rotation: 0 },
  noisy:    { lossRate: 0.05, blur: 0.5, noise: 0.03, rotation: 0 },
  shaky:    { lossRate: 0.10, blur: 0.5, noise: 0,    rotation: 2 },
  degraded: { lossRate: 0.20, blur: 1.5, noise: 0.05, rotation: 3 },
  burst:    { lossRate: 0,    burstEvery: 50, burstLen: 10 },
  highLoss: { lossRate: 0.45 },
};
```

**Wiring it together in a test**:

```javascript
test('50 KB file under shaky channel', async () => {
  const seed = resolveTestSeed();
  const rng  = makePRNG(seed);

  const file    = makeTestFile(50_000, rng);
  const channel = new VirtualChannel(PROFILES.shaky, rng);
  const driver  = new ProtocolDriver(file);

  const recovered = await runWithChannel(driver, channel); // local helper
  expect(recovered).toEqual(file);
});
```

A single `seed` flows into both `makeTestFile` and `VirtualChannel`, so the file content and the drop/distortion sequence are jointly reproducible.

---

### 3. CI Tests

All CI tests run the protocol layer directly (no QR image generation) except for the QR smoke tests at the end. Target budget: **< 30 s** total.

#### 3.1 Protocol Unit Tests

**CRC16 correctness**
- Known input `[0x31, 0x32, 0x33]` → CRC16-CCITT = `0x3218` (well-known test vector)
- `buildQRPayload` then `isValidPayload` round-trip on a random 2,953-byte payload
- Single-byte flip in `payload[5]` → `isValidPayload` returns `false`
- Single-byte flip in `payload[0]` → `isValidPayload` returns `false`

**Block splitting**
- 1-byte file → `num_data_blocks = 1`, block 0 is metadata (16 B), block 1 is 1 B
- File of exactly `max_bytes_per_block` bytes → `num_data_blocks = 1`, one full block
- File of `max_bytes_per_block + 1` bytes → `num_data_blocks = 2`
- `sum(dataBlockLength(i) for i in 1..N) === file_size` for several file sizes
- `num_data_blocks > 254` → sender throws

**Metadata encoding/decoding**
- `buildMetadata(file)` produces exactly 16 bytes with correct `PXB0` magic, file size, block count, and symbol size
- Wrong first byte in decoded block 0 → receiver throws "magic mismatch"
- Wrong `symbol_size` field → receiver throws

**Single-block roundtrip (no loss)**
- 100-byte file: encode, feed all K source packets, receiver calls `getFile()`, bytes match
- 50 KB file (K ≈ 18 source symbols): same check

**Block 0 bootstrap**
- Receiver receives only data-block packets first, then block-0 packets → buffered data-block packets are replayed after block 0 decodes, final output matches original file
- Block 0 packets interleaved with data-block packets (round-robin order) → same result

**ESI extraction**
- For several `EncodingPacket` values, `esi(packet)` returns `(packet[1] << 16) | (packet[2] << 8) | packet[3]`
- Source symbols have ESI in range `[0, K)`, first repair symbol has ESI ≥ K

**Repair symbol generation (no cycling)**
- After exhausting source symbols, each subsequent packet has a strictly higher ESI — no ESI is repeated across the first 2,000 packets of a block

**Receiver state machine**
- `isComplete()` is false until all `num_data_blocks` data blocks are decoded
- Out-of-range `blockNum` (e.g. 200 when `num_data_blocks = 3`) is silently discarded after block 0 is decoded
- Calling `receive()` on a fully decoded block is a no-op

#### 3.2 QR Smoke Tests

These use real QR encoding and decoding over a perfect channel. Budget: ~15 s.

- **Metadata block roundtrip**: encode the 16-byte metadata block as a Version 40‑L QR, decode with `jsQR`, feed to receiver, verify block 0 decodes correctly.
- **Small file, perfect channel, direct QR path**: 1 KB file, feed QR-encoded payloads through `VirtualChannel(PROFILES.perfect)` until complete, verify output.
- **Integrity field rejection**: corrupt `payload[5]` after QR generation, verify `isValidPayload` rejects it before it reaches the RaptorQ decoder.

---

### 4. Local Tests

Run with `npm run test:local` (or equivalent). May take minutes; never run in CI.

#### 4.1 Optical Channel Tests

Each test uses a **50 KB** deterministic file (fast to encode/decode) and the `VirtualChannel` helper.

| Test | Channel Profile | Pass Condition |
|------|----------------|---------------|
| Perfect channel | `perfect` | Completes, output matches |
| 5 % random loss | `noisy` | Completes within 1.5× optimal frames |
| 10 % loss + mild distortion | `shaky` | Completes |
| 20 % loss + heavy distortion | `degraded` | Completes within 3× optimal frames |
| Burst loss (10 frames every 50) | `burst` | Completes |
| 45 % random loss | `highLoss` | Completes (validates unbounded repair generation) |
| Receiver joins late (misses first 40 % of stream) | `perfect` | Completes after joining |
| All block-0 QR frames missed for first 200 frames | custom | Block 0 eventually decoded; buffered packets replayed correctly |

For each test, assert:
1. `receiver.getFile()` byte-equals the original
2. Frame count is within a plausible bound (e.g. `< 10 × K_total`)
3. No exception was thrown

#### 4.2 Multi-Block File Tests

| Test | File Size | Expected Blocks | Notes |
|------|-----------|----------------|-------|
| Two-block file | `max_bytes_per_block + 1 B` | 2 data blocks | Tests block boundary |
| Four-block file | `3 × max_bytes_per_block + 1 B` | 4 data blocks | |
| Two-block, 10 % loss | `170 MB` | 2 data blocks | Validates independent block decoding |

These tests bypass QR image generation (use `ProtocolDriver` with a drop function) — they test RaptorQ and block-splitting logic, not the optical layer.

#### 4.3 Edge Case Tests

| Test | Description |
|------|-------------|
| 1-byte file | `num_data_blocks = 1`, block 1 has K = 1 |
| File size == `max_bytes_per_block` exactly | Last block is full; no trailing partial symbol padding |
| File size == `max_bytes_per_block × 254` | Max protocol limit; must succeed, must not create block 255 |
| File size == `max_bytes_per_block × 254 + 1` | Must throw "File too large" |
| Receiver sees block 0 last | All 254 data blocks buffered before metadata arrives |
| Very high ESI values | After K + 10,000 repair symbols, ESI never wraps back to 0 |
| CRC collision | Randomly corrupt a payload's data bytes but keep the integrity field valid by recalculating it → receiver accepts the packet but RaptorQ discards the linearly-dependent symbol gracefully (does not corrupt output) |

#### 4.4 Long-Running Stress Test

Run infrequently (before releases):

- **500 MB file, `shaky` channel**: validates the sender's exponential repair doubling under sustained loss at a size that requires real time to transfer
- **Two runs from different start positions**: receiver A starts at frame 0, receiver B starts at frame 500; both must recover the same file independently, simulating two phones scanning simultaneously

---

### 5. What Is Not Tested

- **Real camera capture**: no automated test can substitute for pointing a phone at a laptop screen. Manual QA should cover: focus distance, ambient lighting, screen glare, phone at an angle. Do this before any release.
- **Display rendering**: correctness of the QR code drawn on screen (resolution, contrast, margin) must be verified visually.
- **Performance at target frame rate**: confirm empirically on the target devices that 10–20 fps is achievable with the chosen QR rendering approach.

---

### 6. Running the Tests

```bash
# CI tests (fast, no QR distortion)
npm test

# Local tests (optical channel simulation, multi-block, edge cases)
npm run test:local

# Long-running stress test
npm run test:stress
```

Recommended `package.json` scripts:

```json
{
  "scripts": {
    "test":         "vitest run --reporter=verbose tests/ci/",
    "test:local":   "vitest run --reporter=verbose tests/local/",
    "test:stress":  "vitest run --reporter=verbose tests/stress/"
  }
}
```

Organise test files under:
```
tests/
  ci/
    crc16.test.ts
    block-splitting.test.ts
    metadata.test.ts
    roundtrip.test.ts
    bootstrap.test.ts
    state-machine.test.ts
    qr-smoke.test.ts
  local/
    optical-channel.test.ts
    multi-block.test.ts
    edge-cases.test.ts
  stress/
    large-file.test.ts
```
