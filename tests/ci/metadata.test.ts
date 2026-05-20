import { describe, it, expect } from 'vitest';
import { buildMetadata, parseMetadata } from '../../src/lib/metadata.js';
import { MTU, METADATA_SIZE } from '../../src/lib/constants.js';

describe('buildMetadata', () => {
  it('produces exactly 16 bytes', () => {
    expect(buildMetadata(new Uint8Array(100), 1).length).toBe(METADATA_SIZE);
  });

  it('starts with PXB0 magic', () => {
    const meta = buildMetadata(new Uint8Array(1), 1);
    expect(meta[0]).toBe(0x50); // P
    expect(meta[1]).toBe(0x58); // X
    expect(meta[2]).toBe(0x42); // B
    expect(meta[3]).toBe(0x30); // 0 (version)
  });

  it('encodes file size correctly', () => {
    const file = new Uint8Array(123456);
    const meta = buildMetadata(file, 1);
    const view = new DataView(meta.buffer);
    expect(view.getBigUint64(4, true)).toBe(123456n);
  });

  it('encodes num_data_blocks correctly', () => {
    const meta = buildMetadata(new Uint8Array(1), 7);
    const view = new DataView(meta.buffer);
    expect(view.getUint16(12, true)).toBe(7);
  });

  it('encodes symbol_size = MTU', () => {
    const meta = buildMetadata(new Uint8Array(1), 1);
    const view = new DataView(meta.buffer);
    expect(view.getUint16(14, true)).toBe(MTU);
  });
});

describe('parseMetadata', () => {
  it('round-trip: buildMetadata → parseMetadata', () => {
    const file = new Uint8Array(999_888);
    const meta = buildMetadata(file, 3);
    const parsed = parseMetadata(meta);
    expect(parsed.totalFileSize).toBe(999_888n);
    expect(parsed.numDataBlocks).toBe(3);
    expect(parsed.symbolSize).toBe(MTU);
  });

  it('wrong first magic byte → throws', () => {
    const meta = buildMetadata(new Uint8Array(1), 1);
    meta[0] = 0x00;
    expect(() => parseMetadata(meta)).toThrow(/magic/i);
  });

  it('wrong symbol_size → throws', () => {
    const meta = buildMetadata(new Uint8Array(1), 1);
    const view = new DataView(meta.buffer);
    view.setUint16(14, 1234, true);
    expect(() => parseMetadata(meta)).toThrow(/symbol_size/i);
  });

  it('too-short input → throws', () => {
    expect(() => parseMetadata(new Uint8Array(8))).toThrow();
  });
});
