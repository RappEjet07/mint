// Capture what's on screen after /play
require('dotenv').config();
const { chromium } = require('playwright');
const nacl = require('tweetnacl');
const bs58mod = require('bs58');
const bs58 = bs58mod.default || bs58mod;

const PRIV_KEY_B58 = process.env.PHANTOM_PRIVATE_KEY || '';
const secretBytes = bs58.decode(PRIV_KEY_B58);
const KEYPAIR = secretBytes.length === 64 ? nacl.sign.keyPair.fromSecretKey(secretBytes) : nacl.sign.keyPair.fromSeed(secretBytes);
const pubKeyB58 = bs58.encode(KEYPAIR.publicKey);
const pubB64 = Buffer.from(KEYPAIR.publicKey).toString('base64');

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Inject Phantom
  await page.exposeFunction('__hermesSign', (msgB64) => {
    const msg = Buffer.from(msgB64, 'base64');
    return Buffer.from(nacl.sign.detached(msg, KEYPAIR.secretKey)).toString('base64');
  });
  await page.addInitScript(({ PUB, PUB_B64 }) => {
    function b64toArr(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
    function arrToB64(a) { let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
    const pk = b64toArr(PUB_B64);
    const solana = {
      isPhantom: true, isConnected: true,
      publicKey: { toString: () => PUB, toBase58: () => PUB, toBytes: () => pk },
      connect: async () => ({ publicKey: { toString: () => PUB, toBase58: () => PUB } }),
      signMessage: async (msg) => {
        const bytes = msg instanceof Uint8Array ? msg : new TextEncoder().encode(msg);
        return { signature: Array.from(b64toArr(await window.__hermesSign(arrToB64(bytes)))) };
      },
      signTransaction: async (tx) => tx,
      on: () => {}, off: () => {},
      request: async (r) => r?.method === 'connect' ? { publicKey: PUB } : null
    };
    Object.defineProperty(window, 'solana', { value: solana, writable: false });
    Object.defineProperty(window, 'phantom', { value: { solana }, writable: false });
  }, { PUB: pubKeyB58, PUB_B64: pubB64 });

  await page.goto('https://kintara.gg', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes('connect'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 5000));
  
  await page.goto('https://kintara.gg/play', { waitUntil: 'networkidle' });
  await new Promise(r => setTimeout(r, 5000));
  
  // Try to trigger the PLAY overlay
  await page.mouse.click(640, 400);
  await new Promise(r => setTimeout(r, 2000));
  
  // Click PLAY button
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'PLAY');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 5000));
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/kintara-debug.png' });
  console.log('Screenshot saved to /tmp/kintara-debug.png');
  
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
