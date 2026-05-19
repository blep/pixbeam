## File Transfer via Animated QR Codes with RaptorQ

### 1. Overview

This document specifies a system for transferring files from a laptop to a phone using **only optical communication** (laptop screen → phone camera). The sender encodes a file into an endless stream of **Version 40‑L QR codes**. The receiver captures these QR codes and reconstructs the original file.

The system uses **RaptorQ fountain codes** (RFC 6330) to eliminate the need for a back‑channel. The receiver can start scanning at any time, miss arbitrary QR frames, and still recover the complete file after collecting a small surplus of symbols.

**Maximum supported file size**: approximately **42 GB** (254 data blocks × 56,403 symbols × 2,946 bytes). For virtually all practical purposes this is sufficient; for larger files split manually into sessions.

---

### 2. Key Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| QR version | 40 (177×177 modules) | Maximum data capacity |
| Error correction level | L (Low) | 7% recovery, sufficient for a clean optical path |
| **QR binary payload capacity** | 2,953 bytes | Fixed by Version 40‑L |
| **Per‑QR header** | 3 bytes | Integrity field (2) + Block number (1) |
| **RaptorQ packet per QR** | 2,950 bytes | FEC Payload ID (4) + symbol data (2,946) |
| **RaptorQ symbol size (MTU)** | 2,946 bytes | Passed as `maximum_transmission_unit` to the library |
| Max source symbols per block | 56,403 | RFC 6330 limit |
| Max source blocks per object | 255 | RFC 6330 limit (block 0 reserved for metadata) |
| **Max data blocks** | 254 | Blocks 1 … 254 |
| **Maximum file size** | ≈ 42 GB | 254 × 56,403 × 2,946 bytes |

---

### 3. QR Payload Structure

Each QR code carries exactly **2,953 bytes** of binary data:

| Offset (bytes) | Length | Field | Encoding |
|---------------|--------|-------|----------|
| 0 | 2 | Integrity check | CRC16‑CCITT of `payload[2:]` XOR `0xFACE`, big‑endian |
| 2 | 1 | Application block number | `uint8`, range 0 … 254 |
| 3 | 2,950 | RaptorQ encoding packet | Serialised `EncodingPacket` from the `raptorq` library: 4‑byte FEC Payload ID + 2,946‑byte symbol data |

**Total**: 2 + 1 + 4 + 2,946 = **2,953 bytes** ✓

**Integrity field**: the first two bytes carry `CRC16(payload[2:]) XOR 0xFACE`, computed over the remaining 2,951 bytes. This detects QR payloads that survive the QR error‑correction layer yet contain wrong bytes (e.g. from motion blur or optical noise), and filters unrelated QR codes found in the environment. The XOR constant `0xFACE` acts as a protocol identifier. CRC16‑CCITT variant: polynomial `0x1021`, initial value `0xFFFF`.

```javascript
function crc16(bytes) {
  let crc = 0xFFFF;
  for (const b of bytes) {
    crc ^= (b << 8);
    for (let i = 0; i < 8; i++)
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}

// Sender: build a valid 2,953-byte payload
function buildQRPayload(blockNum, encodingPacket) {
  const buf = new Uint8Array(2953);
  buf[2] = blockNum;
  buf.set(encodingPacket, 3);
  const check = crc16(buf.subarray(2)) ^ 0xFACE;
  buf[0] = (check >> 8) & 0xFF;
  buf[1] = check & 0xFF;
  return buf;
}

// Receiver: validate
function isValidPayload(payload) {
  const check = crc16(payload.subarray(2)) ^ 0xFACE;
  return payload[0] === ((check >> 8) & 0xFF) && payload[1] === (check & 0xFF);
}
```

**Application block number**: our own 0‑based index (0 = metadata, 1…N = file data). It is separate from the `source_block_number` in the FEC Payload ID, which is always 0 because each encoder manages exactly one source block.

**FEC Payload ID** (internal to the packet, from the library):
- Byte 0: `source_block_number` — always 0 (one encoder per block)
- Bytes 1‑3: `encoding_symbol_id` (ESI) — big‑endian 24‑bit; source symbols 0 … K−1, repair symbols K … 2²⁴−1

---

### 4. Source Block Organisation

#### 4.1 Block 0 — Dedicated Metadata Block

To allow the receiver to learn file information **almost instantly** (after ~3‑4 QR captures), the metadata lives in its own **tiny source block** — entirely separate from the file data.

**Block 0 source data** is exactly **16 bytes**:

