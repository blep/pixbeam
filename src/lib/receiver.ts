import type { Decoder } from 'raptorq';
import { MTU, METADATA_SIZE } from './constants.js';
import { parseMetadata, type Metadata } from './metadata.js';
import { dataBlockLength, sourceSymbolCount } from './blocks.js';
import { isValidPayload, esiFromPacket } from './crc16.js';

export interface BlockProgress {
  blockNum: number;
  seenSymbols: number;
  totalSymbols: number; // 0 if unknown (before block 0 decoded)
  decoded: boolean;
}

/**
 * Receiver state machine. Accepts 2,953-byte QR payloads and reconstructs the file.
 *
 * Usage (after awaiting initRaptorQ()):
 *   const rx = new Receiver(DecoderClass);
 *   rx.receive(payload);
 *   if (rx.isComplete()) saveFile(rx.getFile());
 */
export class Receiver {
  private readonly DecoderClass: typeof Decoder;
  private readonly decoders   = new Map<number, Decoder>();
  private readonly pending    = new Map<number, Uint8Array[]>(); // pre-block-0 buffer
  private readonly decoded    = new Map<number, Uint8Array>();
  private readonly seenESIs   = new Map<number, Set<number>>();

  private meta: Metadata | null = null;
  private _complete = false;
  private _file: Uint8Array | null = null;
  private _onComplete: ((file: Uint8Array) => void) | null = null;

  constructor(DecoderClass: typeof Decoder) {
    this.DecoderClass = DecoderClass;
    // Block 0: K₀=1, transfer_length=16 bytes — both are protocol constants
    this.decoders.set(0, DecoderClass.with_defaults(BigInt(METADATA_SIZE), MTU));
    this.seenESIs.set(0, new Set());
  }

  /** Register a callback invoked when all blocks are decoded. */
  onComplete(cb: (file: Uint8Array) => void): void {
    this._onComplete = cb;
    if (this._complete && this._file) cb(this._file);
  }

  receive(payload: Uint8Array): void {
    if (this._complete) return;
    if (!isValidPayload(payload)) return;

    const blockNum = payload[2]!;
    const packet   = payload.slice(3); // 2,950-byte EncodingPacket
    const esi      = esiFromPacket(packet);

    // Discard out-of-range blocks once metadata is known
    if (this.meta !== null && blockNum > this.meta.numDataBlocks) return;
    if (this.decoded.has(blockNum)) return;

    // Track ESI for progress
    if (!this.seenESIs.has(blockNum)) this.seenESIs.set(blockNum, new Set());
    this.seenESIs.get(blockNum)!.add(esi);

    if (this.decoders.has(blockNum)) {
      const result = this.decoders.get(blockNum)!.add(packet);
      if (result !== undefined) this.handleDecoded(blockNum, result);
    } else {
      // Buffer data-block packets arriving before block 0 is decoded
      if (!this.pending.has(blockNum)) this.pending.set(blockNum, []);
      this.pending.get(blockNum)!.push(packet);
    }
  }

  private handleDecoded(blockNum: number, data: Uint8Array): void {
    this.decoded.set(blockNum, data);
    this.decoders.get(blockNum)?.free();
    this.decoders.delete(blockNum);

    if (blockNum === 0) {
      this.meta = parseMetadata(data); // throws on bad magic / symbol_size

      for (let i = 1; i <= this.meta.numDataBlocks; i++) {
        const blen = dataBlockLength(i, this.meta.numDataBlocks, this.meta.totalFileSize);
        this.decoders.set(i, this.DecoderClass.with_defaults(blen, MTU));
        if (!this.seenESIs.has(i)) this.seenESIs.set(i, new Set());

        // Replay buffered packets; decoder may be deleted mid-loop if it decodes early
        for (const pkt of (this.pending.get(i) ?? [])) {
          if (!this.decoders.has(i)) break;
          const result = this.decoders.get(i)!.add(pkt);
          if (result !== undefined) this.handleDecoded(i, result);
        }
        this.pending.delete(i);
      }
    }

    this.checkComplete();
  }

  private checkComplete(): void {
    if (this.meta === null) return;
    for (let i = 1; i <= this.meta.numDataBlocks; i++) {
      if (!this.decoded.has(i)) return;
    }
    // Concatenate data blocks 1…N. Decoder returns exactly blockLen bytes.
    const parts: Uint8Array[] = [];
    for (let i = 1; i <= this.meta.numDataBlocks; i++) parts.push(this.decoded.get(i)!);

    const file = concat(parts);
    this._file = file;
    this._complete = true;

    // Free remaining decoder memory
    for (const dec of this.decoders.values()) dec.free();
    this.decoders.clear();

    this._onComplete?.(file);
  }

  isComplete(): boolean { return this._complete; }

  getFile(): Uint8Array {
    if (!this._complete || !this._file) throw new Error('Transfer not yet complete');
    return this._file;
  }

  /** Current progress per known block. */
  progress(): BlockProgress[] {
    const result: BlockProgress[] = [];

    // Block 0 (metadata)
    result.push({
      blockNum:     0,
      seenSymbols:  this.seenESIs.get(0)?.size ?? 0,
      totalSymbols: 1, // K₀ = 1 always
      decoded:      this.decoded.has(0),
    });

    if (this.meta !== null) {
      for (let i = 1; i <= this.meta.numDataBlocks; i++) {
        const blen = dataBlockLength(i, this.meta.numDataBlocks, this.meta.totalFileSize);
        result.push({
          blockNum:     i,
          seenSymbols:  this.seenESIs.get(i)?.size ?? 0,
          totalSymbols: sourceSymbolCount(blen),
          decoded:      this.decoded.has(i),
        });
      }
    }
    return result;
  }

  /** Metadata from block 0, or null before it is decoded. */
  getMetadata(): Metadata | null { return this.meta; }
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}
