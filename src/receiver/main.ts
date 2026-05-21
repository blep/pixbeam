import initRaptorQ, { Decoder } from 'raptorq';
import jsQR from 'jsqr';
import { Receiver } from '../lib/receiver.js';

// ── BarcodeDetector shim (not in TypeScript stdlib) ───────────────────────────
interface BarcodeResult {
  rawValue: string;
  boundingBox: DOMRectReadOnly;
  cornerPoints: ReadonlyArray<{ x: number; y: number }>;
}
interface NativeDetector {
  detect(src: HTMLVideoElement): Promise<BarcodeResult[]>;
}

const nativeDetector: NativeDetector | null = (() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BD = (window as any).BarcodeDetector as
    | { new(opts: { formats: string[] }): NativeDetector }
    | undefined;
  if (!BD) return null;
  try { return new BD({ formats: ['qr_code'] }); } catch { return null; }
})();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const startScreen   = document.getElementById('start-screen')!;
const scanScreen    = document.getElementById('scan-screen')!;
const doneScreen    = document.getElementById('done-screen')!;
const startBtn      = document.getElementById('start-btn')!;
const errorMsg      = document.getElementById('error-msg')!;
const preview       = document.getElementById('preview')        as HTMLVideoElement;
const scanCanvas    = document.getElementById('scan-canvas')    as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
const statusText    = document.getElementById('status-text')!;
const progressBars  = document.getElementById('progress-bars')!;
const cancelBtn     = document.getElementById('cancel-btn')!;
const cntDetected   = document.getElementById('cnt-detected')!;
const cntValid      = document.getElementById('cnt-valid')!;
const doneInfo      = document.getElementById('done-info')!;
const downloadLink  = document.getElementById('download-link') as HTMLAnchorElement;
const restartBtn    = document.getElementById('restart-btn')!;

// ── State ─────────────────────────────────────────────────────────────────────
let scanning      = false;
let raptorQReady  = false;
let block0Timeout: ReturnType<typeof setTimeout> | null = null;
let totalDetected = 0;
let totalValid    = 0;

// ── Init ──────────────────────────────────────────────────────────────────────
initRaptorQ().then(() => { raptorQReady = true; }).catch(console.error);

// Show which detection path will be used so the user can see it
document.addEventListener('DOMContentLoaded', () => {
  const badge = document.getElementById('detector-badge');
  if (badge) badge.textContent = nativeDetector ? 'Native' : 'jsQR';
});

// ── Event handlers ────────────────────────────────────────────────────────────
startBtn.addEventListener('click', startReceiving);
cancelBtn.addEventListener('click', stopScanning);
restartBtn.addEventListener('click', () => {
  doneScreen.hidden = true;
  startScreen.hidden = false;
});

async function startReceiving(): Promise<void> {
  showError('');
  if (!raptorQReady) {
    showError('RaptorQ still initialising — please wait a moment.');
    return;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    });
  } catch {
    showError('Camera access denied — please allow camera and reload.');
    return;
  }

  // Register the loadedmetadata listener BEFORE setting srcObject to avoid
  // the race where the event fires before the listener is attached.
  const metaReady = new Promise<void>(r => {
    if (preview.readyState >= HTMLMediaElement.HAVE_METADATA) { r(); return; }
    preview.addEventListener('loadedmetadata', () => r(), { once: true });
  });

  preview.srcObject = stream;

  // play() can throw on iOS when the user-gesture chain is broken by the
  // async getUserMedia call. A muted video with playsinline should always
  // be allowed, but catch and surface errors rather than hanging silently.
  try {
    await preview.play();
  } catch (err) {
    showError(`Could not start video playback: ${err instanceof Error ? err.message : err}`);
    stream.getTracks().forEach(t => t.stop());
    return;
  }

  await metaReady;

  // scanCanvas only used by the jsQR path; size it at startup
  scanCanvas.width  = preview.videoWidth;
  scanCanvas.height = preview.videoHeight;

  startScreen.hidden = true;
  scanScreen.hidden  = false;
  scanning      = true;
  totalDetected = 0;
  totalValid    = 0;
  statusText.textContent = "Waiting for the sender's metadata block…";

  const rx = new Receiver(Decoder);
  rx.onComplete(handleComplete);

  block0Timeout = setTimeout(() => {
    if (rx.getMetadata() === null && scanning) {
      if (totalDetected === 0) {
        statusText.textContent = 'No QR codes detected — point the camera at the sender screen.';
      } else if (totalValid === 0) {
        statusText.textContent = `Seeing QR codes (${totalDetected}) but none are pixbeam — make sure the sender is running.`;
      } else {
        statusText.textContent = `Receiving symbols (${totalValid}) but header not decoded yet — keep scanning.`;
      }
    }
  }, 10_000);

  if (nativeDetector) {
    runNativeScan(rx);
  } else {
    runJsQRScan(rx);
  }
}

