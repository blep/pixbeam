/** CRC16-CCITT: polynomial 0x1021, initial value 0xFFFF. */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++)
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * Build a 2,953-byte QR payload.
 * Layout: [integrity(2)] [blockNum(1)] [encodingPacket(2950)]
 * Integrity = CRC16(payload[2:]) XOR 0xFACE, big-endian.
 */
export function buildQRPayload(blockNum: number, encodingPacket: Uint8Array): Uint8Array {
  const buf = new Uint8Array(2953);
  buf[2] = blockNum;
  buf.set(encodingPacket, 3);
  const check = crc16(buf.subarray(2)) ^ 0xface;
  buf[0] = (check >> 8) & 0xff;
  buf[1] = check & 0xff;
  return buf;
}

/** Returns true if the 2,953-byte payload has a valid integrity field. */
export function isValidPayload(payload: Uint8Array): boolean {
  if (payload.length !== 2953) return false;
  const check = crc16(payload.subarray(2)) ^ 0xface;
  return payload[0] === ((check >> 8) & 0xff) && payload[1] === (check & 0xff);
}

/** Extract the 24-bit ESI from a 2,950-byte EncodingPacket (FEC payload ID bytes 1-3). */
export function esiFromPacket(packet: Uint8Array): number {
  return ((packet[1] ?? 0) << 16) | ((packet[2] ?? 0) << 8) | (packet[3] ?? 0);
}
