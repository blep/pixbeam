import type { Encoder, Decoder } from 'raptorq';
import { Sender } from '../../src/lib/sender.js';
import { Receiver } from '../../src/lib/receiver.js';

export type DropFn = (frameIndex: number, blockNum: number, esi: number) => boolean;

/**
 * Drives a full encode/decode cycle in memory, bypassing QR image
 * generation/decoding. Used for all CI and multi-block local tests.
 */
export class ProtocolDriver {
  private readonly sender: Sender;
  private readonly receiver: Receiver;

  constructor(
    fileBytes: Uint8Array,
    EncoderClass: typeof Encoder,
    DecoderClass: typeof Decoder,
  ) {
    this.sender   = new Sender(fileBytes, EncoderClass);
    this.receiver = new Receiver(DecoderClass);
  }

  /**
   * Feed payloads from the sender into the receiver until complete or maxFrames reached.
   * dropFn(frameIndex, blockNum, esi) → return true to silently drop that frame.
   */
  run(dropFn: DropFn = () => false, maxFrames = 500_000): Uint8Array {
    let frameIndex = 0;
    for (const frame of this.sender) {
      if (frameIndex >= maxFrames) throw new Error(`Did not complete within ${maxFrames} frames`);

      if (!dropFn(frameIndex, frame.blockNum, esiFromPacket(frame.packet))) {
        this.receiver.receive(frame.payload);
      }
      frameIndex++;
      if (this.receiver.isComplete()) break;
    }
    return this.receiver.getFile();
  }

  get rx(): Receiver { return this.receiver; }
}

function esiFromPacket(packet: Uint8Array): number {
  return (((packet[1] ?? 0) << 16) | ((packet[2] ?? 0) << 8) | (packet[3] ?? 0));
}
