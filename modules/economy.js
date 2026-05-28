// ================================================
// ECONOMY MODULE — Merchant Trade + Marketplace Sell
// Merchant: 1500w+800s+400c+25fish → 1 gold
// Marketplace: auto-list item kalau stok > threshold
// ================================================

const { apiFetch } = require('../auth');
const log          = require('../logger');
const cfg          = require('../config');
const { addProgress } = require('./daily');

let inventory = {}; // di-update dari backpack sync
const ws = require('./ws');

// Update inventory dari server backpack sync
ws.on('backpack_sync', (msg) => {
  if (msg.backpack) inventory = msg.backpack;
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Helper: ambil jumlah item di inventory
function getQty(kind) {
  const slot = Object.values(inventory).find(s => s.kind === kind);
  return slot ? (slot.qty || 1) : 0;
}

// Fetch inventory dari API
async function syncInventory() {
  try {
    const res = await apiFetch('/api/auth/me');
    if (res.ok && res.backpack) {
      inventory = res.backpack;
      return true;
    }
  } catch (e) { log.error('ECO', e.message); }
  return false;
}

// ---- AUTO MERCHANT TRADE ----
async function runMerchantTrade() {
  await syncInventory();

  const thr = cfg.MERCHANT_THRESHOLD;
  const wood  = getQty('wood');
  const stone = getQty('stone');
  const coal  = getQty('coal');
  const fish  = getQty('cooked_fish_meat');

  log.info('MERCHANT', `Stok — wood:${wood} stone:${stone} coal:${coal} fish:${fish}`);

  if (wood < thr.wood || stone < thr.stone || coal < thr.coal || fish < thr.cooked_fish_meat) {
    log.warn('MERCHANT', 'Stok belum cukup buat trade ke merchant');
    return false;
  }

  log.info('MERCHANT', 'Trade ke merchant! (1500w+800s+400c+25fish → 1 gold)');
  try {
    const res = await apiFetch('/api/auth/merchant-trade-gold', {
      method: 'POST',
      body:   JSON.stringify({}),
    });
    if (res.ok) {
      log.earn('MERCHANT', '1x Gold dapet dari merchant trade!');
      addProgress('gold', 1);
      await syncInventory();
      return true;
    } else {
      log.warn('MERCHANT', `Trade gagal: ${res.error || JSON.stringify(res)}`);
    }
  } catch (e) {
    log.error('MERCHANT', e.message);
  }
  return false;
}

// ---- AUTO MARKETPLACE SELL ----
// Cek listing yang udah ada biar ga duplikat
async function getMyListings() {
  try {
    const res = await apiFetch('/api/marketplace/listings?seller=me');
    return (res.listings || []);
  } catch (e) { return []; }
}

async function sellItem(kind, qty, priceUsd, currency = 'gold') {
  try {
    const res = await apiFetch('/api/marketplace/sell', {
      method: 'POST',
      body: JSON.stringify({ kind, qty, priceUsd, currency }),
    });
    if (res.ok) {
      log.sell(`Listed ${qty}x ${kind} @ $${priceUsd} (${currency})`);
      return true;
    } else {
      log.warn('SELL', `List gagal: ${res.error || JSON.stringify(res)}`);
    }
  } catch (e) {
    log.error('SELL', e.message);
  }
  return false;
}

async function runAutoSell() {
  await syncInventory();

  const myListings = await getMyListings();
  const listedKinds = new Set(myListings.map(l => l.kind));

  const SELL_BATCHES = [
    { kind: 'gold',            qty: 1,   minQty: 1,   unit: 1   },
    { kind: 'mount_whale_gold',qty: 1,   minQty: 1,   unit: 1   },
    { kind: 'mount_whale',     qty: 1,   minQty: 1,   unit: 1   },
    { kind: 'mount_dragon',    qty: 1,   minQty: 1,   unit: 1   },
    { kind: 'wood',            qty: 100, minQty: 500, unit: 100 },
    { kind: 'stone',           qty: 100, minQty: 300, unit: 100 },
    { kind: 'coal',            qty: 100, minQty: 150, unit: 100 },
    { kind: 'fish',            qty: 25,  minQty: 50,  unit: 25  },
  ];

  for (const batch of SELL_BATCHES) {
    const { kind, qty, minQty, unit } = batch;
    const ownedQty = getQty(kind);

    if (ownedQty < minQty) continue;
    if (listedKinds.has(kind)) {
      log.sell(`${kind} udah ada listing-nya, skip`);
      continue;
    }

    const priceUsd = cfg.SELL_PRICES[kind] || 1.0;
    // Untuk items rare (mounts, gold), selalu jual 1 per listing
    // Untuk resources, jual per batch unit
    const sellQty = (kind === 'gold' || kind.includes('mount')) ? 1 : unit;
    const sellPrice = kind.includes('mount') || kind === 'gold'
      ? priceUsd
      : (priceUsd * sellQty / unit);

    // Mounts dan gold jual pake token ($KINS), resources pake gold (in-game)
    const currency = (kind.includes('mount') || kind === 'gold') ? 'token' : 'gold';

    await sellItem(kind, sellQty, sellPrice, currency);
    await sleep(500);
  }
}

// Loop utama ekonomi
async function runEconomyLoop() {
  log.info('ECO', 'Economy loop start...');
  while (true) {
    try {
      // Coba merchant trade dulu
      if (cfg.FEATURES.AUTO_MERCHANT) {
        await runMerchantTrade();
      }
      // Lalu auto sell
      if (cfg.FEATURES.AUTO_SELL) {
        await runAutoSell();
      }
    } catch (e) {
      log.error('ECO', e.message);
    }
    await sleep(cfg.TIMING.SELL_CHECK);
  }
}

module.exports = { runEconomyLoop, runMerchantTrade, runAutoSell, syncInventory };
