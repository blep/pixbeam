/**
 * Long-running stress tests. Run with: pnpm test:stress
 * These are slow (minutes) and are not run in CI or local test:local.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initRaptorQSync, Encoder, Decoder } from '../helpers/raptorq-init.js';
import { ProtocolDriver } from '../helpers/protocol-driver.js';
import { Sender } from '../../src/lib/sender.js';
import { Receiver } from '../../src/lib/receiver.js';
import { makePRNG, resolveTestSeed } from '../helpers/prng.js';
import { makeTestFile } from '../helpers/files.js';

beforeAll(() => { initRaptorQSync(); });

describe('stress tests', () => {
  it('500 MB file, shaky channel (10% loss)', () => {
    const seed = resolveTestSeed();
    const rng  = makePRNG(seed);
    const file = makeTestFile(500 * 1024 * 1024, rng);
    const out  = new ProtocolDriver(file, Encoder, Decoder).run(
      () => rng() < 0.10,
      10_000_000
    );
    expect(out).toEqual(file);
  }, 3_600_000);

  it('two receivers starting at different stream offsets both recover the same file', () => {
    const seed = resolveTestSeed();
    const rng  = makePRNG(seed);
    const file = makeTestFile(50 * 1024 * 1024, rng); // 50 MB to keep it manageable

    const senderA = new Sender(file, Encoder);
    const senderB = new Sender(file, Encoder); // independent sender state
    const rxA = new Receiver(Decoder);
    const rxB = new Receiver(Decoder);

    let frameA = 0;
    let frameB = 0;

    for (const frame of senderA) {
      frameA++;
      rxA.receive(frame.payload);
      if (rxA.isComplete()) break;
    }

    // rxB starts 500 frames late
    for (const frame of senderB) {
      frameB++;
      if (frameB < 500) continue;
      rxB.receive(frame.payload);
      if (rxB.isComplete()) break;
    }

    expect(rxA.getFile()).toEqual(file);
    expect(rxB.getFile()).toEqual(file);
  }, 1_800_000);
});
