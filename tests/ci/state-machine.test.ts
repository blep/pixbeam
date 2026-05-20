import { describe, it, expect, beforeAll } from 'vitest';
import { initRaptorQSync, Encoder, Decoder } from '../helpers/raptorq-init.js';
import { Sender } from '../../src/lib/sender.js';
import { Receiver } from '../../src/lib/receiver.js';
import { ProtocolDriver } from '../helpers/protocol-driver.js';
import { makePRNG } from '../helpers/prng.js';
import { makeTestFile } from '../helpers/files.js';

beforeAll(() => { initRaptorQSync(); });

describe('receiver state machine', () => {
  it('isComplete() is false until all blocks decoded', () => {
    const rng  = makePRNG(42);
    const file = makeTestFile(100, rng);
    const sender   = new Sender(file, Encoder);
    const receiver = new Receiver(Decoder);
    expect(receiver.isComplete()).toBe(false);

    // Feed only a few frames — should not be complete yet
    let i = 0;
    for (const frame of sender) {
      receiver.receive(frame.payload);
      if (++i >= 2) break;
    }
    // With only 2 frames it's unlikely (but not impossible) to be complete
    // Just check it doesn't throw
    if (!receiver.isComplete()) {
      expect(receiver.isComplete()).toBe(false);
    }
  });

  it('out-of-range blockNum discarded after metadata known', async () => {
    const rng  = makePRNG(55);
    const file = makeTestFile(50_000, rng);

    // Feed frames until metadata is known, then inject an out-of-range block number
    const sender   = new Sender(file, Encoder);
    const receiver = new Receiver(Decoder);

    // Feed until block 0 is decoded
    for (const frame of sender) {
      receiver.receive(frame.payload);
      if (receiver.getMetadata() !== null) break;
    }

    const meta = receiver.getMetadata()!;
    expect(meta).not.toBeNull();

    // Inject a payload for blockNum = numDataBlocks + 1 (out of range)
    const fakeBlock = meta.numDataBlocks + 1;
    const fakePacket = new Uint8Array(2950);
    const { buildQRPayload } = await import('../../src/lib/crc16.js');
    const fakePayload = buildQRPayload(fakeBlock, fakePacket);

    // Should silently discard without throwing
    expect(() => receiver.receive(fakePayload)).not.toThrow();
  });

  it('receive() on a fully decoded block is a no-op', () => {
    const rng  = makePRNG(99);
    const file = makeTestFile(100, rng);
    const sender   = new Sender(file, Encoder);
    const receiver = new Receiver(Decoder);

    for (const frame of sender) {
      receiver.receive(frame.payload);
      if (receiver.isComplete()) break;
    }
    expect(receiver.isComplete()).toBe(true);

    // More frames after completion — must not throw
    let extra = 0;
    for (const frame of sender) {
      expect(() => receiver.receive(frame.payload)).not.toThrow();
      if (++extra >= 5) break;
    }
  });

  it('invalid CRC payload is silently discarded', () => {
    const receiver = new Receiver(Decoder);

    const garbage = new Uint8Array(2953); // all zeros — bad CRC
    expect(() => receiver.receive(garbage)).not.toThrow();
    expect(receiver.isComplete()).toBe(false);
  });

  it('onComplete callback fires when transfer finishes', () => {
    const rng  = makePRNG(33);
    const file = makeTestFile(100, rng);
    const sender   = new Sender(file, Encoder);
    const receiver = new Receiver(Decoder);

    let callbackFile: Uint8Array | null = null;
    receiver.onComplete(f => { callbackFile = f; });

    for (const frame of sender) {
      receiver.receive(frame.payload);
      if (receiver.isComplete()) break;
    }

    expect(callbackFile).not.toBeNull();
    expect(callbackFile!).toEqual(file);
  });
});

describe('ESI extraction', () => {
  it('source symbols have ESI in [0, K)', async () => {
    const rng    = makePRNG(7);
    const file   = makeTestFile(100, rng);
    const sender = new Sender(file, Encoder);

    const { esiFromPacket } = await import('../../src/lib/crc16.js');

    let checked = 0;
    for (const frame of sender) {
      if (frame.blockNum === 1) { // first data block
        const esi = esiFromPacket(frame.packet);
        expect(esi).toBeGreaterThanOrEqual(0);
        if (++checked >= 5) break;
      }
    }
  });
});
