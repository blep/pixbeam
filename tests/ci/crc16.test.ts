import { describe, it, expect } from 'vitest';
import { crc16, buildQRPayload, isValidPayload } from '../../src/lib/crc16.js';
import { makePRNG, resolveTestSeed } from '../helpers/prng.js';

describe('crc16', () => {
  it('known vector: "123456789" → 0x29B1 (standard CCITT check value)', () => {
    const input = new Uint8Array([0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39]);
    expect(crc16(input)).toBe(0x29b1);
  });

  it('empty input → 0xFFFF (initial value)', () => {
    expect(crc16(new Uint8Array(0))).toBe(0xffff);
  });
});

describe('buildQRPayload / isValidPayload', () => {
  const seed = resolveTestSeed();
  const rng  = makePRNG(seed);

  it('round-trip: valid payload passes validation', () => {
    const packet = new Uint8Array(2950);
    for (let i = 0; i < 2950; i++) packet[i] = (rng() * 256) >>> 0;
    const payload = buildQRPayload(42, packet);
    expect(payload.length).toBe(2953);
    expect(payload[2]).toBe(42);
    expect(isValidPayload(payload)).toBe(true);
  });

  it('wrong length → false', () => {
    expect(isValidPayload(new Uint8Array(100))).toBe(false);
  });

  it('single-byte flip in data (byte 5) → false', () => {
    const packet = new Uint8Array(2950);
    const payload = buildQRPayload(0, packet);
    payload[5]! ^= 0xff;
    expect(isValidPayload(payload)).toBe(false);
  });

  it('single-byte flip in integrity field (byte 0) → false', () => {
    const packet = new Uint8Array(2950);
    const payload = buildQRPayload(0, packet);
    payload[0]! ^= 0x01;
    expect(isValidPayload(payload)).toBe(false);
  });

  it('single-byte flip in integrity field (byte 1) → false', () => {
    const packet = new Uint8Array(2950);
    const payload = buildQRPayload(1, packet);
    payload[1]! ^= 0x80;
    expect(isValidPayload(payload)).toBe(false);
  });
});
