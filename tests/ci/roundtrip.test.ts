import { describe, it, expect, beforeAll } from 'vitest';
import { initRaptorQSync, Encoder, Decoder } from '../helpers/raptorq-init.js';
import { ProtocolDriver } from '../helpers/protocol-driver.js';
import { makePRNG, resolveTestSeed } from '../helpers/prng.js';
import { makeTestFile } from '../helpers/files.js';

beforeAll(() => { initRaptorQSync(); });

describe('single-block roundtrip (no loss)', () => {
  const seed = resolveTestSeed();
  const rng  = makePRNG(seed);

  it('100-byte file', () => {
    const file = makeTestFile(100, rng);
    const out  = new ProtocolDriver(file, Encoder, Decoder).run();
    expect(out).toEqual(file);
  });

  it('50 KB file', () => {
    const file = makeTestFile(50_000, rng);
    const out  = new ProtocolDriver(file, Encoder, Decoder).run();
    expect(out).toEqual(file);
  });

  it('1-byte file', () => {
    const file = makeTestFile(1, rng);
    const out  = new ProtocolDriver(file, Encoder, Decoder).run();
    expect(out).toEqual(file);
  });
});

describe('repair symbol generation (no cycling)', () => {
  it('first 2000 packets for a small block have strictly increasing ESIs', async () => {
    const file    = makeTestFile(100, makePRNG(1));
    const driver  = new ProtocolDriver(file, Encoder, Decoder);
    const seenESI = new Set<number>();
    let prev = -1;
    let count = 0;

    for (const frame of (driver as any).sender) {
      if (frame.blockNum !== 1) continue; // data block
      const esi = ((frame.packet[1] ?? 0) << 16) | ((frame.packet[2] ?? 0) << 8) | (frame.packet[3] ?? 0);
      expect(esi).toBeGreaterThan(prev);
      expect(seenESI.has(esi)).toBe(false);
      seenESI.add(esi);
      prev = esi;
      if (++count >= 2000) break;
    }
  });
});
