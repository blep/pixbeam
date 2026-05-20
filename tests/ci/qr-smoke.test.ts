/**
 * QR smoke tests — use real QR encoding/decoding but keep files tiny.
 * Stack: qrcode (generate) → pngjs (PNG decode) → jsQR (QR decode).
 * No native canvas required, so these run in CI.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initRaptorQSync, Encoder, Decoder } from '../helpers/raptorq-init.js';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { Sender } from '../../src/lib/sender.js';
import { Receiver } from '../../src/lib/receiver.js';
import { isValidPayload, buildQRPayload } from '../../src/lib/crc16.js';
import { makePRNG } from '../helpers/prng.js';
import { makeTestFile } from '../helpers/files.js';

beforeAll(() => { initRaptorQSync(); });

/** Encode payload as a Version 40-L QR PNG buffer and decode back with jsQR. */
async function qrRoundTrip(payload: Uint8Array): Promise<Uint8Array | null> {
  // Generate QR as PNG
  const pngBuf: Buffer = await QRCode.toBuffer(
    [{ data: Buffer.from(payload), mode: 'byte' }],
    { version: 40, errorCorrectionLevel: 'L', margin: 2 }
  );

  // Decode PNG → raw RGBA
  const png = PNG.sync.read(pngBuf);
  const rgba = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);

  // Decode QR
  const result = jsQR(rgba, png.width, png.height);
  if (!result) return null;
  return new Uint8Array(result.binaryData);
}

describe('QR smoke tests', () => {
  it('metadata block: encode as QR → decode → feeds into receiver correctly', async () => {
    const rng     = makePRNG(1);
    const file    = makeTestFile(100, rng);
    const sender  = new Sender(file, Encoder);
    const receiver = new Receiver(Decoder);

    // Feed block-0 frames through real QR until metadata decoded
    for (const frame of sender) {
      if (frame.blockNum !== 0) continue;

      const decoded = await qrRoundTrip(frame.payload);
      expect(decoded).not.toBeNull();
      expect(decoded!.length).toBe(2953);
      expect(isValidPayload(decoded!)).toBe(true);

      receiver.receive(decoded!);
      if (receiver.getMetadata() !== null) break;
    }

    expect(receiver.getMetadata()).not.toBeNull();
    expect(receiver.getMetadata()!.totalFileSize).toBe(BigInt(file.length));
  }, 30_000);

  it('1 KB file through real QR pipeline (perfect channel)', async () => {
    const rng      = makePRNG(2);
    const file     = makeTestFile(1024, rng);
    const sender   = new Sender(file, Encoder);
    const receiver = new Receiver(Decoder);

    for (const frame of sender) {
      const decoded = await qrRoundTrip(frame.payload);
      if (decoded !== null) receiver.receive(decoded);
      if (receiver.isComplete()) break;
    }

    expect(receiver.isComplete()).toBe(true);
    expect(receiver.getFile()).toEqual(file);
  }, 60_000);

  it('corrupted payload is rejected by isValidPayload', async () => {
    const packet  = new Uint8Array(2950);
    const payload = buildQRPayload(0, packet);
    // Corrupt a data byte but keep the integrity field wrong
    payload[10]! ^= 0xff;
    expect(isValidPayload(payload)).toBe(false);
  });
});
