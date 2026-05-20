import { describe, it, expect } from 'vitest';
import { numDataBlocks, splitFile, dataBlockLength } from '../../src/lib/blocks.js';
import { MAX_BYTES_PER_BLOCK, MAX_DATA_BLOCKS } from '../../src/lib/constants.js';

describe('numDataBlocks', () => {
  it('1-byte file → 1 block', () => expect(numDataBlocks(1)).toBe(1));
  it('empty file → 1 block', () => expect(numDataBlocks(0)).toBe(1));

  it('exactly max_bytes_per_block → 1 block', () => {
    expect(numDataBlocks(MAX_BYTES_PER_BLOCK)).toBe(1);
  });

  it('max_bytes_per_block + 1 → 2 blocks', () => {
    expect(numDataBlocks(MAX_BYTES_PER_BLOCK + 1)).toBe(2);
  });

  it('254 × max_bytes_per_block → 254 blocks (at limit)', () => {
    expect(numDataBlocks(MAX_DATA_BLOCKS * MAX_BYTES_PER_BLOCK)).toBe(MAX_DATA_BLOCKS);
  });

  it('254 × max_bytes_per_block + 1 → throws', () => {
    expect(() => numDataBlocks(MAX_DATA_BLOCKS * MAX_BYTES_PER_BLOCK + 1)).toThrow();
  });
});

describe('splitFile', () => {
  it('lengths sum to file size', () => {
    for (const size of [1, 100, 50_000, MAX_BYTES_PER_BLOCK, MAX_BYTES_PER_BLOCK + 1]) {
      const file   = new Uint8Array(size);
      const chunks = splitFile(file);
      const total  = chunks.reduce((s, c) => s + c.length, 0);
      expect(total).toBe(size);
    }
  });

  it('non-last chunks are exactly MAX_BYTES_PER_BLOCK for a 2-block file', () => {
    const file   = new Uint8Array(MAX_BYTES_PER_BLOCK + 1);
    const chunks = splitFile(file);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.length).toBe(MAX_BYTES_PER_BLOCK);
    expect(chunks[1]!.length).toBe(1);
  });

  it('chunk content matches original bytes', () => {
    const file = new Uint8Array([1, 2, 3, 4, 5]);
    const [chunk] = splitFile(file);
    expect(Array.from(chunk!)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('dataBlockLength', () => {
  it('sum of all block lengths equals totalFileSize', () => {
    const sizes = [1n, 100n, BigInt(MAX_BYTES_PER_BLOCK), BigInt(MAX_BYTES_PER_BLOCK) + 1n];
    for (const total of sizes) {
      const n = numDataBlocks(Number(total));
      let sum = 0n;
      for (let i = 1; i <= n; i++) sum += dataBlockLength(i, n, total);
      expect(sum).toBe(total);
    }
  });

  it('last block length is correct remainder', () => {
    const total = BigInt(MAX_BYTES_PER_BLOCK) + 7n;
    expect(dataBlockLength(2, 2, total)).toBe(7n);
  });
});
