/// A unit of data decoded from one captured frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedPacket {
    /// Application block number (0 = metadata, 1..N = file data).
    pub block_number: u8,
    /// Payload bytes carried by this packet.
    pub payload: Vec<u8>,
}

/// CRC16-CCITT (polynomial 0x1021, initial value 0xFFFF).
///
/// Carried over from the QR protocol heritage (branch `main_old_qrcode`),
/// where each frame payload was validated with `CRC16(payload) XOR 0xFACE`
/// to reject frames corrupted by motion blur or optical noise. The new
/// pixel-encoding protocol is expected to keep a similar integrity field.
pub fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= u16::from(byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

#[cfg(test)]
mod tests {
    use super::crc16_ccitt;

    #[test]
    fn crc16_ccitt_check_value() {
        // CRC-16/CCITT-FALSE check value for "123456789" is 0x29B1.
        assert_eq!(crc16_ccitt(b"123456789"), 0x29B1);
    }
}
