export const MTU = 2946;
export const MAX_BYTES_PER_BLOCK = 56_403 * MTU; // ≈166.2 MB — RFC 6330 limit
export const MAX_DATA_BLOCKS = 254;               // block 0 reserved for metadata
export const QR_PAYLOAD_SIZE = 2953;              // Version 40-L binary capacity
export const METADATA_SIZE = 16;
export const PROTOCOL_MAGIC = new Uint8Array([0x50, 0x58, 0x42, 0x30]); // 'PXB0'
