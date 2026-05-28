require('dotenv').config();
const WebSocket = require('ws');
const { getSession, apiFetch } = require('./auth');

const SERVER = 's1';
const MY_ID = 1323;
let posX = 0, posY = 0.25, posZ = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

async function main() {
  const cookies = await getSession();

  // Queue
  const qws = new WebSocket(`wss://kintara.gg/ws/queue/${SERVER}`, {
    headers: { Cookie: cookies, Origin: 'https://kintara.gg' }
  });
  await new Promise((resolve, reject) => {
    qws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'queue_ready') { qws.close(); resolve(); } });
    setTimeout(() => reject(new Error('timeout')), 30000);
  });
  console.log('Queue OK');

  // Presence
  const ws = new WebSocket(`wss://kintara.gg/ws/presence/${SERVER}`, {
    headers: { Cookie: cookies, Origin: 'https://kintara.gg' }
  });

  let snapData = null;
  let myPlayer = null;

  ws.on('open', () => {
    console.log('WS OPEN');
    ws.send(JSON.stringify({ t: 'enter', region: 'world', ts: Date.now() }));
  });
  ws.on('close', code => { console.log('WS CLOSED:', code); process.exit(0); });
  ws.on('error', e => console.log('WS ERROR:', e.message));
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.t === 'snap') {
      snapData = msg;
      myPlayer = msg.players?.find(p => p.id === MY_ID);
    }
    if (msg.t === 'res_evt') {
      if (msg.by === MY_ID) console.log(`  ← RES_EVT: ${msg.evt} [${msg.keys}] h=${msg.h}/${msg.hm}`);
    }
    if (msg.t === 'harv_grant') console.log(`  🎉 HARV_GRANT: ${JSON.stringify(msg)}`);
    if (msg.t === 'harv_grant_failed') console.log(`  ❌ HARV_FAILED: ${JSON.stringify(msg)}`);
    if (msg.t === 'skill_xp') console.log(`  📈 XP`);
    if (msg.t === 'backpack_sync') console.log(`  🎒 BACKPACK: ${msg.reason}`);
  });

  // Wait for snap with my player AND res data
  console.log('Waiting for snap with player + res...');
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (snapData) {
      myPlayer = snapData.players?.find(p => p.id === MY_ID);
      const resCount = snapData.res?.length || 0;
      if (i % 5 === 0) console.log(`  snap[${i}]: me=${myPlayer ? 'YES' : 'NO'} res=${resCount}`);
      if (myPlayer && resCount > 0) break;
    }
  }

  if (!myPlayer) {
    console.log('My player NOT in snap! Trying pos messages...');
    // Send some pos messages to register
    for (let i = 0; i < 5; i++) {
      ws.send(JSON.stringify({ t: 'pos', region: 'world', x: 7.5, y: 0.25, z: -19.5, ry: 0, mov: 0, outfit: 0, le: 1, ts: Date.now() }));
      await sleep(500);
    }
    await sleep(2000);
    myPlayer = snapData?.players?.find(p => p.id === MY_ID);
    console.log('After pos: me=' + (myPlayer ? 'YES' : 'NO'));
  }

  const resCount = snapData?.res?.length || 0;
  const trees = (snapData?.res || []).filter(r => r.kind === 'tree' && r.keys?.length > 0);
  const rocks = (snapData?.res || []).filter(r => r.kind === 'rock' && r.keys?.length > 0);
  console.log(`\nRes: ${resCount} (trees=${trees.length}, rocks=${rocks.length})`);

  if (myPlayer) {
    posX = myPlayer.x; posY = myPlayer.y; posZ = myPlayer.z;
    console.log(`My pos: (${posX.toFixed(1)}, ${posY.toFixed(1)}, ${posZ.toFixed(1)}) le=${myPlayer.le}`);
  }

  if (trees.length === 0 && rocks.length === 0) {
    console.log('NO RESOURCES! Cannot test harvest.');
    ws.close();
    process.exit(0);
  }

  // Pick closest resource
  const allRes = trees.length > 0 ? trees : rocks;
  const kind = trees.length > 0 ? 'tree' : 'rock';
  const act = kind === 'tree' ? 'chop' : 'mine';
  const eq = kind === 'tree' ? 'tool_axe' : 'tool_pickaxe';

  let closest = allRes[0], closestDist = Infinity;
  for (const r of allRes) {
    const [c, rw] = r.keys[0].split(',').map(Number);
    const d = Math.abs(c - (posX + 22.5)) + Math.abs(rw - (posZ + 42.5));
    if (d < closestDist) { closestDist = d; closest = r; }
  }
  const keys = closest.keys;
  const [col, row] = keys[0].split(',').map(Number);
  const tx = col - 22.5, tz = row - 42.5;
  console.log(`\nTarget: ${kind} [${keys}] dist=${closestDist}`);

  // Move
  const dx = tx - posX, dz = tz - posZ;
  const dist = Math.sqrt(dx*dx + dz*dz);
  const steps = Math.ceil(dist * 2);
  for (let i = 1; i <= steps; i++) {
    ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX + dx*i/steps, y: posY, z: posZ + dz*i/steps, ry: 0, mov: 1, outfit: 0, le: 1, ts: Date.now() }));
    await sleep(150);
  }
  posX = tx; posZ = tz;
  ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1, ts: Date.now() }));
  await sleep(1000);
  console.log('Arrived');

  // Send pos with act/eq a few times first (like game client does)
  for (let i = 0; i < 3; i++) {
    ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1, act, eq, ts: Date.now() }));
    await sleep(1000);
  }
  console.log('Sent pos with act/eq x3');

  // harv
  console.log('Sending harv...');
  ws.send(JSON.stringify({ t: 'harv', region: 'world', k: kind, keys, hasCoal: false, ts: Date.now() }));
  await sleep(500);

  // harv_hit with pos
  for (let i = 0; i < 6; i++) {
    console.log(`Hit ${i+1}...`);
    ws.send(JSON.stringify({ t: 'harv_hit', region: 'world', k: kind, keys, hasCoal: false, ts: Date.now() }));
    await sleep(300);
    ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1, act, eq, ts: Date.now() }));
    await sleep(500);
  }

  // claim
  ws.send(JSON.stringify({ t: 'harv', region: 'world', k: kind, keys, hasCoal: false, ts: Date.now() }));
  await sleep(2000);

  console.log('\n=== DONE ===');
  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
setTimeout(() => { console.log('GLOBAL TIMEOUT'); process.exit(0); }, 90000);
