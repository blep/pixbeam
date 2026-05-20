import initRaptorQ, { Decoder } from 'raptorq';
import jsQR from 'jsqr';
import { Receiver } from '../lib/receiver.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const startScreen  = document.getElementById('start-screen')!;
const scanScreen   = document.getElementById('scan-screen')!;
const doneScreen   = document.getElementById('done-screen')!;
const startBtn     = document.getElementById('start-btn')!;
const errorMsg     = document.getElementById('error-msg')!;
const preview      = document.getElementById('preview') as HTMLVideoElement;
const scanCanvas   = document.getElementById('scan-canvas') as HTMLCanvasElement;
const statusText   = document.getElementById('status-text')!;
const progressBars = document.getElementById('progress-bars')!;
const cancelBtn    = document.getElementById('cancel-btn')!;
const doneInfo     = document.getElementById('done-info')!;
const downloadLink = document.getElementById('download-link') as HTMLAnchorElement;
const restartBtn   = document.getElementById('restart-btn')!;

// ── State ─────────────────────────────────────────────────────────────────────
let scanning = false;
let raptorQReady = false;
let block0Timeout: ReturnType<typeof setTimeout> | null = null;

// ── Init ──────────────────────────────────────────────────────────────────────
initRaptorQ().then(() => { raptorQReady = true; }).catch(console.error);

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
    // Prefer rear camera on phones; fall back to any camera
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    });
  } catch {
    showError('Camera access denied — please allow camera and reload.');
    return;
  }

  preview.srcObject = stream;
  await preview.play();
  // Wait for video dimensions to be known
  await new Promise<void>(r => { preview.addEventListener('loadedmetadata', () => r(), { once: true }); });

  scanCanvas.width  = preview.videoWidth;
  scanCanvas.height = preview.videoHeight;

  startScreen.hidden = true;
  scanScreen.hidden  = false;
  scanning = true;

  const receiver = new Receiver(Decoder);
  receiver.onComplete(handleComplete);

  // Block-0 timeout: notify user if header not received within 10 s
  block0Timeout = setTimeout(() => {
    if (receiver.getMetadata() === null && scanning) {
      statusText.textContent = 'No signal — check camera aim and sender screen.';
    }
  }, 10_000);

  requestAnimationFrame(function scan() {
    if (!scanning) return;

    const ctx = scanCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(preview, 0, 0, scanCanvas.width, scanCanvas.height);
    const imageData = ctx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);

    const qr = jsQR(imageData.data, imageData.width, imageData.height);
    if (qr?.binaryData) {
      receiver.receive(new Uint8Array(qr.binaryData));
      updateProgress(receiver);
    }

    if (!receiver.isComplete()) requestAnimationFrame(scan);
  });
}

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
  downloadLink.click(); // auto-download
}

function updateProgress(rx: Receiver): void {
  const meta = rx.getMetadata();
  const prog = rx.progress();

  if (meta === null) {
    const block0 = prog[0];
    statusText.textContent = `Waiting for header… (${block0?.seenSymbols ?? 0} symbol${(block0?.seenSymbols ?? 0) === 1 ? '' : 's'} received)`;
    return;
  }

  statusText.textContent = `Receiving… ${(Number(meta.totalFileSize) / 1e6).toFixed(1)} MB · ${meta.numDataBlocks} block${meta.numDataBlocks === 1 ? '' : 's'}`;

  // Rebuild progress bar rows (only data blocks)
  const dataBlocks = prog.slice(1);
  if (progressBars.children.length !== dataBlocks.length) {
    progressBars.innerHTML = '';
    for (const b of dataBlocks) {
      const row = document.createElement('div');
      row.className = 'progress-row';
      row.dataset['block'] = String(b.blockNum);
      row.innerHTML = `<span>blk${b.blockNum}</span><div class="progress-bar-track"><div class="progress-bar-fill" style="width:0%"></div></div><span class="pct">0%</span>`;
      progressBars.appendChild(row);
    }
  }

  for (const b of dataBlocks) {
    const row = progressBars.querySelector<HTMLElement>(`[data-block="${b.blockNum}"]`);
    if (!row) continue;
    const pct = b.totalSymbols > 0 ? Math.min(100, (b.seenSymbols / b.totalSymbols) * 100) : 0;
    const fill = row.querySelector<HTMLElement>('.progress-bar-fill')!;
    const label = row.querySelector<HTMLElement>('.pct')!;
    fill.style.width = `${pct.toFixed(0)}%`;
    label.textContent = b.decoded ? '✓' : `${pct.toFixed(0)}%`;
  }
}

function showError(msg: string): void {
  errorMsg.textContent = msg;
  errorMsg.hidden = !msg;
}
