// Monitor game client WS traffic during world entry
require('dotenv').config();
const { chromium } = require('playwright');
const nacl = require('tweetnacl');
const bs58mod = require('bs58');
const bs58 = bs58mod.default || bs58mod;
const fs = require('fs');

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

  // Monitor WS
  page.on('websocket', ws => {
    console.log(`\n🌐 WS CONNECTED: ${ws.url()}`);
    ws.on('framereceived', f => {
      if (f.payload) {
        try {
          const d = JSON.parse(f.payload);
          if (!['snap', 'pos', 'online_total', 'mp_rsv'].includes(d.t)) {
            console.log(`⬅️  IN: ${d.t} ${JSON.stringify(d).substring(0, 150)}`);
          } else if (d.t === 'snap') {
            const me = d.players?.find(p => p.id === 683);
            if (me) console.log(`⬅️  SNAP: ME FOUND! x:${me.x} z:${me.z} act:${me.act}`);
            else console.log(`⬅️  SNAP: ${d.players?.length} players (not me), ${d.res?.length} res`);
          }
        } catch(e) {}
      }
    });
    ws.on('framesent', f => {
      if (f.payload) {
        try {
          const d = JSON.parse(f.payload);
          if (!['pos'].includes(d.t)) {
            console.log(`➡️  OUT: ${d.t} ${JSON.stringify(d).substring(0, 150)}`);
          }
        } catch(e) {}
      }
    });
    ws.on('close', () => console.log('🌐 WS CLOSED'));
  });

  // Monitor API calls
  page.on('request', r => {
    const url = r.url().replace('https://kintara.gg', '');
    if (url.startsWith('/api/') || url.includes('queue') || url.includes('shard') || url.includes('presence')) {
      console.log(`📡 API: ${r.method()} ${url} ${r.postData()?.substring(0, 80) || ''}`);
    }
  });

  // Step 1: Login
  console.log('Step 1: Login...');
  await page.goto('https://kintara.gg', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes('connect'));
    if (btn) btn.click();
  });
  
  let sessionCookie = null;
  for (let i = 0; i < 15; i++) {
    const cookies = await ctx.cookies('https://kintara.gg');
    sessionCookie = cookies.find(c => c.name.includes('session'));
    if (sessionCookie) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(sessionCookie ? 'Login OK!' : 'Login failed');

  // Step 2: Go to /play
  console.log('\nStep 2: Go to /play...');
  await page.goto('https://kintara.gg/play', { waitUntil: 'networkidle' });
  await new Promise(r => setTimeout(r, 3000));

  // Step 3: Click PLAY
  console.log('\nStep 3: Click PLAY...');
  // Try clicking canvas first to trigger overlay
  await page.mouse.click(640, 400);
  await new Promise(r => setTimeout(r, 2000));
  
  // Click the PLAY button (HTML or canvas)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'PLAY');
    if (btn) { btn.click(); console.log('HTML PLAY clicked'); }
  });
  
  // Also try clicking on the canvas center where PLAY usually is
  await new Promise(r => setTimeout(r, 1000));
  await page.mouse.click(640, 360);
  
  // Wait for server selection
  console.log('\nStep 4: Wait for server selection...');
  await new Promise(r => setTimeout(r, 5000));
  
  // Try to find and click Server 1
  const serverResult = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const all = btns.map(b => ({ text: b.textContent.trim().substring(0, 50), w: b.getBoundingClientRect().width }));
    const s1 = btns.find(b => b.textContent.includes('SERVER 1') || b.textContent.includes('Server 1'));
    if (s1) { s1.click(); return { clicked: 'SERVER 1', all }; }
    const any = btns.find(b => b.textContent.includes('SERVER'));
    if (any) { any.click(); return { clicked: any.textContent.trim(), all }; }
    return { clicked: null, all };
  });
  console.log('Server buttons found:', JSON.stringify(serverResult.all?.filter(b => b.text.includes('SERVER') || b.text.includes('Play'))));
  console.log('Clicked:', serverResult.clicked);
  
  // Wait for game to load
  console.log('\nStep 5: Waiting for game to load + WS...');
  await new Promise(r => setTimeout(r, 15000));
  
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
