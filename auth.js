require('dotenv').config();
const { chromium } = require('playwright');
const nacl = require('tweetnacl');
const bs58mod = require('bs58');
const bs58 = bs58mod.default || bs58mod;
const log = require('./logger');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '.session.json');
let _cookies = '';

const PRIV_KEY_B58 = process.env.PHANTOM_PRIVATE_KEY || '';
let KEYPAIR;
if (PRIV_KEY_B58) {
  const secretBytes = bs58.decode(PRIV_KEY_B58);
  if (secretBytes.length === 64) {
    KEYPAIR = nacl.sign.keyPair.fromSecretKey(secretBytes);
  } else if (secretBytes.length === 32) {
    KEYPAIR = nacl.sign.keyPair.fromSeed(secretBytes);
  }
}

async function getSession(force = false) {
  if (!force && fs.existsSync(SESSION_FILE)) {
    try {
      const cache = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (cache.cookies && (Date.now() - cache.ts < 2 * 60 * 60 * 1000)) {
        _cookies = cache.cookies;
        log.info('AUTH', `✅ Session dari cache`);
        return _cookies;
      }
    } catch (e) {}
  }

  if (!KEYPAIR) throw new Error('PHANTOM_PRIVATE_KEY tidak ditemukan di .env');

  log.info('AUTH', 'Membuka browser + inject Ed25519 wallet...');
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const _context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await _context.newPage();

  try {
    const pubKeyB58 = bs58.encode(KEYPAIR.publicKey);
    const pubB64 = Buffer.from(KEYPAIR.publicKey).toString('base64');

    await page.exposeFunction('__hermesSign', (msgB64) => {
      try {
        const msgBytes = Buffer.from(msgB64, 'base64');
        const sig = nacl.sign.detached(msgBytes, KEYPAIR.secretKey);
        return Buffer.from(sig).toString('base64');
      } catch (e) { return null; }
    });

    await page.addInitScript((args) => {
      const { PUBKEY, PUB_B64 } = args;
      function b64toArr(b64) { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return arr; }
      function arrToB64(arr) { let s = ''; for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]); return btoa(s); }
      const pubKeyBytes = b64toArr(PUB_B64);
      const fakeSolana = {
        isPhantom: true, isConnected: true,
        publicKey: { toString: () => PUBKEY, toBase58: () => PUBKEY, toBytes: () => pubKeyBytes },
        connect: async () => ({ publicKey: { toString: () => PUBKEY, toBase58: () => PUBKEY } }),
        signMessage: async (msg) => {
          let msgBytes = (msg instanceof Uint8Array) ? msg : new TextEncoder().encode(msg);
          const sigB64 = await window.__hermesSign(arrToB64(msgBytes));
          return { signature: Array.from(b64toArr(sigB64)) };
        },
        signTransaction: async (tx) => tx,
        on: () => {}, off: () => {}, request: async (req) => (req?.method === 'connect' ? { publicKey: PUBKEY } : null)
      };
      Object.defineProperty(window, 'solana', { value: fakeSolana, writable: false });
      Object.defineProperty(window, 'phantom', { value: { solana: fakeSolana }, writable: false });
    }, { PUBKEY: pubKeyB58, PUB_B64: pubB64 });

    // Step 1: Login via Homepage
    log.info('AUTH', 'Login via homepage...');
    await page.goto('https://kintara.gg', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes('connect'));
      if (btn) btn.click();
    });

    // Wait for session cookie
    let sessionCookie = null;
    for (let i = 0; i < 20; i++) {
      const cookies = await _context.cookies('https://kintara.gg');
      sessionCookie = cookies.find(c => c.name.includes('session'));
      if (sessionCookie) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!sessionCookie) throw new Error('Login failed');
    _cookies = `${sessionCookie.name}=${sessionCookie.value}`;

    // Step 2: Enter World via /play
    log.info('AUTH', 'Navigasi ke /play...');
    await page.goto('https://kintara.gg/play', { waitUntil: 'networkidle' });
    await new Promise(r => setTimeout(r, 3000));

    // Canvas click to trigger overlay if not present
    const hasPlay = await page.evaluate(() => !![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'PLAY'));
    if (!hasPlay) {
        log.info('AUTH', 'Clicking canvas to trigger UI...');
        await page.mouse.click(640, 360);
        await new Promise(r => setTimeout(r, 2000));
    }

    // Click PLAY
    log.info('AUTH', 'Clicking PLAY button...');
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'PLAY');
        if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 3000));

    // Step 3: Select Server
    log.info('AUTH', 'Selecting Server 1...');
    const serverSelected = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const s1 = btns.find(b => b.textContent.includes('SERVER 1'));
        if (s1) { s1.click(); return true; }
        // Fallback: any button with 'SERVER'
        const anyS = btns.find(b => b.textContent.includes('SERVER'));
        if (anyS) { anyS.click(); return true; }
        return false;
    });

    if (serverSelected) {
        log.success('AUTH', 'Server Selected!');
        await new Promise(r => setTimeout(r, 5000)); // Wait for game load
    } else {
        log.warn('AUTH', 'Server selection button not found');
    }

    // Refresh cookies in case they changed
    const finalCookies = await _context.cookies('https://kintara.gg');
    const finalSess = finalCookies.find(c => c.name.includes('session'));
    if (finalSess) {
        _cookies = `${finalSess.name}=${finalSess.value}`;
        fs.writeFileSync(SESSION_FILE, JSON.stringify({ cookies: _cookies, ts: Date.now() }));
    }

    await browser.close();
    return _cookies;
  } catch (e) {
    await browser.close();
    throw e;
  }
}

async function apiFetch(endpoint, options = {}) {
  if (!_cookies) await getSession();
  const res = await fetch(`https://kintara.gg${endpoint}`, {
    ...options,
    headers: { 'Cookie': _cookies, 'Content-Type': 'application/json', ...options.headers }
  });
  return res.json();
}

function clearSession() {
  _cookies = null;
  try { fs.unlinkSync(SESSION_FILE); } catch(e) {}
  log.info('AUTH', 'Session cache cleared');
}

module.exports = { getSession, apiFetch, clearSession, get cookies() { return _cookies; } };
