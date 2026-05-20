/**
 * Optical channel simulation tests.
 * Require: sharp (native). Run with: pnpm test:local
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initRaptorQSync, Encoder, Decoder } from '../helpers/raptorq-init.js';
import { Sender } from '../../src/lib/sender.js';
import { Receiver } from '../../src/lib/receiver.js';
import { VirtualChannel, PROFILES, runWithChannel } from '../helpers/virtual-channel.js';
import { makePRNG, resolveTestSeed } from '../helpers/prng.js';
import { makeTestFile } from '../helpers/files.js';

beforeAll(() => { initRaptorQSync(); });

const FILE_SIZE = 50_000; // 50 KB — fast to encode/decode

function makeDriver(file: Uint8Array) {
  return {
    sender: new Sender(file, Encoder) as Iterable<{ blockNum: number; packet: Uint8Array; payload: Uint8Array }>,
  };
}

describe('optical channel tests (50 KB file)', () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    it(`profile: ${name}`, async () => {
      const seed = resolveTestSeed();
      const rng  = makePRNG(seed);
      const file = makeTestFile(FILE_SIZE, rng);

      const driver  = makeDriver(file);
      const rx      = new Receiver(Decoder);
      const channel = new VirtualChannel(profile, rng);

      const recovered = await runWithChannel(driver, rx, channel, 50_000);
      expect(recovered).toEqual(file);
    }, 120_000);
  }

  it('receiver joins late (misses first 40% of stream)', async () => {
    const seed = resolveTestSeed();
    const rng  = makePRNG(seed);
    const file = makeTestFile(FILE_SIZE, rng);

    const sender  = new Sender(file, Encoder);
    const rx      = new Receiver(Decoder);
    const channel = new VirtualChannel(PROFILES.perfect!, rng);

    let frame = 0;
    for (const f of sender) {
      frame++;
      if (frame < 20) continue; // skip first ~20 frames (late start)
      const decoded = await channel.passThrough(f.payload);
      if (decoded !== null) rx.receive(decoded);
      if (rx.isComplete()) break;
      if (frame > 50_000) throw new Error('Timeout');
    }

    expect(rx.isComplete()).toBe(true);
    expect(rx.getFile()).toEqual(file);
  }, 120_000);

  it('block-0 frames withheld for first 200 frames → buffered data replayed', async () => {
    const seed = resolveTestSeed();
    const rng  = makePRNG(seed);
    const file = makeTestFile(FILE_SIZE, rng);

    const sender  = new Sender(file, Encoder);
    const rx      = new Receiver(Decoder);
    const channel = new VirtualChannel(PROFILES.perfect!, rng);

    let frame = 0;
    for (const f of sender) {
      frame++;
      // Drop all block-0 frames for the first 200 frames
      if (frame <= 200 && f.blockNum === 0) continue;

      const decoded = await channel.passThrough(f.payload);
      if (decoded !== null) rx.receive(decoded);
      if (rx.isComplete()) break;
      if (frame > 50_000) throw new Error('Timeout');
    }

    expect(rx.isComplete()).toBe(true);
    expect(rx.getFile()).toEqual(file);
  }, 120_000);
});
