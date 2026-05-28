// Debug script: sniff valid mine tiles dari res_evt
require('dotenv').config();
const { getSession, getCookies } = require('./auth');
const WebSocket = require('ws');
const log = require('./logger');

const mineTiles = new Set();
const worldTiles = new Set();

async function sniff() {
  console.log('Authenticating...');
  await getSession();
  const cookies = getCookies();
  console.log('Auth done. Connecting to mine realm WS...');

  // Connect ke WS
  const ws = new WebSocket('wss://kintara.gg/ws/presence/s1', {
    headers: {
      'Cookie': cookies,
      'Origin': 'https://kintara.gg',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
    }
  });

  ws.on('open', () => {
    console.log('Connected!');
    // Pindah ke mine realm
    setTimeout(() => {
      console.log('Switching to MINE realm...');
      const pos = JSON.stringify({ t: 'pos', region: 'mine', x: 14, y: 0, z: 10, ry: 0, mov: 0, outfit: 0, le: 1, ts: Date.now() });
      ws.send(pos);

      // Kirim pos berkali2 biar server tau kita di mine
      const presInt = setInterval(() => {
        ws.send(JSON.stringify({ t: 'pos', region: 'mine', x: 14, y: 0, z: 10, ry: 0, mov: 0, outfit: 0, le: 1, ts: Date.now() }));
      }, 200);

      // Log semua res_evt di mine selama 30 detik
      setTimeout(() => {
        clearInterval(presInt);
        console.log('\n=== MINE TILES DARI SERVER ===');
        const sorted = [...mineTiles].sort();
        sorted.forEach(t => console.log('MINE TILE:', t));
        console.log('\nTotal mine tiles terdeteksi:', sorted.length);
        
        // Juga coba kirim harv ke tile2 yang valid dari server buat test
        if (sorted.length > 0) {
          const firstTile = sorted[0].split(',');
          const col = parseInt(firstTile[0]);
          const row = parseInt(firstTile[1]);
          console.log(`\nCoba kirim harv ke tile pertama [${col},${row}]...`);
          ws.send(JSON.stringify({
            t: 'harv',
            region: 'mine',
            k: 'rock',
            keys: [`${col},${row}`],
            hasCoal: false,
            ts: Date.now()
          }));
          // Tunggu response 5 detik
          setTimeout(() => {
            ws.close();
            process.exit(0);
          }, 5000);
        } else {
          console.log('Ga ada tile yang terdeteksi dari mine realm!');
          ws.close();
          process.exit(0);
        }
      }, 30000);

    }, 2000);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.t === 'region_ack') {
        console.log('[ACK] Region:', msg.region);
      }
      if (msg.t === 'res_evt' && msg.region === 'mine') {
        msg.keys.forEach(k => mineTiles.add(k));
        console.log('[MINE RES_EVT]', msg.evt, msg.kind, msg.keys.join(','), 'loot:', msg.loot || '-');
      }
      if (msg.t === 'harv_grant') {
        console.log('[HARV GRANT ✅]', JSON.stringify(msg));
      }
      if (msg.t === 'harv_grant_failed') {
        console.log('[HARV FAILED ❌]', JSON.stringify(msg));
      }
    } catch(e) {}
  });

  ws.on('error', (e) => console.error('WS Error:', e.message));
  ws.on('close', (code) => console.log('WS closed:', code));
}

sniff().catch(console.error);
