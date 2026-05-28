// Debug: track what kintara.gg/play does during login
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { chromium } = require('playwright');
const tweetnacl = require('tweetnacl');
const bs58mod = require('bs58');
const bs58 = bs58mod.default || bs58mod;

const privKey = process.env.PHANTOM_PRIVATE_KEY.replace(/"/g, '');
const keyBytes = bs58.decode(privKey);
const pubKey = keyBytes.slice(32);
const publicKeyB58 = bs58.encode(pubKey);

const pkArr = JSON.stringify(Array.from(pubKey));

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/home/btc/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
    args: ['--no-sandbox']
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Intercept network
  const requests = [];
  page.on('request', req => {
    if (req.url().includes('kintara') || req.url().includes('api')) {
      requests.push(`${req.method()} ${req.url()}`);
    }
  });
  page.on('response', async res => {
    if (res.url().includes('kintara') && res.url().includes('api')) {
      const body = await res.text().catch(() => '...');
      console.log(`RESP ${res.status()} ${res.url()} → ${body.slice(0,200)}`);
    }
  });

  // Expose real node signing
  await page.exposeFunction('_nodeSign', async (messageArr) => {
    const msg = new Uint8Array(messageArr);
    const sig = tweetnacl.sign.detached(msg, keyBytes);
    return Array.from(sig);
  });

  // Inject fake solana provider
  await page.addInitScript(`
    (function() {
      const pk = new Uint8Array(${pkArr});
      const pubB58 = '${publicKeyB58}';
      window._signRequests = [];
      window.phantom = { solana: {
        isPhantom: true, isConnected: true,
        publicKey: { toString: () => pubB58, toBase58: () => pubB58, toBytes: () => pk },
        connect: async () => ({ publicKey: { toBase58: () => pubB58, toString: () => pubB58 } }),
        disconnect: async () => {},
        signMessage: async (msg) => {
          const msgArr = Array.from(msg);
          window._signRequests.push(msgArr);
          console.log('[SIGN_REQUEST]', new TextDecoder().decode(msg).slice(0, 200));
          
          // Request real signature from Node.js
          const sig = await window._nodeSign(msgArr);
          return { signature: new Uint8Array(sig), publicKey: window.phantom.solana.publicKey };
        },
        on: () => {}, off: () => {}, emit: () => {}, removeListener: () => {}
      }};
      window.solana = window.phantom.solana;
      console.log('[INJECTED] window.solana =', typeof window.solana);
    })();
  `);

  page.on('console', msg => {
    if (msg.text().includes('[INJECTED]') || msg.text().includes('[SIGN_REQUEST]') || msg.text().includes('ERROR')) {
      console.log('[PAGE LOG]', msg.text());
    }
  });

  console.log('Opening kintara.gg/play...');
  await page.goto('https://kintara.gg/play', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Try clicking play
  for (const sel of ['button:has-text("Play")', 'button:has-text("Connect")', 'button:has-text("Sign In")']) {
    const btn = await page.$(sel).catch(() => null);
    if (btn && await btn.isVisible().catch(() => false)) {
      console.log('Clicking:', sel);
      await btn.click();
      await page.waitForTimeout(3000);
      break;
    }
  }

  const signReqs = await page.evaluate(() => window._signRequests);
  console.log('\n=== SIGN REQUESTS ===');
  signReqs.forEach((arr, i) => {
    console.log(`[${i}]`, new TextDecoder().decode(new Uint8Array(arr)).slice(0, 200));
  });

  const cookies = await ctx.cookies('https://kintara.gg');
  console.log('\n=== COOKIES ===', cookies.map(c => c.name + '=' + c.value.slice(0,20)).join('; '));

  const localStorage = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage).slice(0, 10))));
  console.log('\n=== LOCALSTORAGE ===', localStorage);

  await page.screenshot({ path: '/home/btc/solana-game-bot/screenshot-after-login.png' });

  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
