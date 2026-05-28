// ================================================
// HARVEST MODULE — Auto Mining + Auto Woodcutting
// Protocol (FIXED based on live diagnostic):
//   1. Move to tile
//   2. Send 'pos' with act+eq (mine/chop)
//   3. Send 'harv_hit' repeatedly — server tracks wear
//   4. When wear reaches max → resource clears (res_evt clear)
//   5. Send 'harv' AFTER clear to claim loot
//   6. Server responds with harv_grant (loot) or backpack_sync
// Formula: x = col - 22.5, z = row - 42.5
// ================================================

const ws  = require('./ws');
const log = require('../logger');
const cfg = require('../config');
const { addProgress } = require('./daily');

let miningActive  = false;
let woodcutActive = false;
let mineCount     = 0;
let woodCount     = 0;

// Live tile data dari WS snap
let liveTreeTiles = [];
let liveRockTiles = [];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Konversi tile coords ke WS world coords
function tileToWorld(col, row) {
  return { x: col - 22.5, z: row - 42.5 };
}

// Group tiles into batches — NEARBY only, allow single tiles
function groupTiles(tiles, maxDist = 3) {
  const groups = [];
  const used = new Set();
  
  for (let i = 0; i < tiles.length; i++) {
    if (used.has(i)) continue;
    const group = [tiles[i]];
    used.add(i);
    
    // Find nearby tiles ONLY (strict distance check)
    for (let j = i + 1; j < tiles.length && group.length < 5; j++) {
      if (used.has(j)) continue;
      const dist = Math.abs(tiles[i].col - tiles[j].col) + Math.abs(tiles[i].row - tiles[j].row);
      if (dist <= maxDist) {
        group.push(tiles[j]);
        used.add(j);
      }
    }
    
    // Allow groups of ANY size (1, 2, 3...) — don't force merge distant tiles
    groups.push(group);
  }
  return groups;
}

// Swing periods (ms) — natural speed, avoid detection
const MINE_SWING_MS = 750;  // was 550 — lebih natural
const CHOP_SWING_MS = 700;  // was 500 — lebih natural

let lastSnapTime = 0;
let snapReceived = false;

// Subscribe ke snap event untuk update live tiles
// CRITICAL: Only update if snap has actual res data (subsequent snaps have res=[])
ws.on('snap', (data) => {
  if (data && data.res && data.res.length > 0) {
    liveTreeTiles = data.res.filter(r => r.kind === 'tree' && r.keys?.length > 0);
    liveRockTiles = data.res.filter(r => r.kind === 'rock' && r.keys?.length > 0);
    lastSnapTime = Date.now();
    snapReceived = true;
  }
});

// Request fresh snap by re-entering realm (triggers server snap)
function requestSnap() {
  ws.send({ t: 'enter', region: 'world' });
}

// Wait for fresh snap (max 5s)
async function waitForSnap(timeout = 5000) {
  if (snapReceived && Date.now() - lastSnapTime < 60000) return true; // fresh enough
  requestSnap();
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (snapReceived && Date.now() - lastSnapTime > start - 100) return true;
    await sleep(200);
  }
  return snapReceived;
}

// Wear tracking — listen for res_evt wear/clear
let wearTracker = {};  // key → { h, hMax, done }
ws.on('res_evt', (data) => {
  if (!data.keys) return;
  const key = data.keys.sort().join('|');
  if (data.evt === 'wear') {
    wearTracker[key] = { h: data.h, hMax: data.hm, done: false };
  } else if (data.evt === 'clear') {
    wearTracker[key] = { h: data.hm || wearTracker[key]?.hMax || 6, hMax: data.hm || wearTracker[key]?.hMax || 6, done: true };
  }
});

// Track last harv_grant data dari server
let lastHarvGrant = null;
ws.on('harv_result', (data) => {
  lastHarvGrant = data;
});

function resetWearTracker() {
  lastHarvGrant = null;
  // DON'T clear wearTracker — biar inget tile yang udah di-clear sebelumnya
  // wearTracker = {};  ← REMOVED: ini bikin bot lupa tile udah habis
}

function isResourceCleared(keys) {
  const key = keys.slice().sort().join('|');
  return wearTracker[key]?.done === true;
}

function getWear(keys) {
  const key = keys.slice().sort().join('|');
  return wearTracker[key] || { h: 0, hMax: 6, done: false };
}