| Offset | Length | Field | Encoding |
|--------|--------|-------|----------|
| 0 | 4 | `magic` | ASCII `PXB0`; the `0` byte is the protocol version |
| 4 | 8 | `total_file_size` | Original file size in bytes (`uint64`, little‑endian) |
| 12 | 2 | `num_data_blocks` | Number of data blocks (blocks 1…N) (`uint16`, little‑endian) |
| 14 | 2 | `symbol_size` | Fixed = 2946 (`uint16`, little‑endian) — sanity check |

Because 16 bytes fit into one source symbol of 2,946 bytes, Block 0 has **K₀ = 1** — a protocol invariant the receiver can hardcode. After ~3‑4 QR captures the median decoding probability is > 99 %.

#### 4.2 File Data Blocks (Blocks 1 … N)

The original file bytes (no metadata prepended) are split into consecutive chunks:

- `max_bytes_per_block = 56_403 × 2_946` ≈ 166.2 MB
- `num_data_blocks = ceil(file_size / max_bytes_per_block)` — capped at 254
- Block `i` (1‑indexed) contains bytes `(i−1) × max_bytes_per_block` through `min(i × max_bytes_per_block, file_size) − 1`
- Each block `i` has `K_i = ceil(block_length_i / 2_946)` source symbols

#### 4.3 Decoder Bootstrap — Resolving the Transfer‑Length Dependency

The `raptorq` library constructs a decoder as:

```
Decoder.with_defaults(transfer_length: bigint, mtu: number)
```

where `transfer_length` is the source block size **in bytes** (as a `bigint`) and `mtu` is the symbol size.

**Block 0** — `transfer_length = 16n` and `mtu = 2946` are both protocol constants. The receiver hardcodes them; no prior information is needed.

**Data blocks** — `transfer_length` for block `i` equals its byte length, which is computable only after Block 0 is decoded and `total_file_size` / `num_data_blocks` are known.

**Consequence**: the receiver must **buffer** encoded packets for data blocks that arrive before Block 0 is decoded. Because Block 0 has K₀ = 1 and decodes after ~3‑4 captures, this buffer stays tiny in practice.

Once Block 0 is decoded, the receiver:
1. Computes `block_length_i` for every data block.
2. Creates decoders: `Decoder.with_defaults(block_length_i, 2946)` — the result is exactly `block_length_i` bytes; no padding is exposed by the library.
3. Replays all buffered packets into the new decoders.

---

### 5. Sender Operation (Laptop)

1. **Read** the file into memory as `fileBytes`.
2. **Compute** `num_data_blocks = ceil(fileBytes.length / max_bytes_per_block)`. Reject if > 254:
   ```javascript
   if (num_data_blocks > 254)
     throw new Error('File too large: exceeds 254 × 166 MB limit. Split the file and transfer in multiple sessions.');
   ```
3. **Build** the 16‑byte metadata block (§4.1) and assemble one encoder per block:
   ```javascript
   const MTU = 2946;
   const blocks = [metadataBytes, ...splitFile(fileBytes, MAX_BYTES)];
   const encoders = blocks.map(b => Encoder.with_defaults(b, MTU));
   ```
4. **Initialise per‑block state** for incremental packet generation:
   ```javascript
   // Start with source packets only (encode(0) = K source packets, 0 repair)
   const pools    = encoders.map(enc => enc.encode(0));
   const cursors  = new Array(encoders.length).fill(0);
   const repairs  = new Array(encoders.length).fill(0); // repair symbols generated so far
   ```
5. **Loop forever** in round‑robin across all blocks:
   ```javascript
   while (true) {
     for (let blockNum = 0; blockNum < encoders.length; blockNum++) {
       const cursor = cursors[blockNum]++;

       if (cursor >= pools[blockNum].length) {
         // Pool exhausted — double the repair budget and regenerate
         repairs[blockNum] = repairs[blockNum] === 0 ? 128 : repairs[blockNum] * 2;
         pools[blockNum] = encoders[blockNum].encode(repairs[blockNum]);
       }

       const packet = pools[blockNum][cursor];
       const payload = buildQRPayload(blockNum, packet);  // §3

       // Render and display as Version 40-L QR code
       // Add ~50–100 ms delay to allow the camera to focus
     }
   }
   ```

**Why no cycling**: each unique ESI contributes new linear combinations. Once all K source packets and any repair packets have been sent, the pool is expanded (repair budget doubled) rather than repeated — the receiver continues to make progress regardless of the channel loss rate.

**Memory per block**: `(K_i + repairs_i) × 2,950` bytes ≈ block data size, growing slowly as more repairs are generated. The old pool is garbage‑collected when replaced.

---

### 6. Receiver Operation (Phone)

#### 6.1 Initialisation

