# AGENTS.md

Guidance for AI coding assistants working in this repository.

## Project Overview

**pixbeam** transfers files from a laptop to a phone using only optical communication (laptop screen → phone camera). The sender displays an endless animated stream of Version 40-L QR codes; the receiver scans them and reconstructs the original file. No back-channel is required.

The architecture spec lives in [docs/archi.md](docs/archi.md) — read it before implementing anything.

## Protocol Summary

- **Transport**: Version 40-L QR codes, 2,953 bytes binary payload each
- **Erasure coding**: RaptorQ fountain codes (RFC 6330) — receiver can start at any time, miss frames, and still reconstruct the file once it has enough symbols
- **Per-QR frame layout**: integrity (2 B, CRC16 XOR 0xFACE) + block number (1 B) + RaptorQ EncodingPacket (2,950 B = 4 B FEC Payload ID + 2,946 B symbol data). The integrity field is `CRC16-CCITT(payload[2:]) XOR 0xFACE`, big-endian.
- **Block 0**: a dedicated 16-byte metadata block (`magic` 4 B `PXB0`, `total_file_size` u64 LE, `num_data_blocks` u16 LE, `symbol_size` u16 LE). It has exactly K₀ = 1 source symbol and decodes after ~3–4 QR captures.
- **File data**: blocks 1 … N each hold a raw file chunk (no metadata prepended). Max 254 data blocks.
- **Block 0 must be decoded first**: the receiver learns `num_data_blocks` and `total_file_size` from it, then creates decoders for data blocks and replays any buffered packets.
- **Max file size**: ~42 GB (254 data blocks × 56,403 symbols × 2,946 bytes)

## Recommended Implementation Stack

JavaScript/TypeScript is the most direct path:

| Concern | Library |
|---------|---------|
| RaptorQ encode/decode | `raptorq` (npm) — Rust+WASM, RFC 6330 compliant. Key API: `Encoder.with_defaults(data, mtu)`, `encoder.encode(repairCount)`, `Decoder.with_defaults(transferLength: bigint, mtu)`, `decoder.add(packet)` |
| QR generation | `qrcode` (npm) — supports Version 40-L binary mode |

A Python implementation using the `raptorq` PyPI package (same Rust crate) is also feasible; see [docs/archi.md](docs/archi.md) §7.2.

## Sender Logic (Laptop)

1. Build 16-byte metadata, create `Encoder.with_defaults(metadata, 2946)`
2. Split file into ≤254 chunks (~166 MB each), create one encoder per chunk
3. Start each block's pool with `encoder.encode(0)` (source symbols only); when a pool is exhausted, double the repair budget and call `encoder.encode(newBudget)` — unique repair symbols are generated without cycling
4. Loop forever: round-robin over blocks 0…N, pick the next packet from each block's growing pool, wrap with CRC16 integrity field + block_num, display as Version 40-L QR code
5. Target 50–100 ms per frame to give the camera time to focus

## Receiver Logic (Phone)

1. Create decoder for block 0 immediately: `Decoder.with_defaults(16n, 2946)` (K₀ = 1 is a protocol constant)
2. For each scanned QR, validate the CRC16 integrity field (`CRC16-CCITT(payload[2:]) XOR 0xFACE`), extract block number and 2,950-byte packet
3. If block > 0 and block 0 not yet decoded: buffer the packet
4. Otherwise feed packet to `decoder.add(packet)` — returns decoded bytes when ready
5. On block 0 decoded: parse metadata, create decoders for data blocks using `Decoder.with_defaults(blockLength, 2946)` (blockLength is a bigint), replay buffered packets
6. When all data blocks decoded: concatenate and save — `Decoder.with_defaults(blockLen, mtu)` returns exactly `blockLen` bytes, no truncation needed
