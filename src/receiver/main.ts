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
const cntDetected  = document.getElementById('cnt-detected')!;
const cntValid     = document.getElementById('cnt-valid')!;
const doneInfo     = document.getElementById('done-info')!;
const downloadLink = document.getElementById('download-link') as HTMLAnchorElement;
const restartBtn   = document.getElementById('restart-btn')!;

// ── State ─────────────────────────────────────────────────────────────────────
let scanning = false;
let raptorQReady = false;
let block0Timeout: ReturnType<typeof setTimeout> | null = null;
let totalDetected = 0; // any QR code seen by jsQR
let totalValid    = 0; // valid pixbeam packets

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
  scanning      = true;
  totalDetected = 0;
  totalValid    = 0;
  statusText.textContent = "Waiting for the sender's metadata block…";

  const receiver = new Receiver(Decoder);
  receiver.onComplete(handleComplete);

  // Block-0 timeout: if nothing valid arrives in 10 s, give actionable advice
  block0Timeout = setTimeout(() => {
    if (receiver.getMetadata() === null && scanning) {
      if (totalDetected === 0) {
        statusText.textContent = 'No QR codes detected — point the camera at the sender screen.';
      } else if (totalValid === 0) {
        statusText.textContent = `Seeing QR codes (${totalDetected}) but none are pixbeam — make sure the sender is running.`;
      } else {
        statusText.textContent = `Receiving symbols (${totalValid}) but header not decoded yet — keep scanning.`;
      }
    }
  }, 10_000);

  requestAnimationFrame(function scan() {
    if (!scanning) return;

    const ctx = scanCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(preview, 0, 0, scanCanvas.width, scanCanvas.height);
    const imageData = ctx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);

    const qr = jsQR(imageData.data, imageData.width, imageData.height);
    if (qr) {
      totalDetected++;
      cntDetected.textContent = String(totalDetected);

      const payload = new Uint8Array(qr.binaryData);
      // receiver.receive() internally validates the CRC — count it as valid
      // only when the payload is long enough to be a pixbeam frame
      const wasValid = payload.length === 2953;
      receiver.receive(payload);
      if (wasValid) {
        totalValid++;
        cntValid.textContent = String(totalValid);
        if (totalValid === 1) cntValid.classList.add('active');
      }

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
    const block0Seen = prog[0]?.seenSymbols ?? 0;
    statusText.textContent = block0Seen === 0
      ? "Waiting for the sender's metadata block…"
      : `Decoding metadata block… (${block0Seen} symbol${block0Seen === 1 ? '' : 's'} so far, need ~4)`;
    return;
  }

  const sizeMB = (Number(meta.totalFileSize) / 1e6).toFixed(1);
  statusText.textContent = `Receiving ${sizeMB} MB across ${meta.numDataBlocks} block${meta.numDataBlocks === 1 ? '' : 's'}…`;

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
