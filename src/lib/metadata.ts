import { METADATA_SIZE, MTU, PROTOCOL_MAGIC } from './constants.js';

export interface Metadata {
  totalFileSize: bigint;
  numDataBlocks: number;
  symbolSize: number;
}

/** Build the 16-byte Block 0 source data from the file bytes. */
export function buildMetadata(fileBytes: Uint8Array, numDataBlocks: number): Uint8Array {
  const buf = new Uint8Array(METADATA_SIZE);
  buf.set(PROTOCOL_MAGIC, 0);
  const view = new DataView(buf.buffer);
  view.setBigUint64(4, BigInt(fileBytes.length), /*littleEndian=*/true);
  view.setUint16(12, numDataBlocks, true);
  view.setUint16(14, MTU, true);
  return buf;
}

/** Parse the 16-byte decoded Block 0 data. Throws on invalid magic or symbol_size. */
export function parseMetadata(data: Uint8Array): Metadata {
  if (data.length < METADATA_SIZE) throw new Error('Block 0 too short');
  if (data[0] !== PROTOCOL_MAGIC[0] || data[1] !== PROTOCOL_MAGIC[1] ||
      data[2] !== PROTOCOL_MAGIC[2] || data[3] !== PROTOCOL_MAGIC[3]) {
    throw new Error('Metadata magic mismatch — wrong protocol or version');
  }
  const view = new DataView(data.buffer, data.byteOffset);
  const totalFileSize = view.getBigUint64(4, true);
  const numDataBlocks = view.getUint16(12, true);
  const symbolSize    = view.getUint16(14, true);
  if (symbolSize !== MTU) throw new Error(`Unexpected symbol_size ${symbolSize}, expected ${MTU}`);
  return { totalFileSize, numDataBlocks, symbolSize };
}
