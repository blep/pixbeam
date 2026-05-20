/**
 * Local-test-only helpers. Requires `sharp` and `canvas` (optional native deps).
 * Not imported by CI tests.
 */
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

export interface ChannelProfile {
  lossRate?: number;
  burstEvery?: number;
  burstLen?: number;
  blur?: number;
  noise?: number;
  rotation?: number;
}

export const PROFILES: Record<string, ChannelProfile> = {
  perfect:  { lossRate: 0,    blur: 0,   noise: 0,    rotation: 0 },
  noisy:    { lossRate: 0.05, blur: 0.5, noise: 0.03, rotation: 0 },
  shaky:    { lossRate: 0.10, blur: 0.5, noise: 0,    rotation: 2 },
  degraded: { lossRate: 0.20, blur: 1.5, noise: 0.05, rotation: 3 },
  burst:    { lossRate: 0,    burstEvery: 50, burstLen: 10 },
  highLoss: { lossRate: 0.45 },
};

/**
 * Generate a Version 40-L QR image from a raw payload, apply optical distortions,
 * then decode back with jsQR. Returns the decoded payload or null (frame lost).
 *
 * All random decisions are driven by the provided PRNG so results are reproducible.
 */
export class VirtualChannel {
  private frameCount = 0;

  constructor(
    private readonly profile: ChannelProfile,
    private readonly rng: () => number,
  ) {}

  async passThrough(rawPayload: Uint8Array): Promise<Uint8Array | null> {
    const frame = this.frameCount++;

    // Deterministic burst loss
    if (this.profile.burstEvery && this.profile.burstLen) {
      if ((frame % this.profile.burstEvery) < this.profile.burstLen) return null;
    }

    // Random loss (seeded PRNG — not Math.random)
    if (this.rng() < (this.profile.lossRate ?? 0)) return null;

    // Generate QR as PNG
    const pngBuf: Buffer = await QRCode.toBuffer(
      [{ data: Buffer.from(rawPayload), mode: 'byte' }],
      { version: 40, errorCorrectionLevel: 'L', margin: 2, scale: 4 }
    );

    // Apply distortions
    const distorted = await applyDistortions(pngBuf, this.profile, this.rng);

    // Decode back with jsQR
    const png  = PNG.sync.read(distorted);
    const rgba = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
    const qr   = jsQR(rgba, png.width, png.height);
    if (!qr) return null;
    return new Uint8Array(qr.binaryData);
  }
}

async function applyDistortions(
  pngBuf: Buffer,
  profile: ChannelProfile,
  rng: () => number,
): Promise<Buffer> {
  // Lazy-import sharp so CI doesn't load native modules
  const sharp = (await import('sharp')).default;

  let img = sharp(pngBuf);
  const meta = await img.metadata();
  const w = meta.width!;
  const h = meta.height!;

  if (profile.rotation && profile.rotation > 0) {
    // Apply a small random rotation in [-rotation, +rotation] degrees
    const angle = (rng() * 2 - 1) * profile.rotation;
    img = img.rotate(angle, { background: { r: 255, g: 255, b: 255, alpha: 1 } });
  }

  if (profile.blur && profile.blur > 0) {
    img = img.blur(profile.blur);
  }

  if (profile.noise && profile.noise > 0) {
    // Add noise by compositing a random noise layer
    const noiseData = Buffer.alloc(w * h * 3);
    for (let i = 0; i < noiseData.length; i++) {
      // Only perturb some pixels based on noise probability
      noiseData[i] = rng() < profile.noise ? ((rng() * 256) >>> 0) : 128;
    }
    const noiseImg = await sharp(noiseData, { raw: { width: w, height: h, channels: 3 } })
      .png().toBuffer();
    img = img.composite([{ input: noiseImg, blend: 'overlay' }]);
  }

  return img.png().toBuffer();
}

/**
 * Run a full transfer through the virtual channel.
 * Returns the recovered file bytes.
 */
export async function runWithChannel(
  driver: { sender: Iterable<{ blockNum: number; packet: Uint8Array; payload: Uint8Array }> },
  rx: import('../../src/lib/receiver.js').Receiver,
  channel: VirtualChannel,
  maxFrames = 200_000,
): Promise<Uint8Array> {
  let count = 0;
  for (const frame of driver.sender) {
    if (count++ >= maxFrames) throw new Error(`Did not complete within ${maxFrames} frames`);
    const decoded = await channel.passThrough(frame.payload);
    if (decoded !== null) rx.receive(decoded);
    if (rx.isComplete()) break;
  }
  return rx.getFile();
}