```javascript
const SYMBOL_SIZE = 2946;
const BLOCK0_SIZE = 16n; // bigint — matches Decoder.with_defaults signature

const decoders       = new Map(); // blockNum → Decoder
const pendingPackets = new Map(); // blockNum → Uint8Array[]
const decoded        = new Map(); // blockNum → Uint8Array
const seenESIs       = new Map(); // blockNum → Set<number>  (for progress)

decoders.set(0, Decoder.with_defaults(BLOCK0_SIZE, SYMBOL_SIZE));
seenESIs.set(0, new Set());

let numDataBlocks = null;
let totalFileSize = null;  // bigint
```

#### 6.2 Capture Loop

For each captured camera frame:

1. Detect and decode a QR code → `payload: Uint8Array` (2,953 bytes).
2. Validate integrity: `if (!isValidPayload(payload)) continue;` (§3)
3. Extract:
   ```javascript
   const blockNum = payload[2];              // uint8
   const packet   = payload.slice(3);        // 2,950-byte EncodingPacket
   const esi      = (packet[1] << 16) | (packet[2] << 8) | packet[3]; // 24-bit ESI
   ```
4. If `decoded.has(blockNum)`, skip.
5. If `numDataBlocks !== null && blockNum > numDataBlocks`, discard (invalid block — possible corrupt QR that passed the CRC check by chance).
6. Track the ESI for progress:
   ```javascript
   if (!seenESIs.has(blockNum)) seenESIs.set(blockNum, new Set());
   seenESIs.get(blockNum).add(esi);
   ```
7. Feed to decoder or buffer:
   ```javascript
   if (decoders.has(blockNum)) {
     const result = decoders.get(blockNum).add(packet);
     if (result !== undefined) handleDecoded(blockNum, result);
   } else {
     // Data block arrived before Block 0 decoded — buffer it
     if (!pendingPackets.has(blockNum)) pendingPackets.set(blockNum, []);
     pendingPackets.get(blockNum).push(packet);
   }
   ```

#### 6.3 Handling a Successfully Decoded Block

```javascript
function handleDecoded(blockNum, data) {
  decoded.set(blockNum, data);
  decoders.delete(blockNum);

  if (blockNum === 0) {
    if (data[0] !== 0x50 || data[1] !== 0x58 || data[2] !== 0x42 || data[3] !== 0x30)
      throw new Error('Metadata magic mismatch — wrong protocol or version');

    const view = new DataView(data.buffer, data.byteOffset);
    totalFileSize = view.getBigUint64(4, /*littleEndian=*/true);
    numDataBlocks = view.getUint16(12, true);
    const symSize = view.getUint16(14, true);
    if (symSize !== SYMBOL_SIZE) throw new Error(`Unexpected symbol_size ${symSize}`);

    for (let i = 1; i <= numDataBlocks; i++) {
      const blockLen = dataBlockLength(i, numDataBlocks, totalFileSize); // bigint
      decoders.set(i, Decoder.with_defaults(blockLen, SYMBOL_SIZE));
      if (!seenESIs.has(i)) seenESIs.set(i, new Set());

      for (const pkt of (pendingPackets.get(i) ?? [])) {
        const result = decoders.get(i).add(pkt);
        if (result !== undefined) handleDecoded(i, result);
      }
      pendingPackets.delete(i);
    }
  }

  checkComplete();
}
```

Block byte‑length helper:
```javascript
function dataBlockLength(i, numDataBlocks, totalFileSize) {
  const maxBytes = BigInt(56_403 * 2_946);
  const start    = BigInt(i - 1) * maxBytes;
  const end      = (start + maxBytes < totalFileSize) ? start + maxBytes : totalFileSize;
  return end - start; // bigint
}
```

#### 6.4 File Reassembly

```javascript
function checkComplete() {
  if (numDataBlocks === null) return;
  for (let i = 1; i <= numDataBlocks; i++) {
    if (!decoded.has(i)) return;
  }
  // Decoder.with_defaults(blockLen, mtu) returns exactly blockLen bytes — no padding
  const parts = [];
  for (let i = 1; i <= numDataBlocks; i++) parts.push(decoded.get(i));
  const file = concat(parts); // helper: Uint8Array concat; length equals totalFileSize
  saveFile(file);
}
```

The decoder returns exactly `blockLen` bytes (the library strips internal padding). Concatenating all data blocks yields exactly `totalFileSize` bytes.

#### 6.5 Progress Indication

| Phase | UI |
|-------|----|
| Before Block 0 decoded | `"Waiting for header: ${seenESIs.get(0).size} unique symbols"` |
| After Block 0 decoded | `"File: ${totalFileSize / 1e6} MB, ${numDataBlocks} blocks"` |
| Per data block `i` | `seenESIs.get(i).size / K_i × 100 %` — uses the ESI Set from §6.1 |
| Overall | weighted average by block byte size |

`K_i = ceil(block_length_i / 2946)` is computable once Block 0 is decoded.

