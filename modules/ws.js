// ================================================
// WEBSOCKET MODULE — Handle Presence & Actions
// ================================================

const WebSocket = require('ws');
const log       = require('../logger');
const cfg       = require('../config');
const { getSession, apiFetch } = require('../auth');

let ws        = null;
let connected = false;
let region    = 'world';
let posX      = 50, posY = 0.25, posZ = 50, posRY = 0;
let localPlayerId = null;  // Set during connect from auth/me
let seq       = 0;
let playerInWorld = false;  // True when server confirms player in snap

// Callbacks yang bisa di-subscribe modul lain
const handlers = {
  snap:          [],
  backpack_sync: [],
  skill_xp:      [],
  dq_cfg:        [],
  harv_result:   [],
  fish_result:   [],
  wm_ev:         [],
  wild_bg:       [],
  res_evt:       [],
  any:           [],
};

function on(event, fn) {
  if (handlers[event]) handlers[event].push(fn);
}

function emit(event, data) {
  if (handlers[event]) handlers[event].forEach(fn => { try { fn(data); } catch(e) {} });
  handlers.any.forEach(fn => { try { fn(event, data); } catch(e) {} });
}

async function connect(server = cfg.SERVER) {
  let cookies;
  try {
    cookies = await getSession();
  } catch (e) {
    log.warn('WS', `Session expired, refreshing...`);
    const { clearSession } = require('../auth');
    clearSession();
    cookies = await getSession();
  }

  // Fetch player ID from auth/me
  if (!localPlayerId) {
    try {
      const me = await apiFetch('/api/auth/me');
      if (me.player?.id) {
        localPlayerId = me.player.id;
        log.info('WS', `Player ID: ${localPlayerId}`);
      }
    } catch (e) {
      log.warn('WS', `Gagal fetch player ID: ${e.message}`);
    }
  }

  // STEP 1: Queue WebSocket — minta slot di server
  const queueUrl = `wss://kintara.gg/ws/queue/${server}`;
  log.info('WS', `Queue: ${queueUrl}...`);

  await new Promise((resolve, reject) => {
    const qws = new WebSocket(queueUrl, {
      headers: {
        'Cookie':     cookies,
        'Origin':     'https://kintara.gg',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      }
    });

    qws.on('open', () => log.info('WS', 'Queue WS connected, waiting for slot...'));

    qws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.t === 'queue_ready') {
          log.success('WS', `Queue ready! Slot reserved di ${server}`);
          qws.close();
          resolve();
        } else if (msg.t === 'queue_pos') {
          log.info('WS', `Queue pos: ${msg.pos} (ahead: ${msg.ahead})`);
        } else if (msg.t === 'queue_error') {
          log.error('WS', `Queue error: ${msg.error || 'unknown'}`);
          qws.close();
          reject(new Error(msg.error || 'queue_error'));
        }
      } catch(e) {}
    });

    qws.on('error', e => { log.error('WS', `Queue error: ${e.message}`); qws.close(); reject(e); });
    qws.on('close', () => {});

    // Timeout 60s (was 30s — sometimes queue_ready takes longer)
    setTimeout(() => { qws.close(); reject(new Error('Queue timeout 60s')); }, 60000);
  });

  // STEP 2: Presence WebSocket — masuk game world
  const wsUrl = `wss://kintara.gg/ws/presence/${server}`;
  log.info('WS', `Connecting ke ${wsUrl}...`);

  if (ws) ws.close();
  ws = new WebSocket(wsUrl, {
    headers: {
      'Cookie':     cookies,
      'Origin':     'https://kintara.gg',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  });

  // AWAIT the connection to be fully open before returning
  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      connected = true;
      log.success('WS', `Connected ke ${server}!`);
      // CRITICAL: Register player in the world — server ignores harvest without this!
      send({ t: 'enter', region: region });
      // Send pos immediately to register player in snap
      send({ t: 'pos', region, x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1 });
      log.info('WS', `Sent enter + pos for ${region}`);
      startPresence();
      resolve();
    });

    ws.on('error', e => {
      log.error('WS', e.message);
      reject(e);
    });

    setTimeout(() => reject(new Error('Presence WS timeout 15s')), 15000);
  });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      handleServerMsg(msg);
    } catch (e) { /* skip malformed */ }
  });

  ws.on('close', (code) => {
    connected = false;
    log.warn('WS', `Disconnected (${code}). Reconnect dalam 5s...`);
    if (presenceInterval) clearInterval(presenceInterval);

    // Reconnect with retry (up to 5 attempts, exponential backoff)
    (async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const delay = attempt === 1 ? 5000 : Math.min(10000 * attempt, 30000);
        log.info('WS', `Reconnect attempt ${attempt}/5 dalam ${delay/1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        try {
          await connect(server);
          log.success('WS', `Reconnect sukses! (attempt ${attempt})`);
          return;
        } catch(e) {
          log.error('WS', `Reconnect attempt ${attempt} gagal: ${e.message}`);
        }
      }
      log.error('WS', '❌ Semua reconnect gagal! Bot perlu restart manual.');
    })();
  });

  ws.on('error', e => log.error('WS', e.message));
}

function handleServerMsg(msg) {
  const t = msg.t;

  switch (t) {
    case 'snap':
      // Find our player in players array (msg.me doesn't exist in snap)
      if (msg.players && localPlayerId) {
        const me = msg.players.find(p => p.id === localPlayerId);
        if (me) {
          playerInWorld = true;
          if (me.x != null) posX = me.x;
          if (me.y != null) posY = me.y;
          if (me.z != null) posZ = me.z;
        }
      }
      emit('snap', msg);
      break;

    case 'backpack_sync':
      log.info('WS', `Backpack sync: ${msg.reason || ''}`);
      emit('backpack_sync', msg);
      break;

    case 'skill_xp':
      log.info('WS', `XP: ${JSON.stringify(msg.skills || {})}`);
      emit('skill_xp', msg);
      break;

    case 'dq_cfg':
      emit('dq_cfg', msg);
      break;

    case 'harv_grant':
      log.success('WS', `Harvest grant: ${JSON.stringify(msg)}`);
      emit('harv_result', { ok: true, ...msg });
      break;

    case 'harv_grant_failed':
      log.warn('WS', `Harvest gagal: ${msg.reason || JSON.stringify(msg)}`);
      emit('harv_result', { ok: false, ...msg });
      break;

    case 'wm_ev':
      emit('wm_ev', msg);
      break;

    case 'res_evt':
      emit('res_evt', msg);
      break;

    case 'wild_bg':
      log.info('WS', `Loot bag spawn!`);
      emit('wild_bg', msg);
      break;

    case 'pong':
      break;

    default:
      if (t !== 'arena_lb' && t !== 'online_total') {
        // console.log(`[WS] ${t} → ${JSON.stringify(msg)}`);
      }
      break;
  }
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ ...obj, t: obj.t || obj.type, ts: Date.now() }));
}

// Kirim posisi (presence) ke server secara berkala
let presenceInterval = null;
let isMoving = false; // Guard biar ga tabrakan paket pas moveTo
let isHarvesting = false; // Don't suppress — keep sending pos with act/eq during harvest
let harvestAct = null; // 'chop' or 'mine' — set by harvest module
let harvestEq = null;  // 'tool_axe' or 'tool_pickaxe'

function startPresence() {
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(() => {
    if (isMoving) return; // Skip only during movement (moveTo handles its own pos)
    const msg = {
      t:      'pos',
      region: region,
      x:      posX + (Math.random() - 0.5) * 0.2, // noise tipis
      y:      posY,
      z:      posZ + (Math.random() - 0.5) * 0.2,
      ry:     posRY,
      mov:    0,
      outfit: 0,
      le:     1,
    };
    // Include act+eq during harvest (server needs this to process harv_hit)
    if (isHarvesting && harvestAct) {
      msg.act = harvestAct;
      msg.eq = harvestEq;
    }
    send(msg);
  }, cfg.TIMING.POS_UPDATE);
}

function setHarvesting(v, act, eq) {
  isHarvesting = v;
  if (v) { harvestAct = act || null; harvestEq = eq || null; }
  else { harvestAct = null; harvestEq = null; }
}

// Set current realm & posisi
function setRealm(r, x, y, z) {
  region = r;
  if (x !== undefined) posX = x;
  if (y !== undefined) posY = y;
  if (z !== undefined) posZ = z;
  log.info('WS', `Realm: ${region} @ (${posX.toFixed(1)}, ${posZ.toFixed(1)})`);
  // Register in new realm
  send({ t: 'enter', region: region });
}

// Move ke target coords secara bertahap (simulasi walking)
async function moveTo(targetX, targetZ, stepsPerUnit = 2) {
  const dx = targetX - posX;
  const dz = targetZ - posZ;
  const dist = Math.sqrt(dx*dx + dz*dz);
  if (dist < 0.5) return;

  isMoving = true;
  const steps = Math.ceil(dist * stepsPerUnit);
  for (let i = 1; i <= steps; i++) {
    posX = posX + dx / steps;
    posZ = posZ + dz / steps;
    send({ t: 'pos', region, x: posX, y: posY, z: posZ, ry: 0, mov: 1, outfit: 0, le: 1 });
    await new Promise(r => setTimeout(r, 150));
  }
  posX = targetX;
  posZ = targetZ;
  send({ t: 'pos', region, x: posX, y: posY, z: posZ, ry: 0, mov: 0, outfit: 0, le: 1 });
  isMoving = false;
}

// Kirim harvest event
function sendHarvest(kind, tiles, hasCoal = false) {
  const keys = tiles.map(t => `${t.col},${t.row}`);
  send({
    t:       'harv',
    region:  region,
    k:       kind,
    keys:    keys,
    hasCoal: hasCoal,
  });
}

// Kirim fishing action
function sendFishAction(phase) {
  send({
    t:      'pos',
    region: region,
    x:      posX, y: posY, z: posZ, ry: posRY,
    mov:    0, outfit: 0, le: 1,
    act:    'fish',
    fc:     phase === 0 ? 1 : 0,
    fph:    phase,
  });
}

function ping() {
  seq++;
  send({ t: 'ping', seq, st: Date.now() });
}

function isConnected() { return connected; }

// Tunggu sampai WS reconnect (dipake harvest module pas WS putus)
function waitForConnection(timeoutMs = 30000) {
  if (connected) return Promise.resolve(true);
  return new Promise(resolve => {
    const check = setInterval(() => {
      if (connected) { clearInterval(check); resolve(true); }
    }, 500);
    setTimeout(() => { clearInterval(check); resolve(false); }, timeoutMs);
  });
}

// Helper: get current position (for harvest module)
function _getPos() { return { x: posX, y: posY, z: posZ }; }

function isPlayerRegistered() { return playerInWorld; }

module.exports = { connect, send, on, setRealm, moveTo, sendHarvest, sendFishAction, ping, isConnected, waitForConnection, _getPos, setHarvesting, isPlayerRegistered };
