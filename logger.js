// ================================================
// LOGGER — colored console output + file logging
// ================================================

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'bot.log');
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

const COLORS = {
  reset:  '\x1b[0m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
};

function ts() {
  return new Date().toLocaleTimeString('id-ID', { hour12: false });
}

// Strip ANSI colors for file output
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function toFile(tag, icon, msg) {
  logStream.write(`[${ts()}] [${tag}] ${icon} ${stripAnsi(msg)}\n`);
}

const logger = {
  info:    (tag, msg) => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.cyan}[${tag}]${COLORS.reset} ${msg}`),
  success: (tag, msg) => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.green}[${tag}]${COLORS.reset} ✅ ${msg}`),
  warn:    (tag, msg) => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.yellow}[${tag}]${COLORS.reset} ⚠️  ${msg}`),
  error:   (tag, msg) => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.red}[${tag}]${COLORS.reset} ❌ ${msg}`),
  earn:    (tag, msg) => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.green}[${tag}]${COLORS.reset} 💰 ${msg}`),
  fish:    (msg)      => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.blue}[FISH]${COLORS.reset} 🎣 ${msg}`),
  mine:    (msg)      => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.yellow}[MINE]${COLORS.reset} ⛏️  ${msg}`),
  wood:    (msg)      => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.green}[WOOD]${COLORS.reset} 🌲 ${msg}`),
  quest:   (msg)      => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.magenta}[QUEST]${COLORS.reset} 📋 ${msg}`),
  sell:    (msg)      => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.green}[SELL]${COLORS.reset} 🛒 ${msg}`),
  spin:    (msg)      => console.log(`${COLORS.gray}[${ts()}]${COLORS.reset} ${COLORS.magenta}[SPIN]${COLORS.reset} 🎰 ${msg}`),
  banner:  ()         => {
    console.log(`\n${COLORS.cyan}╔════════════════════════════════════════╗`);
    console.log(`║     KINTARA.GG FULL AUTO BOT v1.0      ║`);
    console.log(`║     by Antigravity x Rafie              ║`);
    console.log(`╚════════════════════════════════════════╝${COLORS.reset}\n`);
  }
};

module.exports = logger;
