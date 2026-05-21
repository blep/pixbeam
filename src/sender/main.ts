import initRaptorQ, { Encoder } from 'raptorq';
import QRCode from 'qrcode';
import { Sender } from '../lib/sender.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const fileInput   = document.getElementById('file-input')   as HTMLInputElement;
const dropZone    = document.getElementById('drop-zone')!;
const dropLabel   = document.getElementById('drop-label')!;
const errorMsg    = document.getElementById('error-msg')!;
const pickUi      = document.getElementById('pick-ui')!;
const sendUi      = document.getElementById('send-ui')!;
const sendFilename = document.getElementById('send-filename')!;
const statFrame   = document.getElementById('stat-frame')!;
const statFps     = document.getElementById('stat-fps')!;
const statBlock   = document.getElementById('stat-block')!;
const stopBtn     = document.getElementById('stop-btn')!;
const fpsSlider   = document.getElementById('fps-slider')  as HTMLInputElement;
const fpsLabel    = document.getElementById('fps-label')!;
const qrArea      = document.getElementById('qr-area')!;
const qrCanvas    = document.getElementById('qr-canvas')  as HTMLCanvasElement;
const qrHint      = document.getElementById('qr-hint')!;

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

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file) startTransfer(file);
});

fpsSlider.addEventListener('input', () => {
  fpsLabel.textContent = fpsSlider.value;
});

stopBtn.addEventListener('click', () => {
  stopped = true;
  sendUi.hidden = true;
  pickUi.hidden = false;
  qrCanvas.style.display = 'none';
  qrHint.style.display = '';
  dropLabel.textContent = 'Drop a file here or click to choose';
  fileInput.value = '';
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
  pickUi.hidden = true;
  sendUi.hidden = false;
  sendFilename.textContent = file.name;

  // Size the canvas to the QR area square so we get pixel-perfect rendering
  const qrSize = qrArea.clientWidth;

  let totalFrames = 0;
  let fpsFrames = 0;
  let fpsStart = performance.now();

  for (const frame of sender) {
    if (stopped) break;

    await QRCode.toCanvas(
      qrCanvas,
      [{ data: frame.payload, mode: 'byte' }],
      {
        version: 40,
        errorCorrectionLevel: 'L',
        margin: 4, // spec minimum; narrower margins confuse strict decoders
        width: qrSize,
        color: { dark: '#000000', light: '#ffffff' },
      }
    );

    // Reveal canvas after first frame
    if (totalFrames === 0) {
      qrCanvas.style.display = 'block';
      qrHint.style.display = 'none';
    }

    totalFrames++;
    fpsFrames++;

    const prog = sender.progress();
    const dataBlocks = prog.filter(b => !b.isMetadata);
    statFrame.textContent = String(totalFrames);
    statBlock.textContent = dataBlocks.map(b => `${b.framesSent}`).join(' / ');

    const now = performance.now();
    if (now - fpsStart >= 1000) {
      statFps.textContent = `${(fpsFrames / ((now - fpsStart) / 1000)).toFixed(1)}`;
      fpsFrames = 0;
      fpsStart = now;
    }

    await sleep(1000 / Number(fpsSlider.value));
  }
}

function showError(msg: string): void {
  errorMsg.textContent = msg;
  errorMsg.hidden = !msg;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
