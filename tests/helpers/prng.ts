/**
 * Mulberry32 — fast, seedable 32-bit PRNG returning values in [0, 1).
 * All randomness in the test suite flows through an instance of this;
 * no test ever calls Math.random() directly.
 */
export function makePRNG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Resolve the test seed: use SEED env var if set, otherwise pick a random one.
 * The seed is printed so any failure can be reproduced with SEED=<n> pnpm test.
 */
export function resolveTestSeed(): number {
  const env = process.env['SEED'];
  const seed = env !== undefined ? parseInt(env, 10) : (Math.random() * 0xffffffff) >>> 0;
  console.log(`[pixbeam-test] seed=${seed}  (re-run with SEED=${seed} to reproduce)`);
  return seed;
}
