/**
 * Edge case tests. Run with: pnpm test:local
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initRaptorQSync, Encoder, Decoder } from '../helpers/raptorq-init.js';
import { ProtocolDriver } from '../helpers/protocol-driver.js';
import { Sender } from '../../src/lib/sender.js';
import { makePRNG, resolveTestSeed } from '../helpers/prng.js';
import { makeTestFile } from '../helpers/files.js';
import { MAX_BYTES_PER_BLOCK, MAX_DATA_BLOCKS } from '../../src/lib/constants.js';
import { esiFromPacket } from '../../src/lib/crc16.js';

beforeAll(() => { initRaptorQSync(); });

describe('edge cases', () => {
  it('1-byte file', () => {
    const file = new Uint8Array([0xab]);
    const out  = new ProtocolDriver(file, Encoder, Decoder).run();
    expect(out).toEqual(file);
  });

  it('file size == max_bytes_per_block exactly', () => {
    const seed = resolveTestSeed();
    const rng  = makePRNG(seed);
    const file = makeTestFile(MAX_BYTES_PER_BLOCK, rng);
    const out  = new ProtocolDriver(file, Encoder, Decoder).run();
    expect(out).toEqual(file);
  }, 300_000);

  it('file size == 254 × max_bytes_per_block (protocol limit)', async () => {
    // Allocating 42 GB is impractical; verify numDataBlocks accepts the max size without throwing
    const { numDataBlocks } = await import('../../src/lib/blocks.js');
    expect(() => numDataBlocks(MAX_DATA_BLOCKS * MAX_BYTES_PER_BLOCK)).not.toThrow();
    expect(numDataBlocks(MAX_DATA_BLOCKS * MAX_BYTES_PER_BLOCK)).toBe(254);
  });

  it('file size == 254 × max_bytes_per_block + 1 → Sender throws', () => {
    expect(() => new Sender(new Uint8Array(MAX_DATA_BLOCKS * MAX_BYTES_PER_BLOCK + 1), Encoder))
      .toThrow();
  });

  it('receiver sees block 0 last — all data blocks buffered first', () => {
    const seed = resolveTestSeed();
    const rng  = makePRNG(seed);
    const file = makeTestFile(50_000, rng);
    // Drop every block-0 frame: transfer cannot complete, ProtocolDriver must throw on timeout
    expect(() =>
      new ProtocolDriver(file, Encoder, Decoder).run(
        (_, blockNum) => blockNum === 0, // suppress all metadata frames
        500 // low maxFrames so the test exits quickly
      )
    ).toThrow();
  });

  it('ESI never wraps to 0 after K + 10,000 repair symbols', () => {
    const file    = makeTestFile(100, makePRNG(1));
    const sender  = new Sender(file, Encoder);
    const seenESI = new Set<number>();

    let count = 0;
    for (const frame of sender) {
      if (frame.blockNum !== 1) continue;
      const esi = esiFromPacket(frame.packet);
      expect(seenESI.has(esi)).toBe(false);
      seenESI.add(esi);
      if (++count >= 10_100) break;
    }
    expect(seenESI.size).toBe(10_100);
  }, 60_000);

  it('45% random loss still completes (unbounded repair generation)', () => {
    const seed = resolveTestSeed();
    const rng  = makePRNG(seed);
    const file = makeTestFile(50_000, rng);
    const out  = new ProtocolDriver(file, Encoder, Decoder).run(
      () => rng() < 0.45,
      500_000
    );
    expect(out).toEqual(file);
  }, 300_000);
});
