// ================================================
// DIAGNOSTIC v2: Test harvest WITH presence timer (like bot)
// Target: config tile [33,15] (known working) vs live snap tile
// ================================================
require('dotenv').config();
const WebSocket = require('ws');
const { getSession, apiFetch } = require('./auth');

const SERVER = 's1';
let posX = 0, posY = 0.25, posZ = 0;
let localPlayerId = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function send(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const payload = { ...obj, ts: Date.now() };
  // Only log harvest-related messages
  if (['harv', 'harv_hit'].includes(payload.t)) {
    console.log(`  → SEND ${payload.t}: keys=${JSON.stringify(payload.keys)} k=${payload.k}`);
  }
  ws.send(JSON.stringify(payload));
}

async function main() {
  console.log('=== HARVEST DIAGNOSTIC v2 (with presence timer) ===\n');

  const cookies = await getSession();
  const me = await apiFetch('/api/auth/me');
  localPlayerId = me.player?.id;
  console.log(`Player: ${localPlayerId}, mining=${me.meta?.skills?.mining}\n`);

  // Queue
  await new Promise((resolve, reject) => {
    const qws = new WebSocket(`wss://kintara.gg/ws/queue/${SERVER}`, {
      headers: { 'Cookie': cookies, 'Origin': 'https://kintara.gg',
        'User-Agent': 'Mozilla/5.0 Chrome/124.0.0.0' }
    });
    qws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.t === 'queue_ready') { qws.close(); resolve(); }
    });
    qws.on('error', e => reject(e));
    setTimeout(() => { qws.close(); reject(new Error('timeout')); }, 30000);
  });
  console.log('Queue OK\n');

  // Presence WS
  const ws = new WebSocket(`wss://kintara.gg/ws/presence/${SERVER}`, {
    headers: { 'Cookie': cookies, 'Origin': 'https://kintara.gg',
      'User-Agent': 'Mozilla/5.0 Chrome/124.0.0.0' }
  });

  let connected = false;
  let snapData = null;
  let wearEvents = [];
  let clearEvents = [];
  let harvGrant = null;
  let harvFailed = null;
  let xpEvent = null;

  ws.on('open', () => { connected = true; console.log('Presence connected!\n'); });

  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    switch (msg.t) {
      case 'snap':
        snapData = msg;
        if (msg.players && localPlayerId) {
          const me = msg.players.find(p => p.id === localPlayerId);
          if (me) { posX = me.x; posY = me.y; posZ = me.z; }
        }
        break;
      case 'res_evt':
        if (msg.keys) {
          const key = msg.keys.sort().join(',');
          if (msg.evt === 'wear') {
            wearEvents.push({ key, h: msg.h, hm: msg.hm, ts: Date.now() });
            // Only log target tile events
            if (key === '33,15' || key === '24,4' || key === '9,36') {
              console.log(`  ← WEAR [${key}] h=${msg.h}/${msg.hm}`);
            }
          } else if (msg.evt === 'clear') {
            clearEvents.push({ key, ts: Date.now() });
            if (key === '33,15' || key === '24,4' || key === '9,36') {
              console.log(`  ✅ CLEAR [${key}]!`);
            }
          } else if (msg.evt === 'spawn') {
            // Don't log
          }
        }
        break;
      case 'harv_grant':
        harvGrant = msg;
        console.log(`  🎉 HARV_GRANT: ${JSON.stringify(msg)}`);
        break;
      case 'harv_grant_failed':
        harvFailed = msg;
        console.log(`  ❌ HARV_FAILED: ${JSON.stringify(msg)}`);
        break;
      case 'skill_xp':
        xpEvent = msg;
        console.log(`  📈 SKILL_XP: ${JSON.stringify(msg).substring(0, 200)}`);
        break;
      case 'backpack_sync':
        console.log(`  🎒 BACKPACK_SYNC: reason=${msg.reason}`);
        break;
      case 'region_ack':
        console.log(`  ← region_ack: ${msg.region}`);
        break;
    }
  });

  ws.on('close', code => { console.log(`\nWS closed: ${code}`); process.exit(0); });

  // Wait for first snap
  await new Promise(resolve => {
    const check = setInterval(() => { if (snapData) { clearInterval(check); resolve(); } }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 10000);
  });
  console.log(`Snap received. Position: (${posX.toFixed(1)}, ${posZ.toFixed(1)})\n`);

  // START PRESENCE TIMER (like bot does!)
  console.log('Starting presence timer (2000ms)...');
  let isHarvesting = false;
  const presenceInterval = setInterval(() => {
    if (isHarvesting) return; // suppressed during harvest
    send(ws, {
      t: 'pos', region: 'world',
      x: posX + (Math.random() - 0.5) * 0.2,
      y: posY, z: posZ + (Math.random() - 0.5) * 0.2,
      ry: 0, mov: 0, outfit: 0, le: 1,
    });
  }, 2000);

  await sleep(2000);

  // ===== TEST 1: Config tile [33,15] (known working) =====
  console.log('\n===== TEST 1: Config tile [33,15] =====');
  const tileX = 33 - 22.5; // 10.5
  const tileZ = 15 - 42.5; // -27.5

  // Move to tile
  console.log(`Moving to (${tileX}, ${tileZ})...`);
  const dx = tileX - posX;
  const dz = tileZ - posZ;
  const dist = Math.sqrt(dx*dx + dz*dz);
  const steps = Math.ceil(dist * 2);
  for (let i = 1; i <= steps; i++) {
    send(ws, { t: 'pos', region: 'world',
      x: posX + dx * i / steps, y: posY, z: posZ + dz * i / steps,
      ry: 0, mov: 1, outfit: 0, le: 1 });
    await sleep(150);
  }
  posX = tileX; posZ = tileZ;
  send(ws, { t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1 });
  await sleep(500);

  // Send act=pos
  send(ws, { t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1,
    act: 'mine', eq: 'tool_pickaxe' });
  await sleep(300);

  // Harvest with presence timer SUPPRESSED
  isHarvesting = true;
  const keys = ['33,15'];

  // Step 1: harv
  console.log('Sending harv...');
  send(ws, { t: 'harv', region: 'world', k: 'rock', keys, hasCoal: false });
  await sleep(300);

  // Step 2: harv_hit x8
  wearEvents = [];
  clearEvents = [];
  console.log('Sending harv_hit x8...');
  for (let i = 0; i < 8; i++) {
    send(ws, { t: 'harv_hit', region: 'world', k: 'rock', keys, hasCoal: false });
    // Send pos with act (like bot does)
    send(ws, { t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1,
      act: 'mine', eq: 'tool_pickaxe' });
    await sleep(800 + rand(-50, 100));

    const targetWear = wearEvents.filter(e => e.key === '33,15');
    const targetClear = clearEvents.filter(e => e.key === '33,15');
    if (targetClear.length > 0) {
      console.log(`\n✅ TILE [33,15] CLEARED after ${i + 1} hits!`);
      break;
    }
    if (targetWear.length > 0) {
      const last = targetWear[targetWear.length - 1];
      console.log(`  Hit ${i + 1}: wear ${last.h}/${last.hm}`);
    } else {
      console.log(`  Hit ${i + 1}: NO WEAR EVENT for 33,15`);
    }
  }

  // Claim
  await sleep(300);
  send(ws, { t: 'harv', region: 'world', k: 'rock', keys, hasCoal: false });
  await sleep(1000);
  isHarvesting = false;

  console.log(`\n--- TEST 1 RESULTS ---`);
  console.log(`Wear events for 33,15: ${wearEvents.filter(e => e.key === '33,15').length}`);
  console.log(`Clear events for 33,15: ${clearEvents.filter(e => e.key === '33,15').length}`);
  console.log(`Harv grant: ${harvGrant ? 'YES' : 'NO'}`);
  console.log(`XP event: ${xpEvent ? 'YES' : 'NO'}`);

  // ===== TEST 2: Live snap rock tile (from current snap) =====
  await sleep(3000);
  let liveRock = null;
  if (snapData?.res) {
    const rocks = snapData.res.filter(r => r.kind === 'rock' && r.keys?.length === 1);
    if (rocks.length > 0) {
      liveRock = rocks[rand(0, Math.min(3, rocks.length - 1))];
    }
  }

  if (liveRock) {
    const liveKey = liveRock.keys[0];
    const [c, r] = liveKey.split(',').map(Number);
    const lx = c - 22.5;
    const lz = r - 42.5;
    console.log(`\n===== TEST 2: Live snap rock [${liveKey}] =====`);

    // Move
    const ddx = lx - posX, ddz = lz - posZ;
    const dd = Math.sqrt(ddx*ddx + ddz*ddz);
    const ss = Math.ceil(dd * 2);
    for (let i = 1; i <= ss; i++) {
      send(ws, { t: 'pos', region: 'world',
        x: posX + ddx * i / ss, y: posY, z: posZ + ddz * i / ss,
        ry: 0, mov: 1, outfit: 0, le: 1 });
      await sleep(150);
    }
    posX = lx; posZ = lz;
    send(ws, { t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1 });
    await sleep(500);

    send(ws, { t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1,
      act: 'mine', eq: 'tool_pickaxe' });
    await sleep(300);

    isHarvesting = true;
    wearEvents = [];
    clearEvents = [];
    harvGrant = null;
    xpEvent = null;

    const liveKeys = liveRock.keys;
    send(ws, { t: 'harv', region: 'world', k: 'rock', keys: liveKeys, hasCoal: liveRock.hasCoal || false });
    await sleep(300);

    console.log('Sending harv_hit x8...');
    for (let i = 0; i < 8; i++) {
      send(ws, { t: 'harv_hit', region: 'world', k: 'rock', keys: liveKeys, hasCoal: liveRock.hasCoal || false });
      send(ws, { t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1,
        act: 'mine', eq: 'tool_pickaxe' });
      await sleep(800 + rand(-50, 100));

      const tw = wearEvents.filter(e => e.key === liveKey);
      const tc = clearEvents.filter(e => e.key === liveKey);
      if (tc.length > 0) {
        console.log(`\n✅ TILE [${liveKey}] CLEARED after ${i + 1} hits!`);
        break;
      }
      if (tw.length > 0) {
        const last = tw[tw.length - 1];
        console.log(`  Hit ${i + 1}: wear ${last.h}/${last.hm}`);
      } else {
        console.log(`  Hit ${i + 1}: NO WEAR EVENT for [${liveKey}]`);
      }
    }

    await sleep(300);
    send(ws, { t: 'harv', region: 'world', k: 'rock', keys: liveKeys, hasCoal: liveRock.hasCoal || false });
    await sleep(1000);
    isHarvesting = false;

    console.log(`\n--- TEST 2 RESULTS ---`);
    console.log(`Wear events for [${liveKey}]: ${wearEvents.filter(e => e.key === liveKey).length}`);
    console.log(`Clear events: ${clearEvents.filter(e => e.key === liveKey).length}`);
    console.log(`Harv grant: ${harvGrant ? 'YES' : 'NO'}`);
  }

  clearInterval(presenceInterval);
  console.log('\n=== DONE ===');
  ws.close();
  process.exit(0);
}

setTimeout(() => { console.log('\nGLOBAL TIMEOUT'); process.exit(0); }, 120000);
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
