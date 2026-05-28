// ================================================
// KINTARA PLAYWRIGHT BROWSER BOT
// Automates harvest through real browser (bypasses anti-bot)
// ================================================
require('dotenv').config();
const { chromium } = require('playwright');
const nacl = require('tweetnacl');
const bs58mod = require('bs58');
const bs58 = bs58mod.default || bs58mod;
const fs = require('fs');
const path = require('path');

const PRIV_KEY_B58 = process.env.PHANTOM_PRIVATE_KEY;
let KEYPAIR;
if (PRIV_KEY_B58) {
  const secretBytes = bs58.decode(PRIV_KEY_B58);
  KEYPAIR = secretBytes.length === 64
    ? nacl.sign.keyPair.fromSecretKey(secretBytes)
    : nacl.sign.keyPair.fromSeed(secretBytes);
}

const SESSION_FILE = path.join(__dirname, '.session.json');
const SERVER = 's1';
const log = (tag, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${tag}] ${msg}`);
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ---- BOT BRIDGE CODE (injected into game.js) ----
const BOT_BRIDGE_CODE = `
// === HERMES BOT BRIDGE v1 ===
(function() {
  // Helper: safe iteration over Maps
  function mapToArr(map) {
    const arr = [];
    for (const [key, val] of map) {
      arr.push({ key, ...(val || {}) });
    }
    return arr;
  }

  window.__bot = {
    // Session state
    isReady: () => typeof sessionReady !== 'undefined' && sessionReady,

    // Player state
    getState: () => ({
      gameState: typeof gameState !== 'undefined' ? gameState : null,
      chopping: typeof choppingState !== 'undefined' ? choppingState : null,
      mining: typeof miningState !== 'undefined' ? miningState : null,
      moving: typeof moving !== 'undefined' ? moving : null,
      charCol: typeof charCol !== 'undefined' ? charCol : null,
      charRow: typeof charRow !== 'undefined' ? charRow : null,
      equippedSlot: typeof equippedHotbarSlot !== 'undefined' ? equippedHotbarSlot : -1,
    }),

    getPos: () => {
      if (typeof character === 'undefined') return null;
      return {
        x: character.position.x,
        y: character.position.y,
        z: character.position.z,
      };
    },

    // Resource maps
    getTrees: () => typeof worldTreeMap !== 'undefined' ? mapToArr(worldTreeMap) : [],
    getRocks: () => typeof worldRockMap !== 'undefined' ? mapToArr(worldRockMap) : [],

    // Equipment
    equip: (idx) => {
      if (typeof setEquippedHotbarSlot === 'function') {
        setEquippedHotbarSlot(idx);
        return equippedHotbarSlot;
      }
      return -1;
    },

    // Harvest: initiate chopping
    chopTree: (col, row) => {
      try {
        if (typeof cancelMining === 'function' && miningState !== 'idle') cancelMining();
        if (typeof cancelChopping === 'function' && choppingState !== 'idle') cancelChopping();
        const blocked = typeof getPathfindingBlockedSet === 'function' ? getPathfindingBlockedSet() : new Set();
        const best = typeof bestApproachForTile === 'function'
          ? bestApproachForTile(col, row, blocked, charCol, charRow)
          : null;
        if (!best) {
          // Fallback: just set target directly
          choppingTarget = { col, row };
          choppingState = 'approaching';
          return { ok: true, approach: 'direct', col, row };
        }
        choppingTarget = { col, row };
        choppingState = 'approaching';
        tilePath = findPath(charCol, charRow, best.col, best.row);
        if (!moving) stepToNext();
        return { ok: true, approach: best };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    // Harvest: initiate mining
    mineRock: (col, row) => {
      try {
        if (typeof cancelMining === 'function' && miningState !== 'idle') cancelMining();
        if (typeof cancelChopping === 'function' && choppingState !== 'idle') cancelChopping();
        const blocked = typeof getPathfindingBlockedSet === 'function' ? getPathfindingBlockedSet() : new Set();
        const best = typeof bestApproachForTile === 'function'
          ? bestApproachForTile(col, row, blocked, charCol, charRow)
          : null;
        if (!best) {
          miningTarget = { col, row };
          miningState = 'approaching';
          return { ok: true, approach: 'direct', col, row };
        }
        miningTarget = { col, row };
        miningState = 'approaching';
        tilePath = findPath(charCol, charRow, best.col, best.row);
        if (!moving) stepToNext();
        return { ok: true, approach: best };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    // Cancel current action
    cancelAll: () => {
      try {
        if (typeof cancelMining === 'function') cancelMining();
        if (typeof cancelChopping === 'function') cancelChopping();
      } catch (e) {}
    },

    // Harvest status
    getHarvestStatus: () => ({
      chopping: choppingState,
      target: choppingTarget ? { col: choppingTarget.col, row: choppingTarget.row } : null,
      mining: miningState,
      miningTarget: miningTarget ? { col: miningTarget.col, row: miningTarget.row } : null,
      moving,
    }),

    // Inventory
    getBackpack: () => {
      try {
        if (typeof inventory === 'undefined') return null;
        return {
          wood: inventory.wood | 0,
          stone: inventory.stone | 0,
          coal: inventory.coal | 0,
          gold: inventory.gold | 0,
          fish: inventory.fish | 0,
          cooked_fish_meat: inventory.cooked_fish_meat || inventory.cookedFishMeat || 0,
        };
      } catch (e) { return null; }
    },

    // Online count
    getOnline: () => {
      try {
        const el = document.querySelector('[class*="online"]');
        return el ? el.textContent : 'unknown';
      } catch (e) { return 'unknown'; }
    },

    // Fishing
    getFishPhase: () => typeof pondFishPhase !== 'undefined' ? pondFishPhase : 'unknown',
    getFishBiteAt: () => typeof pondFishBiteAt !== 'undefined' ? pondFishBiteAt : 0,
    getGameTime: () => typeof clock !== 'undefined' ? clock.elapsedTime : 0,

    instantStrikeAndReel: () => {
      try {
        // Just report phase — let game handle fishing naturally
        // Server validates catch based on WS position updates with proper timing
        return { ok: true, phase: pondFishPhase };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    enterPond: () => {
      try {
        if (typeof enterPond === 'function') {
          enterPond(charRow);
          return { ok: true, state: gameState };
        }
        return { ok: false, error: 'enterPond not found' };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    exitPond: () => {
      try {
        if (typeof exitPond === 'function') {
          exitPond();
          return { ok: true, state: gameState };
        }
        return { ok: false, error: 'exitPond not found' };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    castFishing: (col, row) => {
      try {
        if (typeof beginPondFishingAtTile === 'function') {
          beginPondFishingAtTile(col, row);
          return { ok: true, phase: pondFishPhase };
        }
        return { ok: false, error: 'beginPondFishingAtTile not found' };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    getWaterCells: () => {
      try {
        if (typeof pondWaterCells !== 'undefined') return [...pondWaterCells];
        return [];
      } catch (e) { return []; }
    },

    cancelFishing: () => {
      try {
        if (typeof cancelPondFishingIfActive === 'function') cancelPondFishingIfActive();
      } catch (e) {}
    },
  };

  console.log('[BOT] Bridge injected ✓');
})();
`;

// ---- MAIN ----
async function main() {
  log('BOT', 'Starting Playwright browser bot...');

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
           '--disable-dev-shm-usage', '--window-size=1280,720'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Suppress console noise
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[BOT]')) log('GAME', text);
  });

  try {
    // ==== STEP 1: LOGIN ====
    log('AUTH', 'Setting up wallet injection...');
    const pubKeyB58 = bs58.encode(KEYPAIR.publicKey);
    const pubB64 = Buffer.from(KEYPAIR.publicKey).toString('base64');

    await page.exposeFunction('__hermesSign', (msgB64) => {
      try {
        const msgBytes = Buffer.from(msgB64, 'base64');
        const sig = nacl.sign.detached(msgBytes, KEYPAIR.secretKey);
        return Buffer.from(sig).toString('base64');
      } catch (e) { return null; }
    });

    await page.addInitScript((args) => {
      const { PUBKEY, PUB_B64 } = args;
      function b64toArr(b64) { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return arr; }
      function arrToB64(arr) { let s = ''; for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]); return btoa(s); }
      const pubKeyBytes = b64toArr(PUB_B64);
      
      // Intercept WebSocket constructor to capture game's WS connection
      window.__botWsInstances = [];
      const OrigWS = window.WebSocket;
      window.WebSocket = function(url, protocols) {
        const ws = new OrigWS(url, protocols);
        window.__botWsInstances.push(ws);
        console.log('[BOT-WS] WebSocket captured: ' + url);
        return ws;
      };
      window.WebSocket.prototype = OrigWS.prototype;
      
      // Intercept fetch to log grant-fish-xp responses
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const resp = await origFetch.apply(this, args);
        if (url.includes('grant-fish-xp')) {
          try {
            const clone = resp.clone();
            const body = await clone.text();
            console.log('[BOT-FISH-API] grant-fish-xp status=' + resp.status + ' body=' + body.substring(0, 200));
          } catch(e) {
            console.log('[BOT-FISH-API] grant-fish-xp error reading response: ' + e.message);
          }
        }
        return resp;
      };
      
      const fakeSolana = {
        isPhantom: true, isConnected: true,
        publicKey: { toString: () => PUBKEY, toBase58: () => PUBKEY, toBytes: () => pubKeyBytes },
        connect: async () => ({ publicKey: { toString: () => PUBKEY, toBase58: () => PUBKEY } }),
        signMessage: async (msg) => {
          let msgBytes = (msg instanceof Uint8Array) ? msg : new TextEncoder().encode(msg);
          const sigB64 = await window.__hermesSign(arrToB64(msgBytes));
          return { signature: Array.from(b64toArr(sigB64)) };
        },
        signTransaction: async (tx) => tx,
        on: () => {}, off: () => {},
        request: async (req) => (req?.method === 'connect' ? { publicKey: PUBKEY } : null)
      };
      Object.defineProperty(window, 'solana', { value: fakeSolana, writable: false });
      Object.defineProperty(window, 'phantom', { value: { solana: fakeSolana }, writable: false });
    }, { PUBKEY: pubKeyB58, PUB_B64: pubB64 });

    // ==== STEP 2: Navigate to homepage & login ====
    log('AUTH', 'Navigating to kintara.gg...');
    await page.goto('https://kintara.gg', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);

    // Click Connect button
    log('AUTH', 'Clicking Connect...');
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes('connect'));
      if (btn) btn.click();
    });

    // Wait for session cookie
    let sessionCookie = null;
    for (let i = 0; i < 20; i++) {
      const cookies = await context.cookies('https://kintara.gg');
      sessionCookie = cookies.find(c => c.name.includes('session'));
      if (sessionCookie) break;
      await sleep(1000);
    }
    if (!sessionCookie) throw new Error('Login failed — no session cookie');
    log('AUTH', `✅ Logged in! Cookie: ${sessionCookie.name}=${sessionCookie.value.substring(0, 20)}...`);

    // Save session for raw WS bot
    fs.writeFileSync(SESSION_FILE, JSON.stringify({
      cookies: `${sessionCookie.name}=${sessionCookie.value}`,
      ts: Date.now(),
    }));

    // ==== STEP 3: Navigate to /play WITH game.js interception ====
    log('PLAY', 'Setting up game.js interception...');
    await page.route('**/game.js', async route => {
      log('PLAY', 'Intercepting game.js — injecting bot bridge...');
      const response = await route.fetch();
      let body = await response.text();
      body += '\n' + BOT_BRIDGE_CODE;
      await route.fulfill({
        body,
        headers: { ...response.headers(), 'Content-Type': 'application/javascript' },
      });
    });

    log('PLAY', 'Navigating to /play...');
    await page.goto('https://kintara.gg/play', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);

    // Click PLAY button
    log('PLAY', 'Clicking PLAY...');
    const playClicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'PLAY');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!playClicked) log('PLAY', '⚠️ PLAY button not found, trying to continue...');
    await sleep(3000);

    // Select Server
    log('PLAY', `Selecting ${SERVER.toUpperCase()}...`);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const s1 = btns.find(b => b.textContent.includes('SERVER 1'));
      if (s1) { s1.click(); return; }
      const anyS = btns.find(b => b.textContent.includes('SERVER'));
      if (anyS) anyS.click();
    });
    await sleep(8000); // Wait for game to load

    // ==== STEP 4: Wait for game ready ====
    log('GAME', 'Waiting for game to load...');
    let ready = false;
    for (let i = 0; i < 30; i++) {
      ready = await page.evaluate(() => {
        return typeof window.__bot !== 'undefined' && window.__bot.isReady();
      }).catch(() => false);
      if (ready) break;
      await sleep(2000);
    }
    if (!ready) {
      log('GAME', '⚠️ Game not ready after 60s, checking bot bridge...');
      const bridgeExists = await page.evaluate(() => typeof window.__bot !== 'undefined');
      log('GAME', `Bridge exists: ${bridgeExists}`);
      if (!bridgeExists) throw new Error('Bot bridge not injected');
      // Try waiting more
      for (let i = 0; i < 15; i++) {
        ready = await page.evaluate(() => window.__bot.isReady());
        if (ready) break;
        await sleep(2000);
      }
    }
    if (!ready) throw new Error('Game failed to load');
    log('GAME', '✅ Game loaded!');

    // ==== STEP 5: Equip axe ====
    log('GAME', 'Equipping axe...');
    const eqResult = await page.evaluate(() => window.__bot.equip(0));
    log('GAME', `Equipped slot: ${eqResult}`);
    await sleep(1000);

    // Get initial state
    const state = await page.evaluate(() => window.__bot.getState());
    log('GAME', `State: game=${state.gameState} char=(${state.charCol},${state.charRow}) eq=${state.equippedSlot}`);

    let backpack = await page.evaluate(() => window.__bot.getBackpack());
    log('GAME', `Backpack: wood=${backpack?.wood} stone=${backpack?.stone} coal=${backpack?.coal}`);

    // ==== STEP 6: HARVEST LOOP ====
    log('HARVEST', '🌲⛏️ Starting harvest loop...');

    // Wait for snap to populate tree/rock maps
    log('HARVEST', 'Waiting for resource data from snap...');
    let treeCount = 0, rockCount = 0;
    for (let w = 0; w < 30; w++) {
      const res = await page.evaluate(() => ({
        trees: window.__bot.getTrees().length,
        rocks: window.__bot.getRocks().length,
      }));
      treeCount = res.trees;
      rockCount = res.rocks;
      if (treeCount > 0 || rockCount > 0) break;
      await sleep(1000);
    }
    log('HARVEST', `Resources found: ${treeCount} trees, ${rockCount} rocks`);

    // Walk around to load more resources if maps are empty
    if (treeCount === 0 && rockCount === 0) {
      log('HARVEST', 'No resources loaded yet — walking to trigger snap...');
      // Click on a nearby tile to trigger movement + snap loading
      await page.evaluate(() => {
        try {
          const trees = window.__bot.getTrees();
          const rocks = window.__bot.getRocks();
          // Try to walk to spawn area
          window.__bot.cancelAll();
        } catch(e) {}
      });
      await sleep(5000);
      const res2 = await page.evaluate(() => ({
        trees: window.__bot.getTrees().length,
        rocks: window.__bot.getRocks().length,
      }));
      log('HARVEST', `After walk: ${res2.trees} trees, ${res2.rocks} rocks`);
    }

    backpack = await page.evaluate(() => window.__bot.getBackpack());
    let totalWood = backpack?.wood || 0;
    let totalStone = backpack?.stone || 0;
    let totalCoal = backpack?.coal || 0;
    let harvestCount = 0;

    // Resource targets for 1 gold (merchant trade)
    const TARGETS = { wood: 1500, stone: 800, coal: 400, fish: 25 };

    // Decide starting mode based on what's needed most
    function pickMode(bp) {
      const woodNeed = Math.max(0, TARGETS.wood - (bp?.wood || 0));
      const stoneNeed = Math.max(0, TARGETS.stone - (bp?.stone || 0));
      const coalNeed = Math.max(0, TARGETS.coal - (bp?.coal || 0));
      const fishNeed = Math.max(0, TARGETS.fish - ((bp?.cooked_fish_meat || 0) + (bp?.fish || 0)));
      
      // Prioritize: wood first (biggest need), then mining, then fishing
      if (woodNeed > 0) return 'woodcut';
      if (stoneNeed > 0 || coalNeed > 0) return 'mining';
      if (fishNeed > 0) return 'fishing';
      return 'done'; // All targets met!
    }

    let currentMode = pickMode(backpack);
    if (currentMode === 'done') {
      log('HARVEST', '🎉 Semua target tercapai! wood>=1500 stone>=800 coal>=400');
    }

    while (currentMode !== 'done') {
      // Re-check backpack and pick mode
      backpack = await page.evaluate(() => window.__bot.getBackpack());
      currentMode = pickMode(backpack);
      if (currentMode === 'done') {
        log('HARVEST', '🎉 SEMUA TARGET TERCAPAI!');
        log('HARVEST', `   wood=${backpack?.wood} stone=${backpack?.stone} coal=${backpack?.coal}`);
        log('HARVEST', `   Bisa trade ke merchant buat 1 gold!`);
        break;
      }

      const woodLeft = Math.max(0, TARGETS.wood - (backpack?.wood || 0));
      const stoneLeft = Math.max(0, TARGETS.stone - (backpack?.stone || 0));
      const coalLeft = Math.max(0, TARGETS.coal - (backpack?.coal || 0));
      const fishLeft = Math.max(0, TARGETS.fish - ((backpack?.fish || 0) + (backpack?.cooked_fish_meat || 0)));
      log('HARVEST', `━━━ MODE: ${currentMode.toUpperCase()} ━━━`);
      log('HARVEST', `   Sisa: ${woodLeft} wood, ${stoneLeft} stone, ${coalLeft} coal, ${fishLeft} fish`);

      // Equip appropriate tool (0=axe, 1=pickaxe, 3=fishing_rod)
      const slotToEquip = currentMode === 'woodcut' ? 0 : currentMode === 'mining' ? 1 : 3;
      await page.evaluate((s) => window.__bot.equip(s), slotToEquip);
      await sleep(150);

      // Fishing has its own loop (different from woodcut/mining)
      if (currentMode === 'fishing') {
        log('HARVEST', '🎣 Entering pond...');
        const pondResult = await page.evaluate(() => window.__bot.enterPond());
        if (!pondResult?.ok) {
          log('HARVEST', `Failed to enter pond: ${pondResult?.error}`);
          await sleep(5000);
          continue;
        }
        await sleep(3000); // Wait for realm transition

        // Get water cells
        const waterCells = await page.evaluate(() => window.__bot.getWaterCells());
        log('HARVEST', `Water cells: ${waterCells.length}`);
        if (waterCells.length === 0) {
          log('HARVEST', 'No water cells found! Exiting pond...');
          await page.evaluate(() => window.__bot.exitPond());
          await sleep(3000);
          continue;
        }

        // Fishing loop
        let fishCaught = 0;
        while (true) {
          backpack = await page.evaluate(() => window.__bot.getBackpack());
          const totalFish = (backpack?.fish || 0) + (backpack?.cooked_fish_meat || 0);
          if (totalFish >= TARGETS.fish) {
            log('HARVEST', `🎣 Target fish reached! ${totalFish}/${TARGETS.fish}`);
            break;
          }

          // Pick a random water cell
          const cell = waterCells[Math.floor(Math.random() * waterCells.length)];
          const [wc, wr] = cell.split(',').map(Number);

          // Cast fishing line
          const castResult = await page.evaluate(({ c, r }) => window.__bot.castFishing(c, r), { c: wc, r: wr });
          if (!castResult?.ok) {
            log('HARVEST', `Cast failed: ${castResult?.error}`);
            await sleep(2000);
            continue;
          }
          log('HARVEST', `🎣 Cast at [${wc},${wr}], waiting for bite...`);

          // Wait for catch (max 90 seconds — natural bite can take 30-60s)
          let caught = false;
          for (let w = 0; w < 90; w++) {
            await sleep(1000); // Poll normally
            const phase = await page.evaluate(() => {
              const res = window.__bot.instantStrikeAndReel();
              return res.phase;
            });
            if (phase === 'idle' && w > 3) {
              // Fish was caught (phase went back to idle after reel)
              caught = true;
              break;
            }
            if (w % 5 === 0 && w > 0) {
              log('HARVEST', `  🎣 Waiting... phase=${phase} (${w}s)`);
            }
          }

          if (caught) {
            const newBP = await page.evaluate(() => window.__bot.getBackpack());
            const newTotal = (newBP?.fish || 0) + (newBP?.cooked_fish_meat || 0);
            const delta = newTotal - totalFish;
            if (delta > 0) {
              log('HARVEST', `  ✅ Caught fish! (${newTotal}/${TARGETS.fish})`);
              fishCaught++;
            } else {
              log('HARVEST', `  🎣 Phase reset but no fish gained`);
            }
          } else {
            log('HARVEST', `  🎣 Timeout, cancelling...`);
            await page.evaluate(() => window.__bot.cancelFishing());
            await sleep(1000);
          }

          // Brief pause between casts
          await sleep(rand(1000, 2000));
        }

        // Exit pond and go back to world
        log('HARVEST', '🎣 Exiting pond...');
        await page.evaluate(() => window.__bot.exitPond());
        await sleep(3000);
        continue; // Re-evaluate mode
      }

      // Woodcut/Mining loop
      let modeActive = true;
      while (modeActive) {
        // Check if we should switch mode
        backpack = await page.evaluate(() => window.__bot.getBackpack());
        if (pickMode(backpack) !== currentMode) {
          log('HARVEST', `🔄 Target ${currentMode} tercapai! Switching...`);
          modeActive = false;
          break;
        }

        // Get available resources from game's internal maps
        const resources = await page.evaluate((m) => {
          if (m === 'woodcut') {
            return window.__bot.getTrees().map(t => {
              const parts = t.key.split(',');
              return { col: parseInt(parts[0]), row: parseInt(parts[1]), key: t.key };
            }).filter(t => !isNaN(t.col) && !isNaN(t.row));
          } else {
            return window.__bot.getRocks().map(r => {
              const parts = r.key.split(',');
              return { col: parseInt(parts[0]), row: parseInt(parts[1]), key: r.key, hasCoal: r.hasCoal || false };
            }).filter(r => !isNaN(r.col) && !isNaN(r.row));
          }
        }, currentMode);

        if (resources.length === 0) {
          log('HARVEST', `No ${currentMode} resources in view, waiting for respawn...`);
          await sleep(10000);
          continue;
        }

        // Sort: coal rocks first when mining IF coal is still needed, otherwise prioritize stone rocks
        if (currentMode === 'mining') {
          const coalRocks = resources.filter(r => r.hasCoal);
          const stoneRocks = resources.filter(r => !r.hasCoal);
          
          const coalLeft = Math.max(0, TARGETS.coal - (backpack?.coal || 0));
          const stoneLeft = Math.max(0, TARGETS.stone - (backpack?.stone || 0));
          
          if (coalLeft > 0 && stoneLeft > 0) {
            // If both are needed, mix them but sort coal first (or just randomize them so it gets both naturally)
            coalRocks.sort(() => Math.random() - 0.5);
            stoneRocks.sort(() => Math.random() - 0.5);
            resources.length = 0;
            resources.push(...coalRocks, ...stoneRocks);
            log('HARVEST', `  ⛏️ Mining mixed: ${coalLeft} coal needed (${coalRocks.length} in view), ${stoneLeft} stone needed (${stoneRocks.length} in view)`);
          } else if (coalLeft > 0) {
            // Only need coal
            coalRocks.sort(() => Math.random() - 0.5);
            resources.length = 0;
            resources.push(...coalRocks);
            log('HARVEST', `  ⛏️ Mining COAL ONLY: ${coalLeft} needed (${coalRocks.length} in view)`);
          } else {
            // Only need stone
            stoneRocks.sort(() => Math.random() - 0.5);
            resources.length = 0;
            resources.push(...stoneRocks);
            log('HARVEST', `  ⛏️ Mining STONE ONLY: ${stoneLeft} needed (${stoneRocks.length} in view)`);
          }
        } else {
          resources.sort(() => Math.random() - 0.5);
        }

        for (const res of resources) {
          // Check mode switch mid-sweep
          backpack = await page.evaluate(() => window.__bot.getBackpack());
          if (pickMode(backpack) !== currentMode) {
            modeActive = false;
            break;
          }

          const col = res.col;
          const row = res.row;
          const key = `${col},${row}`;

          // Initiate harvest
          const fn = currentMode === 'woodcut' ? 'chopTree' : 'mineRock';
          const result = await page.evaluate(({ fn, col, row }) => window.__bot[fn](col, row), { fn, col, row });

          if (!result?.ok) {
            log('HARVEST', `Failed to approach ${key}: ${result?.error || result?.reason}`);
            continue;
          }

          // Wait for approach + harvest to complete
          log('HARVEST', `→ ${currentMode} [${key}]...`);
          let harvestDone = false;
          let timeout = 0;
          while (!harvestDone && timeout < 30) {
            await sleep(1000);
            timeout++;
            const hs = await page.evaluate(() => window.__bot.getHarvestStatus());
            const state = await page.evaluate(() => window.__bot.getState());

            // Check if harvest is done (state back to idle)
            if (currentMode === 'woodcut' && hs.chopping === 'idle' && state.moving === false && timeout > 3) {
              harvestDone = true;
            }
            if (currentMode === 'mining' && hs.mining === 'idle' && state.moving === false && timeout > 3) {
              harvestDone = true;
            }

            // Log progress occasionally
            if (timeout % 5 === 0) {
              const bp = await page.evaluate(() => window.__bot.getBackpack());
              if (bp) {
                const woodDelta = bp.wood - totalWood;
                const stoneDelta = bp.stone - totalStone;
                const coalDelta = bp.coal - totalCoal;
                if (woodDelta > 0 || stoneDelta > 0 || coalDelta > 0) {
                  log('HARVEST', `  📦 +${woodDelta} wood +${stoneDelta} stone +${coalDelta} coal`);
                }
              }
            }
          }

          // Update totals
          const bp = await page.evaluate(() => window.__bot.getBackpack());
          if (bp) {
            if (bp.wood > totalWood) {
              log('HARVEST', `  ✅ +${bp.wood - totalWood} wood! (${bp.wood}/${TARGETS.wood})`);
              totalWood = bp.wood;
              harvestCount++;
            }
            if (bp.stone > totalStone) {
              log('HARVEST', `  ✅ +${bp.stone - totalStone} stone! (${bp.stone}/${TARGETS.stone})`);
              totalStone = bp.stone;
              harvestCount++;
            }
            if (bp.coal > totalCoal) {
              log('HARVEST', `  ✅ +${bp.coal - totalCoal} coal! (${bp.coal}/${TARGETS.coal})`);
              totalCoal = bp.coal;
              harvestCount++;
            }
          }

          // Natural delay between resources (speed up for Rafie)
          await sleep(rand(200, 600));
        }

        // Brief pause between sweeps (speed up for Rafie)
        await sleep(rand(500, 1200));
      }

      // Small delay before switching mode
      await sleep(500);
    }

    // All targets reached!
    const finalBP = await page.evaluate(() => window.__bot.getBackpack());
    log('HARVEST', `━━━ FINAL: ${harvestCount} harvests | wood=${finalBP?.wood} stone=${finalBP?.stone} coal=${finalBP?.coal} fish=${(finalBP?.fish || 0) + (finalBP?.cooked_fish_meat || 0)} ━━━`);

  } catch (e) {
    log('ERROR', `Fatal: ${e.message}`);
    console.error(e);
  } finally {
    await browser.close();
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('BOT', 'Shutting down...');
  process.exit(0);
});

main().catch(e => {
  log('ERROR', `Unhandled: ${e.message}`);
  console.error(e);
  process.exit(1);
});