// ---- HARVEST LOGIC (FIXED) ----
// Protocol: harv_hit repeatedly until clear, THEN harv to claim loot
async function harvestResource(kind, keys, hasCoal, swingMs) {
  const region = 'world';
  const keysStr = keys.map(k => typeof k === 'string' ? k : `${k.col || k[0]},${k.row || k[1]}`);
  const keysSorted = keysStr.slice().sort();

  resetWearTracker();

  // Tell presence timer to include act+eq during harvest
  const actMap = { rock: 'mine', tree: 'chop' };
  const eqMap = { rock: 'tool_pickaxe', tree: 'tool_axe' };
  const act = actMap[kind] || 'mine';
  const eq = eqMap[kind] || 'tool_pickaxe';
  ws.setHarvesting(true, act, eq);

  // Send 'harv' FIRST to initiate interaction (server needs this to start tracking)
  ws.send({ t: 'harv', region, k: kind, keys: keysStr, hasCoal: !!hasCoal });
  await sleep(200); // was 300 — minimal gap before first hit

  // Check if resource already cleared (wear 6/6 from previous player)
  const initialWear = getWear(keysStr);
  if (initialWear.done || initialWear.h >= initialWear.hMax) {
    log.info(kind.toUpperCase(), `Resource udah habis (wear ${initialWear.h}/${initialWear.hMax}), skip...`);
    ws.setHarvesting(false);
    return { ok: true, hits: 0, qty: 0, reason: 'already_cleared' };
  }

  const maxHits = 25; // safety limit (increased from 15 — server sometimes skips hits)
  let cleared = false;

  // Phase 1: Send harv_hit repeatedly until resource clears
  let lastWearH = -1;
  let stuckCount = 0;

  for (let i = 0; i < maxHits; i++) {
    // Send harv_hit THEN pos+act+eq immediately (server needs both tightly coupled!)
    const pos = ws._getPos();
    ws.send({ t: 'harv_hit', region, k: kind, keys: keysStr, hasCoal: !!hasCoal });
    ws.send({ t: 'pos', region, x: pos.x, y: pos.y, z: pos.z, ry: 0, mov: 0, outfit: 0, le: 1, act, eq, ts: Date.now() });

    // Wait for swing animation
    await sleep(swingMs + rand(-50, 100));

    // Check if resource cleared
    const wear = getWear(keysStr);
    if (wear.done || isResourceCleared(keysStr)) {
      log.info(kind.toUpperCase(), `Resource cleared after ${i + 1} hits! (wear: ${wear.h}/${wear.hMax})`);
      cleared = true;
      break;
    }

    // Detect wear stuck — re-send harv to re-init server tracking
    if (wear.h === lastWearH) {
      stuckCount++;
      // Kalau wear masih 0 setelah 3 hits = tile gak exist/belum respawn, skip
      if (wear.h === 0 && stuckCount >= 3) {
        log.info(kind.toUpperCase(), `Tile gak respond (wear 0 after 3 hits), skip...`);
        ws.setHarvesting(false);
        return { ok: false, reason: 'no_response' };
      }
      if (stuckCount >= 3) {
        log.info(kind.toUpperCase(), `Wear stuck at ${wear.h}/${wear.hMax}, re-init harv...`);
        ws.send({ t: 'harv', region, k: kind, keys: keysStr, hasCoal: !!hasCoal });
        await sleep(400);
        stuckCount = 0;
      }
    } else {
      stuckCount = 0;
      lastWearH = wear.h;
    }

    // Log progress occasionally
    if (wear.h > 0 && i % 2 === 0) {
      log.info(kind.toUpperCase(), `Hit ${i + 1}: wear ${wear.h}/${wear.hMax}`);
    }
  }

  if (!cleared) {
    // Final check
    await sleep(500);
    if (isResourceCleared(keysStr)) {
      cleared = true;
    }
  }

  if (!cleared) {
    ws.setHarvesting(false);
    return { ok: false, reason: 'timeout' };
  }

  // Phase 2: Send 'harv' to claim loot AFTER clearing
  await sleep(rand(200, 400));
  ws.send({ t: 'harv', region, k: kind, keys: keysStr, hasCoal: !!hasCoal });

  // Wait for harv_grant (server returns actual quantity)
  let grantData = null;
  for (let w = 0; w < 20; w++) { // max 2s wait
    await sleep(100);
    if (lastHarvGrant) {
      grantData = lastHarvGrant;
      break;
    }
  }
  ws.setHarvesting(false);

  // Extract quantity from grant (server sends qty or n field)
  const qty = grantData?.qty || grantData?.n || grantData?.count || 1;
  const itemType = grantData?.item || grantData?.t || null;

  return { ok: true, hits: 'clear', grant: true, qty, item: itemType, grantData };
}

