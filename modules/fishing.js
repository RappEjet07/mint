// ================================================
// FISHING MODULE — Auto-fishing loop
// Flow: cast → wait (random 8-15s) → strike → reel
// POST /api/auth/grant-fish-xp setelah berhasil
// ================================================

const { apiFetch } = require('../auth');
const ws           = require('./ws');
const log          = require('../logger');
const cfg          = require('../config');
const { addProgress } = require('./daily');

let fishing   = false;
let fishCount = 0;
let rareDrop  = [];

// Simulated inventory dari backpack_sync
let inventory = {};

function updateInventory(msg) {
  if (msg.backpack) {
    inventory = msg.backpack;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function grantFishXp() {
  try {
    const res = await fetch('https://kintara.gg/api/auth/grant-fish-xp', {
      method: 'POST',
      headers: { 'Cookie': require('../auth').cookies || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { log.warn('FISH', `Server error (${res.status}), skip`); return {}; }
    if (data.ok) {
      fishCount++;
      const drops = data.drops || [];
      if (drops.length > 0) {
        for (const drop of drops) {
          log.fish(`🎉 DROP: ${drop.kind} x${drop.qty}!`);
          if (drop.kind === 'mount_whale_gold') {
            log.earn('FISH', '🐋 GOLD WHALE MOUNT! JACKPOT CUY!');
            rareDrop.push({ kind: drop.kind, time: new Date().toISOString() });
          } else if (drop.kind === 'mount_whale') {
            log.earn('FISH', '🐋 Blue Whale Mount dapet!');
            rareDrop.push({ kind: drop.kind, time: new Date().toISOString() });
          }
          addProgress('fish', drop.qty || 1);
        }
      } else {
        addProgress('fish', 1);
      }
      log.fish(`Cast #${fishCount} sukses! Total: ${fishCount} ikan`);
    } else if (data.error === 'rate_limited') {
      log.warn('FISH', 'Rate limited — tunggu lebih lama...');
      await sleep(5000);
    } else {
      log.warn('FISH', `grant-fish-xp: ${JSON.stringify(data)}`);
    }
    return data;
  } catch (e) {
    log.error('FISH', e.message);
    return {};
  }
}

async function runFishing() {
  if (fishing) return;
  fishing = true;

  // Masuk ke realm pond
  ws.setRealm('pond', 20, 0, 20);
  log.fish('Masuk realm Pond...');
  await sleep(2000);

  log.fish('Mulai auto-fishing loop...');

  while (fishing) {
    try {
      // Phase 0: Cast / tunggu ikan makan
      const waitMs = rand(cfg.TIMING.FISH_WAIT_MIN, cfg.TIMING.FISH_WAIT_MAX);
      log.fish(`Casting... tunggu ${(waitMs/1000).toFixed(1)}s`);

      // Kirim action 'fish' phase 0 (cast) tiap 2 detik selama nunggu
      const castEnd = Date.now() + waitMs;
      while (Date.now() < castEnd) {
        ws.sendFishAction(0);
        await sleep(2000);
      }

      // Phase 1: Strike!
      log.fish('⚡ STRIKE!');
      ws.sendFishAction(1);
      await sleep(800);

      // Phase 2: Reel
      log.fish('🔄 Reeling...');
      ws.sendFishAction(2);
      await sleep(1500);

      // Minta XP dari server
      await grantFishXp();

      // Jeda antar cast (biar natural + bypass rate limit)
      await sleep(rand(2000, 4000));

    } catch (e) {
      log.error('FISH', e.message);
      await sleep(5000);
    }
  }
}

function stopFishing() {
  fishing = false;
  log.fish('Fishing dihentikan.');
}

function getFishStats() {
  return { count: fishCount, rareDrops: rareDrop };
}

// Listen backpack sync buat track inventory
ws.on('backpack_sync', updateInventory);

module.exports = { runFishing, stopFishing, getFishStats };
