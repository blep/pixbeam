import { MAX_BYTES_PER_BLOCK, MAX_DATA_BLOCKS, MTU } from './constants.js';

/** Number of data blocks needed for a file of the given size. Throws if > 254. */
export function numDataBlocks(fileSize: number): number {
  const n = Math.ceil(fileSize / MAX_BYTES_PER_BLOCK);
  if (n > MAX_DATA_BLOCKS) {
    throw new Error(
      `File too large: requires ${n} blocks, maximum is ${MAX_DATA_BLOCKS} (≈${MAX_DATA_BLOCKS * MAX_BYTES_PER_BLOCK / 1e9 | 0} GB). Split the file and transfer in multiple sessions.`
    );
  }
  return Math.max(n, 1); // at least one data block, even for empty files
}

/** Split file bytes into chunks; returns array of exactly numDataBlocks(fileBytes.length) slices. */
export function splitFile(fileBytes: Uint8Array): Uint8Array[] {
  const n = numDataBlocks(fileBytes.length);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const start = i * MAX_BYTES_PER_BLOCK;
    const end   = Math.min(start + MAX_BYTES_PER_BLOCK, fileBytes.length);
    chunks.push(fileBytes.subarray(start, end));
  }
  return chunks;
}

/**
 * Byte length of data block i (1-indexed) as a bigint.
 * Required by Decoder.with_defaults(transferLength: bigint, mtu).
 */
export function dataBlockLength(
  i: number,
  n: number,
  totalFileSize: bigint,
): bigint {
  const maxBytes = BigInt(MAX_BYTES_PER_BLOCK);
  const start    = BigInt(i - 1) * maxBytes;
  const end      = start + maxBytes < totalFileSize ? start + maxBytes : totalFileSize;
  return end - start;
}

/** Number of source symbols (K) in a block of the given byte length. */
export function sourceSymbolCount(blockLengthBytes: bigint): number {
  return Math.ceil(Number(blockLengthBytes) / MTU);
}
