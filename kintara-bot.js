// ================================================
// KINTARA FULL AUTO BOT v1.0
// Main runner — orchestrate semua module
// ================================================

require('dotenv').config();
const log      = require('./logger');
const cfg      = require('./config');
const auth     = require('./auth');
const wsClient = require('./modules/ws');
const daily    = require('./modules/daily');
const fishing  = require('./modules/fishing');
const harvest  = require('./modules/harvest');
const economy  = require('./modules/economy');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- STATS REPORTER ----
function startStatsReporter() {
  setInterval(() => {
    const fishStats    = fishing.getFishStats();
    const harvestStats = harvest.getHarvestStats();
    console.log('');
    log.info('STATS', '━━━━━━━━━━ REPORT ━━━━━━━━━━');
    log.info('STATS', `🎣 Fish: ${fishStats.count} cast | Rare drops: ${fishStats.rareDrops.length}`);
    log.info('STATS', `⛏️  Mine: ${harvestStats.mineCount} | 🌲 Wood: ${harvestStats.woodCount}`);
    if (fishStats.rareDrops.length > 0) {
      fishStats.rareDrops.forEach(d => log.earn('STATS', `  → ${d.kind} @ ${d.time}`));
    }
    console.log('');
  }, 5 * 60 * 1000); // Report tiap 5 menit
}

// ---- QUEST SYNC LOOP ----
async function startQuestLoop() {
  while (true) {
    try {
      await daily.syncProgress();
      await daily.runQuestCheck();
    } catch (e) { log.error('QUEST', e.message); }
    await sleep(cfg.TIMING.QUEST_POLL);
  }
}

// ---- SPINNER LOOP ----
async function startSpinnerLoop() {
  while (true) {
    try {
      await daily.runSpinner();
    } catch (e) { log.error('SPIN', e.message); }
    await sleep(60 * 60 * 1000); // Cek tiap jam
  }
}

// ---- HARVEST SCHEDULER ----
// Prioritas WOOD karena bottleneck gold (butuh 1500 wood vs 800 stone vs 400 coal)
// Stone udah cukup (915/800), coal kurang dikit (288/400), wood jauh (337/1500)
async function startHarvestScheduler() {
  // Mulai dari mode yang aktif
  const modes = [
    { name: 'mining',    feat: 'AUTO_MINING',  run: () => harvest.runMining(),      stop: () => harvest.stopMining() },
    { name: 'woodcut',   feat: 'AUTO_WOODCUT', run: () => harvest.runWoodcutting(), stop: () => harvest.stopWoodcutting() },
    { name: 'fishing',   feat: 'AUTO_FISHING', run: () => fishing.runFishing(),      stop: () => fishing.stopFishing() },
  ];

  // Wood-focused cycle: 15 min woodcut → 3 min mining → repeat (~83% woodcut)
  const schedule = [
    { modeIdx: 1, duration: 15 * 60 * 1000 },  // 15 min woodcut
    { modeIdx: 0, duration:  3 * 60 * 1000 },  //  3 min mining (just for coal)
  ];
  let schedIdx = 0;

  while (true) {
    const entry = schedule[schedIdx];
    const mode = modes[entry.modeIdx];

    if (!cfg.FEATURES[mode.feat]) {
      schedIdx = (schedIdx + 1) % schedule.length;
      continue;
    }

    // Stop semua mode lain dulu
    modes.forEach((m, i) => { if (i !== entry.modeIdx) m.stop(); });
    await sleep(1000);

    // Jalankan mode saat ini (fire-and-forget, dia infinite loop)
    mode.run(); // JANGAN await — ini infinite loop

    const mins = Math.round(entry.duration / 60000);
    log.info('SCHED', `⛏️ ${mode.name} aktif selama ${mins} menit...`);

    // Tunggu sesuai durasi lalu switch
    await sleep(entry.duration);
    mode.stop();
    await sleep(500);
    schedIdx = (schedIdx + 1) % schedule.length;
  }
}

// ---- MAIN ----
async function main() {
  log.banner();
  log.info('MAIN', 'Kintara Full Auto Bot starting up...');
  log.info('MAIN', `Features aktif: ${Object.entries(cfg.FEATURES).filter(([,v]) => v).map(([k]) => k).join(', ')}`);

  // 1. Auth — ambil session
  log.info('MAIN', 'Authenticating...');
  await auth.getSession();
  log.success('MAIN', 'Auth OK!');
  await sleep(2000);

  // 2. Konek WebSocket presence (try multiple servers)
  if (Object.values(cfg.FEATURES).some(v => v)) {
    log.info('MAIN', 'Connecting WebSocket...');
    const servers = [cfg.SERVER, 's2', 's3'].filter((v, i, a) => a.indexOf(v) === i);
    let connected = false;
    for (const srv of servers) {
      try {
        await wsClient.connect(srv);
        connected = true;
        break;
      } catch (e) {
        log.warn('MAIN', `Server ${srv} gagal: ${e.message}`);
      }
    }
    if (!connected) {
      log.error('MAIN', 'Semua server gagal! Exiting...');
      process.exit(1);
    }
    // Posisi spawn: meta.spawn col:7 row:44 → x=col-22.5=-15.5, z=row-42.5=1.5
    wsClient.setRealm('world', -15.5, 0.25, 1.5);
    await sleep(3000); // Tunggu snap + region_ack
  }

  // 3. Jalanin semua fitur yang aktif secara paralel
  const runners = [];

  if (cfg.FEATURES.AUTO_SPINNER || cfg.FEATURES.AUTO_QUEST) {
    // Spinner dulu pas awal
    await daily.runSpinner();
    await daily.runQuestCheck();
    runners.push(startSpinnerLoop());
    runners.push(startQuestLoop());
  }

  // Harvest & economy jalan (fishing sekarang di scheduler)
  if (cfg.FEATURES.AUTO_MINING || cfg.FEATURES.AUTO_WOODCUT || cfg.FEATURES.AUTO_FISHING) {
    await sleep(5000);
    runners.push(startHarvestScheduler());
  }

  if (cfg.FEATURES.AUTO_MERCHANT || cfg.FEATURES.AUTO_SELL) {
    runners.push(economy.runEconomyLoop());
  }

  // Stats reporter
  startStatsReporter();

  log.success('MAIN', '🚀 ALL SYSTEMS GO! Bot berjalan full otomatis.');
  log.info('MAIN', 'Press Ctrl+C untuk stop.');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    log.warn('MAIN', 'Shutting down...');
    fishing.stopFishing();
    harvest.stopMining();
    harvest.stopWoodcutting();
    // Final quest sync
    await daily.syncProgress().catch(() => {});
    log.info('MAIN', 'Bot stopped. Sampai jumpa cok! 👋');
    process.exit(0);
  });

  // Tunggu semua runners (mereka infinite loop, jadi ini block forever)
  await Promise.allSettled(runners);
}

main().catch(e => {
  log.error('MAIN', `Fatal error: ${e.message}`);
  console.error(e);
  process.exit(1);
});
