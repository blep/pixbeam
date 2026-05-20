import initRaptorQ, { Encoder } from 'raptorq';
import QRCode from 'qrcode';
import { Sender } from '../lib/sender.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const pickScreen  = document.getElementById('pick-screen')!;
const sendScreen  = document.getElementById('send-screen')!;
const fileInput   = document.getElementById('file-input') as HTMLInputElement;
const dropZone    = document.getElementById('drop-zone')!;
const dropLabel   = document.getElementById('drop-label')!;
const errorMsg    = document.getElementById('error-msg')!;
const qrCanvas    = document.getElementById('qr-canvas') as HTMLCanvasElement;
const hudBlock    = document.getElementById('hud-block')!;
const hudFrame    = document.getElementById('hud-frame')!;
const hudFps      = document.getElementById('hud-fps')!;
const stopBtn     = document.getElementById('stop-btn')!;

// ── State ─────────────────────────────────────────────────────────────────────
let stopped = false;
let raptorQReady = false;

// ── Init ──────────────────────────────────────────────────────────────────────
initRaptorQ().then(() => { raptorQReady = true; }).catch(console.error);

// ── File picking ──────────────────────────────────────────────────────────────
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) startTransfer(file);
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file) startTransfer(file);
});

stopBtn.addEventListener('click', () => {
  stopped = true;
  pickScreen.hidden = false;
  sendScreen.hidden = true;
  fileInput.value = '';
  dropLabel.textContent = 'Drop a file here or click to choose';
});

// ── Transfer ──────────────────────────────────────────────────────────────────
async function startTransfer(file: File): Promise<void> {
  showError('');

  if (!raptorQReady) {
    showError('RaptorQ still initialising — please wait a moment and try again.');
    return;
  }

  let fileBytes: Uint8Array;
  try {
    fileBytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    showError('Failed to read file.');
    return;
  }

  let sender: Sender;
  try {
    sender = new Sender(fileBytes, Encoder);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return;
  }

  stopped = false;
  pickScreen.hidden = true;
  sendScreen.hidden = false;
  dropLabel.textContent = file.name;

  let totalFrames = 0;
  let fpsFrames = 0;
  let fpsStart = performance.now();

  for (const frame of sender) {
    if (stopped) break;

    // Render QR code directly to canvas (faster than toDataURL)
    await QRCode.toCanvas(
      qrCanvas,
      [{ data: frame.payload, mode: 'byte' }],
      { version: 40, errorCorrectionLevel: 'L', margin: 2, scale: 4, color: { dark: '#000', light: '#fff' } }
    );

    totalFrames++;
    fpsFrames++;

    // Update HUD
    const prog = sender.progress();
    const dataBlocks = prog.slice(1); // skip metadata block 0
    hudBlock.textContent = dataBlocks.map(b =>
      `blk${b.blockNum}: ${b.framesSent}`
    ).join(' | ');
    hudFrame.textContent = `frame ${totalFrames}`;

    const now = performance.now();
    if (now - fpsStart >= 1000) {
      hudFps.textContent = `${(fpsFrames / ((now - fpsStart) / 1000)).toFixed(1)} fps`;
      fpsFrames = 0;
      fpsStart = now;
    }

    // Yield to browser between frames (~80 ms target = ~12 fps)
    await sleep(80);
  }
}

function showError(msg: string): void {
  errorMsg.textContent = msg;
  errorMsg.hidden = !msg;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
