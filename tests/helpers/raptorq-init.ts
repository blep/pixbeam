/**
 * Initialize the raptorq WASM module for Node.js test environments.
 * The default initRaptorQ() uses fetch(), which isn't available in Node.js.
 * Instead, read the WASM file synchronously and call initSync().
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initSync, Encoder, Decoder } from 'raptorq';

let initialised = false;

export function initRaptorQSync(): void {
  if (initialised) return;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const wasmPath  = resolve(__dirname, '../../node_modules/raptorq/raptorq_bg.wasm');
  initSync(readFileSync(wasmPath));
  initialised = true;
}

export { Encoder, Decoder };
