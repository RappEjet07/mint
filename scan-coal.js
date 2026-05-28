// Scan coal rocks dari live WS snap data
const cfg = require('./config');
const WebSocket = require('ws');

const cookies = (() => {
  try { return require('./.session.json').cookies; } catch { return ''; }
})();

if (!cookies) { console.log('❌ No session! Run bot dulu buat login.'); process.exit(1); }

console.log('🔍 Scanning coal rocks dari WS snap...\n');

const ws = new WebSocket(`wss://kintara.gg/ws/queue/${cfg.SERVER}`, {
  headers: { Cookie: cookies, Origin: 'https://kintara.gg' }
});

let gotSnap = false;

ws.on('open', () => {
  console.log('✅ Queue connected, waiting for slot...');
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  
  if (msg.t === 'queue_ready') {
    console.log('✅ Queue ready! Connecting ke presence...');
    const ws2 = new WebSocket(`wss://kintara.gg/ws/presence/${cfg.SERVER}`, {
      headers: { Cookie: cookies, Origin: 'https://kintara.gg' }
    });
    
    ws2.on('open', () => {
      console.log('✅ Presence connected, waiting for snap...\n');
      // Request world snap
      ws2.send(JSON.stringify({ t: 'enter', region: 'world' }));
    });
    
    ws2.on('message', (raw2) => {
      const msg2 = JSON.parse(raw2);
      
      if (msg2.t === 'snap' && msg2.res && !gotSnap) {
        gotSnap = true;
        
        // Filter semua rocks
        const allRocks = msg2.res.filter(r => r.kind === 'rock');
        const coalRocks = allRocks.filter(r => r.hasCoal === true);
        const stoneRocks = allRocks.filter(r => !r.hasCoal);
        
        console.log(`📊 Total rocks: ${allRocks.length}`);
        console.log(`   ⛏️  Stone rocks: ${stoneRocks.length}`);
        console.log(`   🔥 Coal rocks: ${coalRocks.length}\n`);
        
        if (coalRocks.length > 0) {
          console.log('🔥 COAL ROCK TILES:');
          console.log('━'.repeat(50));
          coalRocks.forEach((r, i) => {
            const key = r.keys?.[0] || '?';
            console.log(`  ${i+1}. [${key}] kind=${r.kind} hasCoal=${r.hasCoal}`);
          });
          
          // Format buat config
          console.log('\n📋 Copy ini ke config.js MINE_TILES:');
          console.log('━'.repeat(50));
          const coalTiles = coalRocks.map(r => {
            const key = r.keys?.[0];
            if (!key) return null;
            const [col, row] = key.split(',').map(Number);
            return `{ col: ${col}, row: ${row}, hasCoal: true }`;
          }).filter(Boolean);
          console.log(`  // Coal rocks (auto-detected)`);
          coalTiles.forEach(t => console.log(`  ${t},`));
        } else {
          console.log('⚠️  Gak ada coal rocks di snap data!');
          console.log('   Mungkin coal rocks spawn di area berbeda atau butuh level tertentu.');
        }
        
        // Also show some stone rocks for reference
        console.log('\n📋 Stone rocks (sample 5):');
        stoneRocks.slice(0, 5).forEach((r, i) => {
          const key = r.keys?.[0] || '?';
          console.log(`  ${i+1}. [${key}]`);
        });
        
        ws2.close();
        ws.close();
        process.exit(0);
      }
    });
    
    ws2.on('error', (e) => {
      console.log('❌ Presence error:', e.message);
      process.exit(1);
    });
  }
});

ws.on('error', (e) => {
  console.log('❌ Queue error:', e.message);
  process.exit(1);
});

// Timeout 30 detik
setTimeout(() => {
  console.log('❌ Timeout 30s — gak dapat snap data');
  process.exit(1);
}, 30000);
