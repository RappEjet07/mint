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

  const qws = new WebSocket(`wss://kintara.gg/ws/queue/${SERVER}`, {
    headers: { Cookie: cookies, Origin: 'https://kintara.gg' }
  });
  await new Promise((resolve, reject) => {
    qws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'queue_ready') { qws.close(); resolve(); } });
    setTimeout(() => reject(new Error('timeout')), 30000);
  });

  const ws = new WebSocket(`wss://kintara.gg/ws/presence/${SERVER}`, {
    headers: { Cookie: cookies, Origin: 'https://kintara.gg' }
  });

  let snapData = null;
  let registered = false;

  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'enter', region: 'world' }));
    ws.send(JSON.stringify({ t: 'pos', region: 'world', x: 0, y: 0.25, z: 0, ry: 0, mov: 0, outfit: 0, le: 1 }));
  });
  ws.on('close', code => { console.log('WS CLOSED:', code); process.exit(0); });
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.t === 'snap') {
      snapData = msg;
      const me = msg.players?.find(p => p.id === MY_ID);
      if (me) {
        registered = true;
        if (me.x != null) posX = me.x;
        if (me.y != null) posY = me.y;
        if (me.z != null) posZ = me.z;
      }
    }
    if (msg.t === 'res_evt' && msg.by === MY_ID) console.log(`  ← RES_EVT: ${msg.evt} [${msg.keys}] h=${msg.h}/${msg.hm}`);
    if (msg.t === 'harv_grant') console.log(`  🎉 GRANT: ${JSON.stringify(msg)}`);
    if (msg.t === 'harv_grant_failed') console.log(`  ❌ FAILED: ${JSON.stringify(msg)}`);
    if (msg.t === 'backpack_sync') console.log(`  🎒 BP: ${msg.reason}`);
    if (msg.t === 'skill_xp') console.log(`  📈 XP`);
  });

  // Wait for registration + res
  console.log('Waiting for snap...');
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const resC = snapData?.res?.length || 0;
    if (registered && resC > 0) { console.log(`Ready! res=${resC} pos=(${posX.toFixed(1)},${posZ.toFixed(1)})`); break; }
    if (i === 19) console.log(`Timeout: reg=${registered} res=${snapData?.res?.length || 0}`);
  }

  // Pick closest tree (SINGLE KEY ONLY)
  const trees = (snapData?.res || []).filter(r => r.kind === 'tree' && r.keys?.length === 1);
  if (!trees.length) { console.log('No single-key trees!'); ws.close(); process.exit(0); }

  let closest = trees[0], closestDist = Infinity;
  for (const t of trees) {
    const [c, r] = t.keys[0].split(',').map(Number);
    const d = Math.abs(c - (posX + 22.5)) + Math.abs(r - (posZ + 42.5));
    if (d < closestDist) { closestDist = d; closest = t; }
  }
  const key = closest.keys[0];
  const [col, row] = key.split(',').map(Number);
  const tx = col - 22.5, tz = row - 42.5;
  console.log(`\nTarget: tree [${key}] dist=${closestDist}`);

  // Move step by step
  const dx = tx - posX, dz = tz - posZ;
  const dist = Math.sqrt(dx*dx + dz*dz);
  const steps = Math.ceil(dist * 2);
  for (let i = 1; i <= steps; i++) {
    ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX + dx*i/steps, y: posY, z: posZ + dz*i/steps, ry: 0, mov: 1, outfit: 0, le: 1 }));
    await sleep(150);
  }
  posX = tx; posZ = tz;
  ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1 }));
  await sleep(500);
  console.log('Arrived');

  // KEY CHANGE: Send pos with act/eq REPEATEDLY before harv (like game presence timer)
  for (let i = 0; i < 5; i++) {
    ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX + rand(-1,1)*0.1, y: posY, z: posZ + rand(-1,1)*0.1, ry: 0, mov: 0, outfit: 0, le: 1, act: 'chop', eq: 'tool_axe' }));
    await sleep(800);
  }
  console.log('Sent pos+act x5');

  // harv
  console.log('Sending harv...');
  ws.send(JSON.stringify({ t: 'harv', region: 'world', k: 'tree', keys: [key], hasCoal: false }));
  await sleep(500);

  // harv_hit — NO accompanying pos (let act state persist from earlier pos messages)
  for (let i = 0; i < 8; i++) {
    console.log(`Hit ${i+1}...`);
    ws.send(JSON.stringify({ t: 'harv_hit', region: 'world', k: 'tree', keys: [key], hasCoal: false }));
    await sleep(750 + rand(-50, 100));
    // Send pos+act every 2nd hit (like presence timer interval)
    if (i % 2 === 1) {
      ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX + rand(-1,1)*0.1, y: posY, z: posZ + rand(-1,1)*0.1, ry: 0, mov: 0, outfit: 0, le: 1, act: 'chop', eq: 'tool_axe' }));
    }
  }

  // claim
  ws.send(JSON.stringify({ t: 'harv', region: 'world', k: 'tree', keys: [key], hasCoal: false }));
  await sleep(2000);

  console.log('\n=== DONE ===');
  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(0); }, 90000);
