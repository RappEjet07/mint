// ================================================
// DAILY MODULE — Spinner + Quest auto-claim
// ================================================

const { apiFetch } = require('../auth');
const log          = require('../logger');
const cfg          = require('../config');

// Track kapan terakhir spin
let lastSpinTime = 0;

// ---- AUTO SPINNER ----
async function runSpinner() {
  const now = Date.now();
  if (now - lastSpinTime < cfg.TIMING.SPINNER_INTERVAL) {
    const remainMs  = cfg.TIMING.SPINNER_INTERVAL - (now - lastSpinTime);
    const remainHr  = (remainMs / 3600000).toFixed(1);
    log.spin(`Cooldown masih ${remainHr} jam lagi`);
    return;
  }

  log.spin('Mencoba spin harian...');
  try {
    const res = await apiFetch('/api/auth/daily-spinner-spin', { method: 'POST', body: '{}' });
    if (res.ok) {
      lastSpinTime = Date.now();
      const reward = res.segment?.kind || 'unknown';
      const qty    = res.segment?.qty  || '?';
      log.spin(`BERHASIL! Dapet: ${qty}x ${reward}`);
    } else if (res.error === 'cooldown' || res.cooldown) {
      lastSpinTime = Date.now();
      log.spin(`Cooldown.`);
    } else if (res.error === 'level_too_low' || res.level_too_low) {
      log.spin('Level terlalu rendah buat spin (butuh avg level 5+)');
    } else {
      log.warn('SPIN', `Response: ${JSON.stringify(res)}`);
    }
  } catch (e) {
    log.error('SPIN', e.message);
  }
}

// ---- AUTO QUEST ----
let questState = {}; // { questId: { progress, goal, claimed } }

async function fetchQuestConfig() {
  try {
    const res = await apiFetch('/api/auth/me');
    if (res.ok && res.dailyQuestConfig && res.dailyQuestConfig.quests) {
      // mapping structure format agar kompatibel dengan perulangan
      return res.dailyQuestConfig.quests.map(q => {
        const progObj = res.player?.meta?.dailyQuest?.prog || {};
        const claimedObj = res.player?.meta?.dailyQuest?.claimed || {};
        return {
          id: q.id,
          kind: q.kind,
          goal: q.target,
          progress: progObj[q.id] || 0,
          claimed: claimedObj[q.id] || false
        };
      });
    }
  } catch (e) { /* silent */ }
  return null;
}

async function claimQuest(questId) {
  try {
    const res = await apiFetch('/api/auth/daily-quest-claim', {
      method: 'POST',
      body: JSON.stringify({ questId }),
    });
    if (res.ok) {
      log.quest(`Quest "${questId}" CLAIMED! Reward: ${JSON.stringify(res.reward || {})}`);
      if (questState[questId]) questState[questId].claimed = true;
    } else {
      log.warn('QUEST', `Claim gagal: ${res.error || JSON.stringify(res)}`);
    }
  } catch (e) {
    log.error('QUEST', e.message);
  }
}

async function flushQuestProgress(progressMap) {
  // progressMap = { questId: count }
  try {
    const res = await apiFetch('/api/auth/daily-quest-progress', {
      method: 'POST',
      body: JSON.stringify({ progress: progressMap }),
    });
    return res.ok;
  } catch (e) { return false; }
}

async function runQuestCheck() {
  log.quest('Cek quest harian...');
  const quests = await fetchQuestConfig();
  if (!quests) { 
    log.warn('QUEST', 'Ga ada quest aktif atau belum bisa fetch (biasanya aman, nanti auto-retry)'); 
    return; 
  }

  for (const q of quests) {
    const { id, kind, goal, progress, claimed } = q;
    if (claimed) continue;
    log.quest(`${kind}: ${progress}/${goal}${progress >= goal ? ' ← READY CLAIM' : ''}`);
    if (progress >= goal && !claimed) {
      await claimQuest(id);
      await sleep(1000);
    }
  }
}

// Export progress tracker supaya bisa di-update dari harvest/fish loop
const localProgress = {};

function addProgress(kind, amount = 1) {
  localProgress[kind] = (localProgress[kind] || 0) + amount;
}

async function syncProgress() {
  if (Object.keys(localProgress).length === 0) return;
  const snap = { ...localProgress };
  const ok = await flushQuestProgress(snap);
  if (ok) {
    log.quest(`Progress synced: ${JSON.stringify(snap)}`);
    // Check buat auto-claim setelah sync
    await runQuestCheck();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  runSpinner,
  runQuestCheck,
  addProgress,
  syncProgress,
};