// ── Native scan (BarcodeDetector, async, non-blocking) ────────────────────────
// Calls detect() on each animation frame; the browser handles the rest.
function runNativeScan(rx: Receiver): void {
  const tick = async (): Promise<void> => {
    if (!scanning || rx.isComplete()) return;

    try {
      const codes = await nativeDetector!.detect(preview);
      if (codes.length > 0) {
        const code = codes[0]!;
        // BarcodeDetector returns rawValue as a string; QR binary mode encodes
        // bytes as Latin-1 code points, so charCodeAt recovers the original bytes.
        const payload = new Uint8Array(code.rawValue.length);
        for (let i = 0; i < code.rawValue.length; i++)
          payload[i] = code.rawValue.charCodeAt(i) & 0xff;

        onPayload(payload, rx);
        // cornerPoints are in CSS px relative to the video element = overlay coords
        drawOverlayPoints(code.cornerPoints, payload.length === 2953);
      } else {
        clearOverlay();
      }
    } catch { /* video not ready yet, ignore */ }

    // Schedule via rAF so the browser stays responsive
    requestAnimationFrame(() => void tick());
  };
  void tick();
}

// ── jsQR scan (throttled, full resolution) ────────────────────────────────────
// Version 40 QR has 177 modules — downscaling would drop below ~3 px/module
// and make perspective correction unreliable. Scan at full camera resolution.
// Throttle to ~10 scans/s so jsQR doesn't saturate the event loop.
const JSQR_INTERVAL_MS = 100;

