// ================================================
// DIAGNOSTIC: Test harvest protocol via raw WS
// Tanpa Playwright, langsung pake session cookie
// ================================================
require('dotenv').config();
const WebSocket = require('ws');
const { getSession, apiFetch } = require('./auth');

const SERVER = 's1';
let posX = 0, posY = 0.25, posZ = 0;
let localPlayerId = null;
let connected = false;
let snapReceived = false;
let resEvents = [];

// Tile target buat test (rock near spawn)
const TEST_TILE = { col: 33, row: 15 };
const tileX = TEST_TILE.col - 22.5;  // 10.5
const tileZ = TEST_TILE.row - 42.5;  // -27.5

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function send(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const payload = { ...obj, ts: Date.now() };
  console.log(`  → SEND: ${JSON.stringify(payload)}`);
  ws.send(JSON.stringify(payload));
}

async function main() {
  console.log('=== KINTARA HARVEST DIAGNOSTIC ===\n');

  // 1. Auth
  console.log('[1] Getting session...');
  const cookies = await getSession();
  console.log(`    Session OK (${cookies.length} chars)\n`);

  // 2. Get player ID
  console.log('[2] Fetching player ID...');
  const me = await apiFetch('/api/auth/me');
  localPlayerId = me.player?.id;
  console.log(`    Player ID: ${localPlayerId}`);
  console.log(`    Skills: mining=${me.meta?.skills?.mining}, logging=${me.meta?.skills?.logging}`);
  console.log(`    Items: ${JSON.stringify(me.player?.equipped || me.player?.equip || 'N/A')}\n`);

  // 3. Queue
  console.log('[3] Connecting to queue...');
  await new Promise((resolve, reject) => {
    const qws = new WebSocket(`wss://kintara.gg/ws/queue/${SERVER}`, {
      headers: { 'Cookie': cookies, 'Origin': 'https://kintara.gg',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0' }
    });
    qws.on('message', raw => {
      const msg = JSON.parse(raw);
      console.log(`    Queue msg: ${JSON.stringify(msg)}`);
      if (msg.t === 'queue_ready') { qws.close(); resolve(); }
    });
    qws.on('error', e => reject(e));
    setTimeout(() => { qws.close(); reject(new Error('Queue timeout')); }, 15000);
  });
  console.log('    Queue OK!\n');

  // 4. Presence WS
  console.log('[4] Connecting to presence...');
  const ws = new WebSocket(`wss://kintara.gg/ws/presence/${SERVER}`, {
    headers: { 'Cookie': cookies, 'Origin': 'https://kintara.gg',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0' }
  });

  ws.on('open', () => {
    connected = true;
    console.log('    Presence connected!\n');
  });

  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    const t = msg.t;

    if (t === 'snap') {
      if (!snapReceived) {
        snapReceived = true;
        console.log('[5] First SNAP received!');
        // Find our player
        if (msg.players && localPlayerId) {
          const me = msg.players.find(p => p.id === localPlayerId);
          if (me) {
            posX = me.x; posY = me.y; posZ = me.z;
            console.log(`    My position: x=${posX}, y=${posY}, z=${posZ}`);
          } else {
            console.log('    ⚠️ Player not found in snap! Players:', msg.players.map(p => p.id));
          }
        }
        // Show resources
        if (msg.res) {
          console.log(`    Resources: ${msg.res.length} tiles`);
          msg.res.forEach(r => {
            console.log(`      ${r.kind}: keys=${JSON.stringify(r.keys)} coal=${r.hasCoal}`);
          });
        }
        console.log('');
        startHarvestTest(ws);
      }
    } else if (t === 'res_evt') {
      resEvents.push(msg);
      console.log(`  ← RES_EVT: evt=${msg.evt} keys=${JSON.stringify(msg.keys)} h=${msg.h} hm=${msg.hm}`);
    } else if (t === 'harv_grant') {
      console.log(`  ✅ HARV_GRANT: ${JSON.stringify(msg)}`);
    } else if (t === 'harv_grant_failed') {
      console.log(`  ❌ HARV_GRANT_FAILED: ${JSON.stringify(msg)}`);
    } else if (t === 'backpack_sync') {
      console.log(`  🎒 BACKPACK: reason=${msg.reason} items=${JSON.stringify(msg.items || msg.slots || 'N/A')}`);
    } else if (t === 'pos') {
      // Echo from server
    } else if (t !== 'arena_lb' && t !== 'online_total' && t !== 'pong') {
      console.log(`  ← ${t}: ${JSON.stringify(msg).substring(0, 200)}`);
    }
  });

  ws.on('close', code => {
    console.log(`\nWS closed: ${code}`);
    process.exit(0);
  });

  ws.on('error', e => console.error('WS Error:', e.message));

  // Wait then close
  setTimeout(() => {
    console.log('\n=== DIAGNOSTIC TIMEOUT (45s) ===');
    console.log(`Total res_evt received: ${resEvents.length}`);
    if (resEvents.length > 0) {
      console.log('Events:', resEvents.map(e => `${e.evt}(${e.keys})`).join(', '));
    }
    ws.close();
    process.exit(0);
  }, 45000);
}

async function startHarvestTest(ws) {
  await sleep(1000);

  // Step A: Send pos with act=mine + equipment
  console.log(`\n[6] Moving to tile (${tileX.toFixed(1)}, ${tileZ.toFixed(1)})...`);

  // Gradual move (2 steps)
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    send(ws, { t: 'pos', region: 'world',
      x: posX + (tileX - posX) * i / steps,
      y: posY,
      z: posZ + (tileZ - posZ) * i / steps,
      ry: 0, mov: 1, outfit: 0, le: 1 });
    await sleep(150);
  }
  posX = tileX; posZ = tileZ;
  send(ws, { t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1 });
  await sleep(500);

  // Step B: Send animation pos (act=mine, eq=pickaxe)
  console.log('[7] Sending act=mine + eq=tool_pickaxe...');
  send(ws, { t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1,
    act: 'mine', eq: 'tool_pickaxe' });
  await sleep(300);

  // Step C: Send harv to start harvest
  const keys = [`${TEST_TILE.col},${TEST_TILE.row}`];
  console.log(`[8] Sending harv (rock, keys=${keys})...`);
  send(ws, { t: 'harv', region: 'world', k: 'rock', keys, hasCoal: false });
  await sleep(800);

  // Step D: Send harv_hit repeatedly (swing animation)
  console.log('[9] Sending harv_hit x6 (swing simulation)...');
  for (let i = 0; i < 6; i++) {
    send(ws, { t: 'harv_hit', region: 'world', k: 'rock', keys, hasCoal: false });
    await sleep(800 + Math.random() * 200);
    // Update pos during mining (like real client)
    send(ws, { t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1,
      act: 'mine', eq: 'tool_pickaxe' });
  }

  console.log('[10] Done sending. Monitoring for server responses...');
  console.log(`     Total res_evt so far: ${resEvents.length}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
