/**
 * Multi-block file tests — bypass QR, use ProtocolDriver directly.
 * Run with: pnpm test:local
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initRaptorQSync, Encoder, Decoder } from '../helpers/raptorq-init.js';
import { ProtocolDriver } from '../helpers/protocol-driver.js';
import { makePRNG, resolveTestSeed } from '../helpers/prng.js';
import { makeTestFile } from '../helpers/files.js';
import { MAX_BYTES_PER_BLOCK } from '../../src/lib/constants.js';

beforeAll(() => { initRaptorQSync(); });

describe('multi-block files', () => {
  it('two-block file (max_bytes_per_block + 1 byte), no loss', () => {
    const seed = resolveTestSeed();
    const rng  = makePRNG(seed);
    const file = makeTestFile(MAX_BYTES_PER_BLOCK + 1, rng);
    const out  = new ProtocolDriver(file, Encoder, Decoder).run();
    expect(out).toEqual(file);
  }, 300_000);

  it('four-block file (3 × max_bytes_per_block + 1 byte), no loss', () => {
    const seed = resolveTestSeed();
    const rng  = makePRNG(seed);
    const file = makeTestFile(3 * MAX_BYTES_PER_BLOCK + 1, rng);
    const out  = new ProtocolDriver(file, Encoder, Decoder).run();
    expect(out).toEqual(file);
  }, 600_000);

  it('two-block file (170 MB), 10% random loss', () => {
    const seed = resolveTestSeed();
    const rng  = makePRNG(seed);
    const file = makeTestFile(170 * 1024 * 1024, rng);
    const out  = new ProtocolDriver(file, Encoder, Decoder).run(
      () => rng() < 0.10
    );
    expect(out).toEqual(file);
  }, 600_000);
});