function runJsQRScan(rx: Receiver): void {
  const ctx = scanCanvas.getContext('2d', { willReadFrequently: true })!;
  let lastScan = 0;

  const tick = (ts: number): void => {
    if (!scanning || rx.isComplete()) return;

    if (ts - lastScan >= JSQR_INTERVAL_MS) {
      lastScan = ts;
      ctx.drawImage(preview, 0, 0, scanCanvas.width, scanCanvas.height);
      const imageData = ctx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
      const qr = jsQR(imageData.data, imageData.width, imageData.height,
        { inversionAttempts: 'attemptBoth' });

      if (qr) {
        onPayload(new Uint8Array(qr.binaryData), rx);
        drawOverlayFromJsQR(qr);
      } else {
        clearOverlay();
      }
    }

    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── Shared payload handler ────────────────────────────────────────────────────
function onPayload(payload: Uint8Array, rx: Receiver): void {
  totalDetected++;
  cntDetected.textContent = String(totalDetected);

  const wasValid = payload.length === 2953;
  rx.receive(payload);

  if (wasValid) {
    totalValid++;
    cntValid.textContent = String(totalValid);
    if (totalValid === 1) cntValid.classList.add('active');
  }

  updateProgress(rx);
}

// ── Overlay drawing ───────────────────────────────────────────────────────────
function clearOverlay(): void {
  const ctx = overlayCanvas.getContext('2d')!;
  syncOverlaySize();
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function syncOverlaySize(): void {
  const dw = overlayCanvas.clientWidth;
  const dh = overlayCanvas.clientHeight;
  if (overlayCanvas.width !== dw)  overlayCanvas.width  = dw;
  if (overlayCanvas.height !== dh) overlayCanvas.height = dh;
}

// BarcodeDetector: cornerPoints are already in display coordinates
function drawOverlayPoints(
  pts: ReadonlyArray<{ x: number; y: number }>,
  isPixbeam: boolean,
): void {
  syncOverlaySize();
  const ctx = overlayCanvas.getContext('2d')!;
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (pts.length < 4) return;
  strokeBox(ctx, pts as Array<{ x: number; y: number }>, isPixbeam ? '#7c6af7' : '#f7a620');
}

// jsQR: corners are in scanCanvas (downscaled camera) coordinates; transform
// to display coordinates via the object-fit:cover mapping.
function drawOverlayFromJsQR(qr: ReturnType<typeof jsQR>): void {
  if (!qr) { clearOverlay(); return; }
  syncOverlaySize();
  const ctx = overlayCanvas.getContext('2d')!;
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const dw = overlayCanvas.width;
  const dh = overlayCanvas.height;
  const cw = scanCanvas.width;
  const ch = scanCanvas.height;
  const scale = Math.max(dw / cw, dh / ch);
  const ox = (dw - cw * scale) / 2;
  const oy = (dh - ch * scale) / 2;
  const tx = (p: { x: number; y: number }) =>
    ({ x: p.x * scale + ox, y: p.y * scale + oy });

  const { topLeftCorner: tl, topRightCorner: tr,
          bottomRightCorner: br, bottomLeftCorner: bl } = qr.location;
  const isPixbeam = qr.binaryData.length === 2953;
  strokeBox(ctx, [tl, tr, br, bl].map(tx), isPixbeam ? '#7c6af7' : '#f7a620');
}

function strokeBox(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.stroke();
  // Corner dots
  ctx.fillStyle = color;
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Teardown ──────────────────────────────────────────────────────────────────
function stopScanning(): void {
  scanning = false;
  if (block0Timeout) { clearTimeout(block0Timeout); block0Timeout = null; }
  (preview.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());
  preview.srcObject = null;
  scanScreen.hidden = true;
  startScreen.hidden = false;
}

function handleComplete(file: Uint8Array): void {
  scanning = false;
  if (block0Timeout) { clearTimeout(block0Timeout); block0Timeout = null; }
  (preview.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());
  preview.srcObject = null;

  scanScreen.hidden = true;
  doneScreen.hidden = false;

  const sizeMB = (file.length / 1e6).toFixed(2);
  doneInfo.textContent = `${sizeMB} MB received`;

  const blob = new Blob([file.buffer as ArrayBuffer]);
  downloadLink.href = URL.createObjectURL(blob);
  downloadLink.download = `pixbeam-${Date.now()}.bin`;
  downloadLink.textContent = `Download (${sizeMB} MB)`;
}

// ── Progress ──────────────────────────────────────────────────────────────────
function updateProgress(rx: Receiver): void {
  const meta = rx.getMetadata();
  const prog = rx.progress();

  if (meta === null) {
    const block0Seen = prog[0]?.seenSymbols ?? 0;
    statusText.textContent = block0Seen === 0
      ? "Waiting for the sender's metadata block…"
      : `Decoding metadata block… (${block0Seen} symbol${block0Seen === 1 ? '' : 's'} so far, need ~4)`;
    return;
  }

  const sizeMB = (Number(meta.totalFileSize) / 1e6).toFixed(1);
  statusText.textContent =
    `Receiving ${sizeMB} MB across ${meta.numDataBlocks} block${meta.numDataBlocks === 1 ? '' : 's'}…`;

  const dataBlocks = prog.slice(1);
  if (progressBars.children.length !== dataBlocks.length) {
    progressBars.innerHTML = '';
    for (const b of dataBlocks) {
      const row = document.createElement('div');
      row.className = 'progress-row';
      row.dataset['block'] = String(b.blockNum);
      row.innerHTML = `<span>blk${b.blockNum}</span>
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:0%"></div></div>
        <span class="pct">0%</span>`;
      progressBars.appendChild(row);
    }
  }

  for (const b of dataBlocks) {
    const row = progressBars.querySelector<HTMLElement>(`[data-block="${b.blockNum}"]`);
    if (!row) continue;
    const pct = b.totalSymbols > 0 ? Math.min(100, (b.seenSymbols / b.totalSymbols) * 100) : 0;
    row.querySelector<HTMLElement>('.progress-bar-fill')!.style.width = `${pct.toFixed(0)}%`;
    row.querySelector<HTMLElement>('.pct')!.textContent = b.decoded ? '✓' : `${pct.toFixed(0)}%`;
  }
}

function showError(msg: string): void {
  errorMsg.textContent = msg;
  errorMsg.hidden = !msg;
}
