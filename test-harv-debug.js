// Test harvest: connect langsung pake cached session, log ALL server responses
const fs = require('fs');
const WebSocket = require('./node_modules/ws');

const sessionFile = __dirname + '/.session.json';
const cache = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
const cookies = cache.cookies;

console.log('Using cached session');

// Quick auth check
(async () => {
  const res = await fetch('https://kintara.gg/api/auth/me', { headers: { Cookie: cookies } });
  const me = await res.json();
  console.log(`Player: ${me.player?.id} (${me.player?.display_name})`);
  console.log(`Skills: ${JSON.stringify(me.meta?.skills)}`);
  console.log(`Hotbar: ${JSON.stringify(me.backpack?.hotbar)}`);
  console.log(`Equipped: ${me.backpack?.equippedHotbar}`);
  
  const pid = me.player.id;
  const spawn = me.meta?.spawn;
  console.log(`Spawn: ${JSON.stringify(spawn)}`);
  
  // Connect to WS
  const ws = new WebSocket('wss://kintara.gg/ws/presence/s1', {
    headers: { Cookie: cookies, Origin: 'https://kintara.gg' }
  });
  
  let posX = null, posZ = null;
  let snapReceived = false;
  let harvSent = false;
  
  ws.on('open', () => {
    console.log('\nWS Connected!');
  });
  
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const t = msg.t;
    
    // Log ALL messages (skip noisy ones)
    if (['snap', 'pos', 'mp_rsv'].includes(t)) {
      if (t === 'snap') {
        const res = msg.res || [];
        const players = msg.players || [];
        const me = players.find(p => p.id === pid);
        if (!snapReceived) {
          console.log(`\nSNAP #1: ${res.length} resources, ${players.length} players`);
          console.log(`  Resources sample: ${res.slice(0,5).map(r => `${r.kind} ${r.keys?.[0]}`).join(', ')}`);
          if (me) {
            console.log(`  My position: x:${me.x}, z:${me.z}`);
            posX = me.x; posZ = me.z;
          } else {
            console.log(`  My player (${pid}) not found in players list`);
            // Try to find by checking all players
            players.slice(0,3).forEach(p => console.log(`  Player ${p.id}: x:${p.x}, z:${p.z}, act:${p.act}`));
          }
          snapReceived = true;
        }
      }
      return;
    }
    
    // Log everything else
    console.log(`MSG: ${t} → ${JSON.stringify(msg).substring(0, 300)}`);
  });
  
  ws.on('close', (code) => {
    console.log(`WS Closed: ${code}`);
    process.exit(0);
  });
  
  ws.on('error', (e) => console.error(`WS Error: ${e.message}`));
  
  // After 3 seconds (snap should have arrived), try harvest
  setTimeout(() => {
    if (!snapReceived) {
      console.log('No snap received yet, wait more...');
      return;
    }
    
    console.log(`\n=== Current position: ${posX}, ${posZ} ===`);
    
    // First: just try harv at current position (no movement)
    console.log('\n--- Test 1: harv at current position ---');
    const nearRock = findNearestRock(posX, posZ);
    if (nearRock) {
      console.log(`Nearest rock: ${nearRock.key} at world (${nearRock.wx.toFixed(1)}, ${nearRock.wz.toFixed(1)})`);
      ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX, y: 0.25, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1, act: 'mine', eq: 'tool_pickaxe', ts: Date.now() }));
      setTimeout(() => {
        ws.send(JSON.stringify({ t: 'harv', region: 'world', k: 'rock', keys: [nearRock.key], hasCoal: false }));
        console.log(`Sent harv: rock ${nearRock.key}`);
        harvSent = true;
      }, 500);
    } else {
      console.log('No nearby rocks found');
    }
  }, 4000);
  
  // After 8 seconds, move to a specific rock and try again
  setTimeout(() => {
    if (!harvSent) return;
    console.log('\n--- Test 2: move to rock and harv ---');
    const targetKey = '38,20';
    const [tc, tr] = targetKey.split(',').map(Number);
    const tx = tc - 22.5, tz = tr - 42.5;
    console.log(`Moving to rock ${targetKey} at (${tx}, ${tz})...`);
    
    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      setTimeout(() => {
        const nx = posX + (tx - posX) * i / steps;
        const nz = posZ + (tz - posZ) * i / steps;
        ws.send(JSON.stringify({ t: 'pos', region: 'world', x: nx, y: 0.25, z: nz, ry: 0, mov: 1, outfit: 0, le: 1 }));
        if (i === steps) {
          posX = tx; posZ = tz;
          ws.send(JSON.stringify({ t: 'pos', region: 'world', x: posX, y: 0.25, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1, act: 'mine', eq: 'tool_pickaxe', ts: Date.now() }));
          console.log(`Arrived. Sending harv...`);
          setTimeout(() => {
            ws.send(JSON.stringify({ t: 'harv', region: 'world', k: 'rock', keys: [targetKey], hasCoal: false }));
            console.log(`Sent harv: rock ${targetKey}`);
          }, 500);
        }
      }, i * 150);
    }
  }, 8000);
  
  // Kill after 15 seconds
  setTimeout(() => {
    console.log('\n=== Test complete ===');
    ws.close();
    process.exit(0);
  }, 15000);
  
  function findNearestRock(px, pz) {
    // We don't have snap res in this scope, so just use a hardcoded nearby rock
    // Based on spawn around (-16.5, -9.5), nearby rocks from snap data
    const rocks = [
      { key: '38,20', wx: 15.5, wz: -22.5 },
      { key: '41,26', wx: 18.5, wz: -16.5 },
      { key: '41,23', wx: 18.5, wz: -19.5 },
    ];
    let best = null, bestDist = Infinity;
    for (const r of rocks) {
      const d = Math.sqrt((r.wx - px) ** 2 + (r.wz - pz) ** 2);
      if (d < bestDist) { bestDist = d; best = r; }
    }
    return best;
  }
  
})();
