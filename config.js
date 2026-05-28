// ================================================
// KINTARA BOT CONFIG
// Edit bagian ini sesuai kebutuhan lu, cok
// ================================================

module.exports = {
  // Server yang mau dipake (s1, s2, s3)
  SERVER: 's1',

  // Bot mode: aktifkan/matiin fitur sesuka lu
  FEATURES: {
    AUTO_SPINNER:    false,  // Spin gratis tiap 12 jam
    AUTO_QUEST:      false,  // Auto claim daily quest
    AUTO_FISHING:    false,  // Auto fishing di pond (SKIP dulu, fokus mining+wood)
    AUTO_MINING:     true,   // Mining skill UNLOCKED! 🎉
    AUTO_WOODCUT:    true,   // Auto woodcutting di world (logging skill: unlocked ✅)
    AUTO_MERCHANT:   false,  // Auto trade ke merchant kalau stok cukup
    AUTO_SELL:       false,  // Auto list hasil panen ke marketplace
  },

  // Timing (ms) — jangan terlalu cepet biar ga kena rate limit
  TIMING: {
    FISH_WAIT_MIN:    8000,  // Minimal tunggu sebelum strike (ms)
    FISH_WAIT_MAX:   15000,  // Maksimal tunggu sebelum strike (ms)
    HARVEST_INTERVAL: 2500,  // was 2000 — lebih natural
    QUEST_POLL:      30000,  // Cek quest progress tiap 30 detik
    SPINNER_INTERVAL: 12 * 60 * 60 * 1000, // Tiap 12 jam
    SELL_CHECK:      60000,  // Cek inventory buat dijual tiap 1 menit
    POS_UPDATE:        800,  // Kirim posisi ke server tiap 0.8 detik (lebih natural, hindari kick)
  },

  // Marketplace — harga jual (dalam USD)
  SELL_PRICES: {
    gold:              8.00,
    whale_mount:      50.00,
    whale_gold_mount: 500.00,
    dragon_mount:      5.00,
    wolf_mount:        4.00,
    spider_mount:      8.00,
    wood:              0.50,   // per 100 unit
    stone:             0.50,   // per 100 unit
    coal:              0.80,   // per 100 unit
    fish:              0.40,   // per 100 unit
    cooked_fish_meat:  0.80,   // per 100 unit
  },

  // Threshold sebelum dijual ke marketplace
  SELL_THRESHOLD: {
    wood:  500,
    stone: 300,
    coal:  150,
    fish:  50,
  },

  // Merchant trade — aktif kalau stok >= ini
  MERCHANT_THRESHOLD: {
    wood:            1500,
    stone:            800,
    coal:             400,
    cooked_fish_meat:  25,
  },

  // Koordinat tile buat harvest — coal only (stone udah cukup: 915/800)
  MINE_TILES:  [
    // Coal rocks (auto-detected 2026-05-27)
    { col: 31, row: 9, hasCoal: true },
    { col: 21, row: 1, hasCoal: true },
    { col: 60, row: 22, hasCoal: true },
    { col: 2, row: 0, hasCoal: true },
    { col: 50, row: 25, hasCoal: true },
    { col: 2, row: 4, hasCoal: true },
    { col: 47, row: 23, hasCoal: true },
    { col: 44, row: 27, hasCoal: true },
    { col: 7, row: 21, hasCoal: true },
  ],
  // Tree tiles — auto-detected 2026-05-27 (40 tiles)
  WORLD_TREE_TILES: [
    { col: 12, row: 57 }, { col: 29, row: 19 }, { col: 1, row: 54 },
    { col: 15, row: 57 }, { col: 43, row: 27 }, { col: 4, row: 54 },
    { col: 47, row: 26 }, { col: 12, row: 38 }, { col: 4, row: 58 },
    { col: 4, row: 25 }, { col: 12, row: 37 }, { col: 17, row: 53 },
    { col: 7, row: 26 }, { col: 5, row: 59 }, { col: 45, row: 26 },
    { col: 6, row: 58 }, { col: 10, row: 39 }, { col: 11, row: 57 },
    { col: 17, row: 10 }, { col: 4, row: 23 }, { col: 46, row: 27 },
    { col: 5, row: 60 }, { col: 45, row: 25 }, { col: 16, row: 7 },
    { col: 5, row: 21 }, { col: 5, row: 61 }, { col: 9, row: 40 },
    { col: 17, row: 55 }, { col: 44, row: 29 }, { col: 18, row: 6 },
    { col: 6, row: 19 }, { col: 8, row: 39 }, { col: 4, row: 61 },
    { col: 41, row: 25 }, { col: 22, row: 6 }, { col: 6, row: 24 },
    { col: 7, row: 39 }, { col: 14, row: 58 }, { col: 40, row: 21 },
    { col: 24, row: 6 },
  ],
};