// ---- AUTO MINING (SWEEP MODE) ----
async function runMining() {
  if (miningActive) return;
  miningActive = true;

  log.mine('Masuk realm World (rocks ada di sini)...');
  ws.setRealm('world');
  await sleep(2000);
  
  // Wait for player to be registered in snap before harvesting
  if (!ws.isPlayerRegistered()) {
    log.mine('⏳ Waiting for player registration...');
    for (let w = 0; w < 15 && miningActive && !ws.isPlayerRegistered(); w++) {
      await sleep(1000);
    }
    if (ws.isPlayerRegistered()) log.mine('✅ Player registered!');
    else log.mine('⚠️ Player not registered, harvest may fail...');
  }
  
  log.mine('⛏️ SWEEP MODE — habisin semua rock satu-satu, baru tunggu respawn...');

  while (miningActive) {
    try {
      if (!ws.isConnected()) {
        log.mine('⚠️ WS putus, tunggu reconnect...');
        const ok = await ws.waitForConnection(35000);
        if (!ok) { log.mine('❌ Reconnect timeout, skip 10s...'); await sleep(10000); continue; }
        log.mine('✅ WS reconnect! Lanjut mining...');
        await sleep(1000);
      }

      // Get fresh snap before each sweep
      const gotSnapM = await waitForSnap(5000);
      if (!gotSnapM) log.mine('⚠️ No snap received, using stale data...');

      // Prefer live tiles from snap, fallback to config
      const liveRocks = liveRockTiles.map(r => {
        const key = r.keys?.[0]; if (!key) return null;
        const [col, row] = key.split(',').map(Number);
        return { col, row, hasCoal: r.keys.length > 1 };
      }).filter(Boolean);
      const tiles = liveRocks.length > 0 ? liveRocks : cfg.MINE_TILES.map(t => ({ col: t.col, row: t.row, hasCoal: t.hasCoal || false }));
      if (liveRocks.length > 0) log.mine(`📡 Using ${liveRocks.length} LIVE rock tiles from snap`);
      else log.mine(`⚠️ No snap data, using ${cfg.MINE_TILES.length} config tiles`);
      const groups = groupTiles(tiles, 5);
      // Shuffle groups
      for (let i = groups.length - 1; i > 0; i--) { const j = rand(0, i); [groups[i], groups[j]] = [groups[j], groups[i]]; }
      
      // Reset wearTracker di awal sweep baru (biar inget tile yang udah di-clear di sweep ini)
      wearTracker = {};

      let clearedCount = 0;
      let failedCount = 0;

      for (const group of groups) {
        if (!miningActive) break;

        // Move to center of group
        const centerCol = Math.round(group.reduce((s, t) => s + t.col, 0) / group.length);
        const centerRow = Math.round(group.reduce((s, t) => s + t.row, 0) / group.length);
        const { x, z } = tileToWorld(centerCol, centerRow);
        const hasCoal = group.some(t => t.hasCoal);
        const groupKeys = group.map(t => `${t.col},${t.row}`);

        log.mine(`→ Group [${groupKeys.join(' | ')}] (${group.length} tiles)`);
        await ws.moveTo(x, z);
        await sleep(rand(500, 1200)); // natural delay after movement

        ws.send({ t: 'pos', region: 'world', x, y: 0.25, z, ry: 0, mov: 0, outfit: 0, le: 1,
          act: 'mine', eq: 'tool_pickaxe', ts: Date.now() });
        await sleep(200);

        // Harvest entire group at once
        const result = await harvestResource('rock', group.map(t => ({ col: t.col, row: t.row })), hasCoal, MINE_SWING_MS);

        if (result.ok && result.reason !== 'already_cleared') {
          const qty = result.qty || 1;
          mineCount += group.length;
          clearedCount += group.length;
          const item = result.item || (hasCoal ? 'coal' : 'stone');
          addProgress(item, qty * group.length);
          log.mine(`HARVESTED ${item} x${qty * group.length} from ${group.length} tiles`);
        } else if (result.reason === 'already_cleared') {
          log.mine(`SKIP group (already cleared)`);
        } else {
          failedCount += group.length;
          log.mine(`FAILED group: ${result.reason}`);
        }

        await sleep(rand(1200, 2500)); // jeda antar tile lebih natural
      }

      log.mine(`SWEEP DONE — ${clearedCount} cleared, ${failedCount} failed.`);
      
      // Random break 5-15 menit (avoid detection pattern)
      const breakTime = rand(300, 900);
      log.mine(`Break ${Math.round(breakTime/60)} menit...`);
      for (let w = 0; w < breakTime && miningActive; w++) {
        await sleep(1000);
      }

    } catch (e) {
      log.error('MINE', e.message);
      await sleep(5000);
    }
  }
}

function stopMining() {
  miningActive = false;
  log.mine('Mining dihentikan.');
}

