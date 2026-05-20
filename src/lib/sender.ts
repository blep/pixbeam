import type { Encoder } from 'raptorq';
import { MTU } from './constants.js';
import { buildMetadata } from './metadata.js';
import { numDataBlocks, splitFile } from './blocks.js';
import { buildQRPayload } from './crc16.js';

export interface SenderFrame {
  blockNum: number;
  packet: Uint8Array;
  payload: Uint8Array; // 2,953-byte QR payload, ready to encode as QR
}

export interface BlockProgress {
  blockNum: number;
  framesSent: number;
  isMetadata: boolean;
}

/**
 * Encodes a file into an infinite stream of QR payloads.
 *
 * Usage (after awaiting initRaptorQ()):
 *   const sender = new Sender(fileBytes, EncoderClass);
 *   for (const frame of sender) { display(frame.payload); }
 */
export class Sender implements Iterable<SenderFrame> {
  private readonly encoders: Encoder[];
  private readonly pools: Uint8Array[][];
  private readonly cursors: number[];
  private readonly repairBudgets: number[];
  private readonly framesSent: number[];
  readonly numBlocks: number; // metadata + data blocks

  constructor(fileBytes: Uint8Array, EncoderClass: typeof Encoder) {
    const n = numDataBlocks(fileBytes.length);
    const chunks = splitFile(fileBytes);
    const meta = buildMetadata(fileBytes, n);

    const allBlocks = [meta, ...chunks];
    this.numBlocks = allBlocks.length;

    this.encoders = allBlocks.map(b => EncoderClass.with_defaults(b, MTU));
    // Start with source packets only; repair pool grows on demand
    this.pools        = this.encoders.map(enc => enc.encode(0));
    this.cursors      = new Array(this.numBlocks).fill(0);
    this.repairBudgets = new Array(this.numBlocks).fill(0);
    this.framesSent   = new Array(this.numBlocks).fill(0);
  }

  [Symbol.iterator](): Iterator<SenderFrame> {
    let blockNum = 0;
    return {
      next: (): IteratorResult<SenderFrame> => {
        const bn = blockNum % this.numBlocks;
        blockNum++;

        const cursor = this.cursors[bn]!;
        if (cursor >= this.pools[bn]!.length) {
          // Exhaust → double repair budget and regenerate pool
          const prev = this.repairBudgets[bn]!;
          this.repairBudgets[bn] = prev === 0 ? 128 : prev * 2;
          this.pools[bn] = this.encoders[bn]!.encode(this.repairBudgets[bn]!);
        }

        const packet = this.pools[bn]![this.cursors[bn]!]!;
        this.cursors[bn] = this.cursors[bn]! + 1;
        this.framesSent[bn] = this.framesSent[bn]! + 1;

        return {
          value: { blockNum: bn, packet, payload: buildQRPayload(bn, packet) },
          done: false,
        };
      },
    };
  }

  progress(): BlockProgress[] {
    return Array.from({ length: this.numBlocks }, (_, i) => ({
      blockNum: i,
      framesSent: this.framesSent[i]!,
      isMetadata: i === 0,
    }));
  }
}
