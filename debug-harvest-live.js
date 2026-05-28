require('dotenv').config();
const WebSocket = require('ws');
const { getSession, apiFetch } = require('./auth');

const SERVER = 's1';
let posX = 0, posY = 0.25, posZ = 0;
const MY_ID = 1323;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

async function main() {
  const cookies = await getSession();
  const me = await apiFetch('/api/auth/me');
  console.log('Player:', me.player?.id);

  // Queue
  const qws = new WebSocket(`wss://kintara.gg/ws/queue/${SERVER}`, {
    headers: { 'Cookie': cookies, 'Origin': 'https://kintara.gg' }
  });
  await new Promise((resolve, reject) => {
    qws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'queue_ready') { qws.close(); resolve(); } });
    qws.on('error', e => reject(e));
    setTimeout(() => reject(new Error('timeout')), 30000);
  });
  console.log('Queue OK');

  // Presence
  const ws = new WebSocket(`wss://kintara.gg/ws/presence/${SERVER}`, {
    headers: { 'Cookie': cookies, 'Origin': 'https://kintara.gg' }
  });

  let snapData = null;
  let wearEvents = [];
  let clearEvents = [];
  let harvGrant = null;
  let myResEvts = []; // Track res_evt from our actions

  ws.on('open', () => {
    console.log('WS OPEN');
    // Send enter to register for resource events!
    ws.send(JSON.stringify({ t: 'enter', region: 'world', ts: Date.now() }));
    console.log('Sent enter world');
  });
  ws.on('close', code => { console.log('WS CLOSED:', code); process.exit(0); });
  ws.on('error', e => console.log('WS ERROR:', e.message));
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.t === 'snap') {
      snapData = msg;
      if (msg.players) {
        const p = msg.players.find(p => p.id === MY_ID);
        if (p) { posX = p.x; posY = p.y; posZ = p.z; }
      }
    }
    if (msg.t === 'res_evt') {
      if (msg.evt === 'wear' && msg.by === MY_ID) {
        wearEvents.push(msg);
        console.log(`  ✅ WEAR [${msg.keys}] h=${msg.h}/${msg.hm} by=${msg.by}`);
      } else if (msg.evt === 'clear' && msg.by === MY_ID) {
        clearEvents.push(msg);
        console.log(`  ✅ CLEAR [${msg.keys}] by=${msg.by}`);
      } else if (msg.evt === 'wear' || msg.evt === 'clear') {
        // Other player events — only log occasionally
      }
      myResEvts.push(msg);
    }
    if (msg.t === 'harv_grant') {
      harvGrant = msg;
      console.log(`  🎉 HARV_GRANT: ${JSON.stringify(msg)}`);
    }
    if (msg.t === 'harv_grant_failed') {
      console.log(`  ❌ HARV_FAILED: ${JSON.stringify(msg)}`);
    }
    if (msg.t === 'skill_xp') {
      console.log(`  📈 SKILL_XP: ${JSON.stringify(msg).substring(0, 200)}`);
    }
    if (msg.t === 'backpack_sync') {
      console.log(`  🎒 BACKPACK: ${msg.reason}`);
    }
  });

  // Wait for snap with res data (up to 15s)
  console.log('Waiting for snap with res data...');
  await new Promise(r => {
    const c = setInterval(() => {
      if (snapData?.res?.length > 0) { clearInterval(c); r(); }
    }, 200);
    setTimeout(() => { clearInterval(c); r(); }, 15000);
  });
  
  const resCount = snapData?.res?.length || 0;
  console.log(`\nSnap OK. Pos: (${posX.toFixed(1)}, ${posZ.toFixed(1)})`);
  console.log(`Resources: ${resCount}`);
  
  if (resCount === 0) {
    console.log('NO RES IN SNAP! Trying to wait more...');
    await sleep(5000);
    console.log(`After wait: Resources: ${snapData?.res?.length || 0}`);
  }

  // Pick nearest tree
  const trees = (snapData?.res || []).filter(r => r.kind === 'tree' && r.keys?.length > 0);
  if (trees.length === 0) { console.log('STILL NO TREES!'); ws.close(); process.exit(1); }
  
  let closest = trees[0], closestDist = Infinity;
  for (const t of trees) {
    const [c, r] = t.keys[0].split(',').map(Number);
    const d = Math.abs(c - (posX + 22.5)) + Math.abs(r - (posZ + 42.5));
    if (d < closestDist) { closestDist = d; closest = t; }
  }
  const key = closest.keys[0];
  const keys = closest.keys; // Use ALL keys from the resource
  const [col, row] = key.split(',').map(Number);
  const tx = col - 22.5, tz = row - 42.5;
  console.log(`\nTarget: tree [${key}] keys=${JSON.stringify(keys)} dist=${closestDist}`);

  // Move to tile
  const dx = tx - posX, dz = tz - posZ;
  const dist = Math.sqrt(dx*dx + dz*dz);
  const steps = Math.ceil(dist * 2);
  for (let i = 1; i <= steps; i++) {
    ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX + dx*i/steps, y: posY, z: posZ + dz*i/steps, ry: 0, mov: 1, outfit: 0, le: 1, ts: Date.now() }));
    await sleep(150);
  }
  posX = tx; posZ = tz;
  ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1, ts: Date.now() }));
  await sleep(500);
  console.log('Arrived at tile');

  // Send pos with act+eq
  ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1, act: 'chop', eq: 'tool_axe', ts: Date.now() }));
  await sleep(300);

  // Reset tracking
  wearEvents = [];
  clearEvents = [];
  harvGrant = null;

  // Send harv
  console.log(`\nSending harv (keys=${JSON.stringify(keys)})...`);
  ws.send(JSON.stringify({ t: 'harv', region: 'world', k: 'tree', keys, hasCoal: false, ts: Date.now() }));
  await sleep(500);

  // Send harv_hit x8 with pos+act+eq
  for (let i = 0; i < 8; i++) {
    console.log(`\n--- Hit ${i+1} (my wear events: ${wearEvents.length}) ---`);
    ws.send(JSON.stringify({ t: 'harv_hit', region: 'world', k: 'tree', keys, hasCoal: false, ts: Date.now() }));
    ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1, act: 'chop', eq: 'tool_axe', ts: Date.now() }));
    await sleep(700 + rand(-50, 100));
    
    if (clearEvents.length > 0) {
      console.log(`\n✅ CLEARED after ${i+1} hits!`);
      break;
    }
  }

  // Final harv claim
  console.log('\nSending final harv (claim)...');
  ws.send(JSON.stringify({ t: 'harv', region: 'world', k: 'tree', keys, hasCoal: false, ts: Date.now() }));
  await sleep(2000);

  console.log(`\n=== RESULTS ===`);
  console.log(`My wear events: ${wearEvents.length}`);
  console.log(`My clear events: ${clearEvents.length}`);
  console.log(`Harv grant: ${harvGrant ? 'YES' : 'NO'}`);
  console.log(`Total res_evt from server: ${myResEvts.length}`);
  
  // Show all res_evt that mention our target key
  const keyStr = keys.sort().join(',');
  const relevant = myResEvts.filter(e => {
    const ek = (e.keys || []).slice().sort().join(',');
    return ek === keyStr;
  });
  console.log(`Res_evt for our keys [${keyStr}]: ${relevant.length}`);
  relevant.forEach(e => console.log(`  ${e.evt} by=${e.by} h=${e.h}/${e.hm}`));

  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
setTimeout(() => { console.log('GLOBAL TIMEOUT'); process.exit(0); }, 90000);