// ---- AUTO WOODCUTTING (SWEEP MODE) ----
async function runWoodcutting() {
  if (woodcutActive) return;
  woodcutActive = true;

  log.wood('Masuk realm World (trees)...');
  ws.setRealm('world');
  await sleep(2000);
  
  // Wait for player to be registered in snap before harvesting
  if (!ws.isPlayerRegistered()) {
    log.wood('⏳ Waiting for player registration...');
    for (let w = 0; w < 15 && woodcutActive && !ws.isPlayerRegistered(); w++) {
      await sleep(1000);
    }
    if (ws.isPlayerRegistered()) log.wood('✅ Player registered!');
    else log.wood('⚠️ Player not registered, harvest may fail...');
  }
  
  log.wood('🌲 SWEEP MODE — habisin semua tree satu-satu, baru tunggu respawn...');

  while (woodcutActive) {
    try {
      if (!ws.isConnected()) {
        log.wood('⚠️ WS putus, tunggu reconnect...');
        const ok = await ws.waitForConnection(35000);
        if (!ok) { log.wood('❌ Reconnect timeout, skip 10s...'); await sleep(10000); continue; }
        log.wood('✅ WS reconnect! Lanjut woodcut...');
        await sleep(1000);
      }

      // Get fresh snap before each sweep
      const gotSnapW = await waitForSnap(5000);
      if (!gotSnapW) log.wood('⚠️ No snap received, using stale data...');

      // Prefer live tiles from snap, fallback to config
      const liveTrees = liveTreeTiles.map(r => {
        const key = r.keys?.[0]; if (!key) return null;
        const [col, row] = key.split(',').map(Number);
        return { col, row };
      }).filter(Boolean);
      const tiles = liveTrees.length > 0 ? liveTrees : cfg.WORLD_TREE_TILES.map(t => ({ col: t.col, row: t.row }));
      if (liveTrees.length > 0) log.wood(`📡 Using ${liveTrees.length} LIVE tree tiles from snap`);
      else log.wood(`⚠️ No snap data, using ${cfg.WORLD_TREE_TILES.length} config tiles`);
      const groups = groupTiles(tiles, 3);
      for (let i = groups.length - 1; i > 0; i--) { const j = rand(0, i); [groups[i], groups[j]] = [groups[j], groups[i]]; }
      
      // Reset wearTracker di awal sweep baru
      wearTracker = {};

      let clearedCount = 0;
      let failedCount = 0;

      for (const group of groups) {
        if (!woodcutActive) break;

        const centerCol = Math.round(group.reduce((s, t) => s + t.col, 0) / group.length);
        const centerRow = Math.round(group.reduce((s, t) => s + t.row, 0) / group.length);
        const { x, z } = tileToWorld(centerCol, centerRow);
        const groupKeys = group.map(t => `${t.col},${t.row}`);

        log.wood(`→ Group [${groupKeys.join(' | ')}] (${group.length} tiles)`);
        await ws.moveTo(x, z);
        await sleep(rand(500, 1200)); // natural delay after movement

        ws.send({ t: 'pos', region: 'world', x, y: 0.25, z, ry: 0, mov: 0, outfit: 0, le: 1,
          act: 'chop', eq: 'tool_axe', ts: Date.now() });
        await sleep(200);

        const result = await harvestResource('tree', group.map(t => ({ col: t.col, row: t.row })), false, CHOP_SWING_MS);

        if (result.ok && result.reason !== 'already_cleared') {
          const qty = result.qty || 1;
          woodCount += group.length;
          clearedCount += group.length;
          addProgress('wood', qty * group.length);
          log.wood(`HARVESTED wood x${qty * group.length} from ${group.length} tiles`);
        } else if (result.reason === 'already_cleared') {
          log.wood(`SKIP group (already cleared)`);
        } else {
          failedCount += group.length;
          log.wood(`FAILED group: ${result.reason}`);
        }

        await sleep(rand(1200, 2500));
      }

      log.wood(`SWEEP DONE — ${clearedCount} cleared, ${failedCount} failed.`);
      
      // Random break 5-15 menit
      const breakTime = rand(300, 900);
      log.wood(`Break ${Math.round(breakTime/60)} menit...`);
      for (let w = 0; w < breakTime && woodcutActive; w++) {
        await sleep(1000);
      }

    } catch (e) {
      log.error('WOOD', e.message);
      await sleep(5000);
    }
  }
}

function stopWoodcutting() {
  woodcutActive = false;
  log.wood('Woodcutting dihentikan.');
}

function getHarvestStats() {
  return { mineCount, woodCount };
}

module.exports = { runMining, stopMining, runWoodcutting, stopWoodcutting, getHarvestStats };
