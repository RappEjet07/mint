// Scan active tree tiles dari live WS snap
const cfg = require('./config');
const WebSocket = require('ws');

const cookies = (() => {
  try { return require('./.session.json').cookies; } catch { return ''; }
})();

if (!cookies) { console.log('❌ No session!'); process.exit(1); }

console.log('🔍 Scanning tree tiles dari WS snap...\n');

const ws = new WebSocket(`wss://kintara.gg/ws/queue/${cfg.SERVER}`, {
  headers: { Cookie: cookies, Origin: 'https://kintara.gg' }
});

ws.on('open', () => console.log('✅ Queue connected...'));

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);

  if (msg.t === 'queue_ready') {
    const ws2 = new WebSocket(`wss://kintara.gg/ws/presence/${cfg.SERVER}`, {
      headers: { Cookie: cookies, Origin: 'https://kintara.gg' }
    });

    ws2.on('open', () => {
      console.log('✅ Presence connected, waiting for snap...\n');
      ws2.send(JSON.stringify({ t: 'enter', region: 'world' }));
    });

    ws2.on('message', (raw2) => {
      const msg2 = JSON.parse(raw2);

      if (msg2.t === 'snap' && msg2.res) {
        const trees = msg2.res.filter(r => r.kind === 'tree');
        const rocks = msg2.res.filter(r => r.kind === 'rock');

        console.log(`📊 Total resources: ${msg2.res.length}`);
        console.log(`   🌲 Trees: ${trees.length}`);
        console.log(`   ⛏️  Rocks: ${rocks.length}\n`);

        if (trees.length > 0) {
          console.log('🌲 TREE TILES:');
          console.log('━'.repeat(50));
          trees.forEach((r, i) => {
            const key = r.keys?.[0] || '?';
            console.log(`  ${i+1}. [${key}]`);
          });

          console.log('\n📋 Copy ini ke config.js WORLD_TREE_TILES:');
          console.log('━'.repeat(50));
          const treeTiles = trees.map(r => {
            const key = r.keys?.[0];
            if (!key) return null;
            const [col, row] = key.split(',').map(Number);
            return `  { col: ${col}, row: ${row} },`;
          }).filter(Boolean);
          treeTiles.forEach(t => console.log(t));
        } else {
          console.log('⚠️  Gak ada tree tiles di snap!');
        }

        ws2.close();
        ws.close();
        process.exit(0);
      }
    });

    ws2.on('error', e => { console.log('❌', e.message); process.exit(1); });
  }
});

ws.on('error', e => { console.log('❌', e.message); process.exit(1); });
setTimeout(() => { console.log('❌ Timeout'); process.exit(1); }, 30000);
