import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const puppeteer = require('/tmp/samsar-puppeteer/node_modules/puppeteer-core');

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'runtime', 'config', 'samsar.config.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'artifacts', 'setup-wizard-demo');
const FRAME_DIR = path.join(OUTPUT_DIR, 'frames');
const VIDEO_PATH = path.join(OUTPUT_DIR, 'setup-wizard-demo.mp4');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIZARD_URL = 'http://localhost:8089/';
const WIDTH = 1440;
const HEIGHT = 1000;
const FPS = 10;
const DURATION_MS = 40000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout?.on('data', (chunk) => {
      options.onStdout?.(chunk.toString());
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}${stderr ? `: ${stderr.slice(-1200)}` : ''}`));
    });
  });
}

async function readSamsarApiKey() {
  const envApiKey = process.env.SAMSAR_DEMO_API_KEY?.trim();
  if (envApiKey) {
    return envApiKey;
  }

  const rawConfig = await fs.readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(rawConfig);
  const apiKey = config?.providers?.samsar?.apiKey;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error(`Missing providers.samsar.apiKey in ${CONFIG_PATH}`);
  }
  return apiKey.trim();
}

async function waitForButtonText(page, textPattern, timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = await page.evaluate((patternSource) => {
      const pattern = new RegExp(patternSource, 'i');
      return [...document.querySelectorAll('button')]
        .some((button) => pattern.test(button.textContent || '') && !button.disabled);
    }, textPattern.source);
    if (found) {
      return true;
    }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for button ${textPattern}`);
}

async function clickButtonText(page, textPattern) {
  await waitForButtonText(page, textPattern);
  const clicked = await page.evaluate((patternSource) => {
    const pattern = new RegExp(patternSource, 'i');
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => pattern.test(candidate.textContent || '') && !candidate.disabled);
    if (!button) {
      return false;
    }
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return true;
  }, textPattern.source);
  if (!clicked) {
    throw new Error(`Could not click button ${textPattern}`);
  }
}

async function scrollTop(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  await sleep(180);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function humanScrollCurve(t) {
  const base = easeInOutCubic(t);
  const subtleDrift = Math.sin(t * Math.PI * 3) * 0.008 * (1 - Math.abs((t * 2) - 1));
  return Math.min(1, Math.max(0, base + subtleDrift));
}

async function humanScrollToBottom(page, durationMs, options = {}) {
  const start = await page.evaluate(() => window.scrollY || document.documentElement.scrollTop || 0);
  const end = await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    return Math.max(0, root.scrollHeight - window.innerHeight);
  });
  if (end <= start) {
    await sleep(durationMs);
    return;
  }

  const startedAt = Date.now();
  const stepMs = options.stepMs || 95;
  const pausePoints = options.pausePoints || [0.28, 0.64];
  const usedPauses = new Set();
  let didCorrection = false;

  while (Date.now() - startedAt < durationMs) {
    const elapsed = Date.now() - startedAt;
    const t = Math.min(1, elapsed / durationMs);
    const progress = humanScrollCurve(t);
    let nextY = Math.round(start + ((end - start) * progress));

    if (!didCorrection && t > 0.58 && t < 0.66 && end - start > 260) {
      nextY = Math.max(start, nextY - 22);
      didCorrection = true;
    }

    await page.evaluate((y) => window.scrollTo(0, y), nextY);

    const pauseIndex = pausePoints.findIndex((point) => (
      !usedPauses.has(point) && Math.abs(t - point) < 0.025
    ));
    if (pauseIndex !== -1) {
      const pausePoint = pausePoints[pauseIndex];
      usedPauses.add(pausePoint);
      await sleep(130 + (pauseIndex * 45));
    }

    await sleep(stepMs + (Math.sin(t * Math.PI * 5) * 10));
  }

  await page.evaluate((y) => window.scrollTo(0, y), end);
}

async function recordFrames(page) {
  await fs.rm(FRAME_DIR, { recursive: true, force: true });
  await fs.mkdir(FRAME_DIR, { recursive: true });

  const frameCount = Math.round((DURATION_MS / 1000) * FPS);
  const startedAt = Date.now();
  for (let frame = 0; frame < frameCount; frame += 1) {
    const framePath = path.join(FRAME_DIR, `frame_${String(frame + 1).padStart(4, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });
    const nextAt = startedAt + ((frame + 1) * 1000) / FPS;
    await sleep(Math.max(0, nextAt - Date.now()));
  }
}

async function waitUntil(startedAt, offsetMs) {
  await sleep(Math.max(0, startedAt + offsetMs - Date.now()));
}

async function encodeVideo() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.rm(VIDEO_PATH, { force: true });
  await run('ffmpeg', [
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    path.join(FRAME_DIR, 'frame_%04d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-r',
    '30',
    VIDEO_PATH,
  ]);
}

async function main() {
  if (!fsSync.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome executable not found at ${CHROME_PATH}`);
  }

  const apiKey = await readSamsarApiKey();
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      '--hide-scrollbars=false',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (/^https:\/\/api\.samsar\.one\//.test(url)) {
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            valid: true,
            status: 'valid',
            credits: 100000,
            generationCredits: 100000,
          }),
        });
        return;
      }
      request.continue();
    });

    await page.goto(WIZARD_URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#samsar-credential', { timeout: 15000 });
    await page.$eval('#samsar-credential', (input, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, apiKey);
    await scrollTop(page);

    const startedAt = Date.now();
    const recording = recordFrames(page);

    await waitUntil(startedAt, 250);
    await scrollTop(page);
    await humanScrollToBottom(page, 6100, { pausePoints: [0.22, 0.52, 0.78] });
    await waitUntil(startedAt, 6900);
    await clickButtonText(page, /^Continue$/);
    await page.waitForFunction(() => document.body.innerText.includes('Choose runtime'), { timeout: 6000 }).catch(() => {});

    await waitUntil(startedAt, 8000);
    await scrollTop(page);
    await humanScrollToBottom(page, 5700, { pausePoints: [0.34, 0.68] });
    await waitUntil(startedAt, 15000);
    await clickButtonText(page, /^Continue$/);
    await page.waitForFunction(() => document.body.innerText.includes('Local MongoDB'), { timeout: 4000 }).catch(() => {});

    await waitUntil(startedAt, 16000);
    await scrollTop(page);
    await humanScrollToBottom(page, 5700, { pausePoints: [0.28, 0.7] });
    await waitUntil(startedAt, 23000);
    await clickButtonText(page, /^Continue$/);
    await page.waitForFunction(() => document.body.innerText.includes('Submit and setup containers'), { timeout: 4000 }).catch(() => {});

    await waitUntil(startedAt, 24000);
    await scrollTop(page);
    await humanScrollToBottom(page, 1800, { pausePoints: [0.48], stepMs: 85 });
    await waitUntil(startedAt, 26300);
    await clickButtonText(page, /Submit and setup containers/);

    await recording;
    await encodeVideo();
    console.log(VIDEO_PATH);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
