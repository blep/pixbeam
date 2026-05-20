/** Generate a deterministic byte array of the given size using the provided PRNG. */
export function makeTestFile(sizeBytes: number, rng: () => number): Uint8Array {
  const buf = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) buf[i] = (rng() * 256) >>> 0;
  return buf;
}