#### 6.6 Edge Cases

**Block 0 timeout**: if Block 0 has not decoded after a configurable timeout (suggested: 10 s), notify the user — either the sender is not running, the camera cannot focus, or all Block 0 QR frames are being missed. Prompt the user to check the camera aim or reduce the frame rate.

**Invalid block number**: step 5 of §6.2 discards any `blockNum > numDataBlocks` once the metadata is known. Before that, unknown block numbers are buffered normally (they may belong to the file).

**Cancellation**: expose a `cancel()` function that sets a flag checked at the top of the capture loop, releasing all decoder state and pending buffers.

---

### 7. Implementation Libraries

#### 7.1 JavaScript / TypeScript (`raptorq` npm, v1.7+)

| Library | Package | Notes |
|---------|---------|-------|
| **raptorq** | `raptorq` | Rust + WASM, RFC 6330. Key API: `Encoder.with_defaults(data, mtu)`, `encoder.encode(repairCount) → Uint8Array[]`, `Decoder.with_defaults(transferLen: bigint, mtu)`, `decoder.add(packet) → Uint8Array \| undefined`. |
| **qrcode** | `qrcode` | QR code generation. Supports Version 40‑L binary mode. |

**Full sender snippet**:
```javascript
import initRaptorQ, { Encoder } from 'raptorq';
import QRCode from 'qrcode';

await initRaptorQ();

const MAX_BYTES = 56_403 * 2_946;
const MTU       = 2_946;

async function* generateQRStream(fileBytes) {
  const blocks  = [buildMetadata(fileBytes), ...splitFile(fileBytes, MAX_BYTES)];
  const encoders = blocks.map(b => Encoder.with_defaults(b, MTU));

  const pools   = encoders.map(enc => enc.encode(0));   // source packets only initially
  const cursors = new Array(encoders.length).fill(0);
  const repairs = new Array(encoders.length).fill(0);

  while (true) {
    for (let bn = 0; bn < encoders.length; bn++) {
      const cursor = cursors[bn]++;
      if (cursor >= pools[bn].length) {
        repairs[bn] = repairs[bn] === 0 ? 128 : repairs[bn] * 2;
        pools[bn]   = encoders[bn].encode(repairs[bn]);
      }
      yield await QRCode.toDataURL(
        [{ data: buildQRPayload(bn, pools[bn][cursor]), mode: 'byte' }],
        { version: 40, errorCorrectionLevel: 'L' }
      );
    }
  }
}
```

**Key receiver calls**:
```javascript
import initRaptorQ, { Decoder } from 'raptorq';
await initRaptorQ();

const dec = Decoder.with_defaults(16n, 2946);   // block 0
const result = dec.add(packet);                 // Uint8Array (16 bytes) or undefined
```

**Inspecting a packet** (debugging):
```javascript
import { EncodingPacket } from 'raptorq';
const p = EncodingPacket.deserialize(packetBytes);
console.log(p.source_block_number(), p.encoding_symbol_id());
```

#### 7.2 Python

The `raptorq` PyPI package (same Rust crate, built via pyo3/maturin) is the recommended path: `pip install raptorq`. Alternatively, wrap via a small Rust CLI. Node.js is the simplest end‑to‑end choice.

#### 7.3 Reference Projects

| Project | Language | Notes |
|---------|----------|-------|
| **txqr** | Go | Animated QR file transfer with LT fountain codes — complete pipeline reference |
| **cimbar** | C++/Web | High‑density colour barcode with fountain codes |

---

### 8. Limits and Performance

| Metric | Value |
|--------|-------|
| Symbol size | 2,946 bytes |
| Max source symbols per block | 56,403 |
| Max bytes per data block | 56,403 × 2,946 ≈ 166.2 MB |
| Max data blocks | 254 |
| **Maximum file size** | 254 × 166.2 MB ≈ **42.2 GB** |

**Metadata acquisition**: Block 0 (K₀ = 1) decodes after ~3‑4 QR captures — typically under 1 second at any frame rate ≥ 1 fps.

**Throughput**: at R QR codes/second, net throughput ≈ R × 2,946 bytes/s. At 10 fps: ~29 KB/s. A 100 MB file requires ~35,000 QR codes ≈ 58 minutes at 10 fps. RaptorQ overhead is O(ln K) extra symbols — negligible.

**Repair symbol behaviour**: after all K source symbols are sent, the sender expands the pool (repair budget doubles: 128 → 256 → 512 → …) and generates new unique repair symbols indefinitely. There is no fixed cap; the transfer completes eventually regardless of the channel loss rate.

**Practical limit**: 10–20 fps is typical for a phone camera scanning a high‑contrast screen. Transfers beyond ~100 MB take tens of minutes and may challenge user patience.
