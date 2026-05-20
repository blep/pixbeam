import { describe, it, expect, beforeAll } from 'vitest';
import { initRaptorQSync, Encoder, Decoder } from '../helpers/raptorq-init.js';
import { Sender } from '../../src/lib/sender.js';
import { Receiver } from '../../src/lib/receiver.js';
import { makePRNG } from '../helpers/prng.js';
import { makeTestFile } from '../helpers/files.js';

beforeAll(() => { initRaptorQSync(); });

describe('block 0 bootstrap', () => {
  it('data-block packets buffered before block 0 → replayed after block 0 decoded', () => {
    const rng  = makePRNG(77);
    const file = makeTestFile(50_000, rng);
    const sender   = new Sender(file, Encoder);
    const receiver = new Receiver(Decoder);

    // Collect all block-0 and block-1 frames up front
    const block0Frames: Uint8Array[] = [];
    const block1Frames: Uint8Array[] = [];

    for (const frame of sender) {
      if (frame.blockNum === 0) block0Frames.push(frame.payload);
      else block1Frames.push(frame.payload);

      if (block0Frames.length >= 4 && block1Frames.length >= 30) break;
    }

    // Feed block-1 frames FIRST (before block 0) — they should be buffered
    for (const p of block1Frames) receiver.receive(p);
    expect(receiver.getMetadata()).toBeNull(); // block 0 not yet decoded

    // Now feed block-0 frames — triggers buffer replay
    for (const p of block0Frames) receiver.receive(p);

    if (!receiver.isComplete()) {
      // Feed more data if needed
      for (const frame of sender) {
        receiver.receive(frame.payload);
        if (receiver.isComplete()) break;
      }
    }

    expect(receiver.isComplete()).toBe(true);
    expect(receiver.getFile()).toEqual(file);
  });

  it('round-robin interleaved (normal order) → same result', () => {
    const rng  = makePRNG(88);
    const file = makeTestFile(50_000, rng);
    const out  = new (class extends Sender {})(file, Encoder);
    const rx   = new Receiver(Decoder);
    for (const frame of out) {
      rx.receive(frame.payload);
      if (rx.isComplete()) break;
    }
    expect(rx.getFile()).toEqual(file);
  });
});
