/**
 * popup.js — Popup UI logic for SuperWallet
 * Flow: Check if key exists → if not, show onboarding (Import / Generate) → if yes, show dashboard
 */

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="36" height="36">
  <defs>
    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7C3AED"/>
      <stop offset="50%" style="stop-color:#2563EB"/>
      <stop offset="100%" style="stop-color:#06B6D4"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g1)"/>
  <path d="M82 36H52c-8.8 0-16 7.2-16 16v0c0 8.8 7.2 16 16 16h24c8.8 0 16 7.2 16 16v0c0 8.8-7.2 16-16 16H46" stroke="white" stroke-width="10" stroke-linecap="round" fill="none"/>
  <circle cx="82" cy="36" r="6" fill="white"/>
  <circle cx="46" cy="100" r="6" fill="white"/>
</svg>`;

const ICON_SVG_LG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
  <defs>
    <linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7C3AED"/>
      <stop offset="50%" style="stop-color:#2563EB"/>
      <stop offset="100%" style="stop-color:#06B6D4"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g2)"/>
  <path d="M82 36H52c-8.8 0-16 7.2-16 16v0c0 8.8 7.2 16 16 16h24c8.8 0 16 7.2 16 16v0c0 8.8-7.2 16-16 16H46" stroke="white" stroke-width="10" stroke-linecap="round" fill="none"/>
  <circle cx="82" cy="36" r="6" fill="white"/>
  <circle cx="46" cy="100" r="6" fill="white"/>
</svg>`;

// ============================================================
// Utils
// ============================================================
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

function shortenAddress(addr) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

// ============================================================
// Init — decide which screen to show
// ============================================================
async function init() {
  try {
    const response = await chrome.runtime.sendMessage({
      method: "popup_getState",
    });
    if (response?.result?.hasKey) {
      renderWallet(response.result);
    } else {
      renderOnboarding();
    }
  } catch (error) {
    renderError(error.message);
  }
}

// ============================================================
// Onboarding Screen (Import / Generate)
// ============================================================
let currentTab = "import";

function renderOnboarding() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="onboard-center">
      <div class="onboard-logo">${ICON_SVG_LG}</div>
      <div class="onboard-title">Welcome to SuperWallet</div>
      <div class="onboard-subtitle">Import an existing wallet or generate a brand new one to get started.</div>

      <div class="tabs">
        <button class="tab active" id="tabImport">Import Wallet</button>
        <button class="tab" id="tabGenerate">Create New</button>
      </div>

      <div id="tabContent"></div>
    </div>
    <div class="footer">SuperWallet v1.0.0 — Wallet Standard Compatible</div>
  `;

  document
    .getElementById("tabImport")
    .addEventListener("click", () => switchTab("import"));
  document
    .getElementById("tabGenerate")
    .addEventListener("click", () => switchTab("generate"));
  switchTab("import");
}

function switchTab(tab) {
  currentTab = tab;
  document
    .getElementById("tabImport")
    .classList.toggle("active", tab === "import");
  document
    .getElementById("tabGenerate")
    .classList.toggle("active", tab === "generate");

  const content = document.getElementById("tabContent");

  if (tab === "import") {
    content.innerHTML = `
      <div class="input-group">
        <label class="input-label">Private Key</label>
        <textarea class="input-field" id="privateKeyInput" placeholder="Paste your base58-encoded private key here..." spellcheck="false"></textarea>
        <div class="input-hint">
          Supports 64-byte secret key or 32-byte seed (base58 encoded).
          You can export this from Phantom → Settings → Export Private Key.
        </div>
        <div class="error-text" id="importError" style="display:none;"></div>
      </div>
      <button class="btn btn-primary" id="importBtn">🔑 Import Wallet</button>
    `;

    document
      .getElementById("importBtn")
      .addEventListener("click", handleImport);
    document
      .getElementById("privateKeyInput")
      .addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleImport();
        }
      });
    // Focus the input
    setTimeout(() => document.getElementById("privateKeyInput")?.focus(), 100);
  } else {
    content.innerHTML = `
      <div class="generate-info">
        <div class="generate-info-icon">🔐</div>
        <div class="generate-info-text">
          A brand new Ed25519 keypair will be generated securely in your browser.
          No private key ever leaves this extension.
        </div>
      </div>
      <div class="warning-box">
        <p>⚠️ <strong>Important:</strong> After generating, make sure to back up your private key from the wallet settings. If you lose it, your funds are gone forever.</p>
      </div>
      <button class="btn btn-primary" id="generateBtn">✨ Generate New Wallet</button>
    `;

    document
      .getElementById("generateBtn")
      .addEventListener("click", handleGenerate);
  }
}

async function handleImport() {
  const input = document.getElementById("privateKeyInput");
  const errorEl = document.getElementById("importError");
  const btn = document.getElementById("importBtn");
  const privateKey = input.value.trim();

  // Clear previous error
  errorEl.style.display = "none";

  if (!privateKey) {
    errorEl.textContent = "Please paste your private key.";
    errorEl.style.display = "block";
    input.focus();
    return;
  }

  btn.textContent = "⏳ Importing...";
  btn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      method: "popup_importKey",
      params: { privateKey },
    });

    if (response?.error) {
      errorEl.textContent = response.error.message;
      errorEl.style.display = "block";
      btn.textContent = "🔑 Import Wallet";
      btn.disabled = false;
      return;
    }

    showToast("Wallet imported! ✅");
    setTimeout(init, 300);
  } catch (err) {
    errorEl.textContent = err.message || "Failed to import key.";
    errorEl.style.display = "block";
    btn.textContent = "🔑 Import Wallet";
    btn.disabled = false;
  }
}

async function handleGenerate() {
  const btn = document.getElementById("generateBtn");
  btn.textContent = "⏳ Generating...";
  btn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      method: "popup_generateKey",
    });

    if (response?.error) {
      showToast("Error: " + response.error.message);
      btn.textContent = "✨ Generate New Wallet";
      btn.disabled = false;
      return;
    }

    showToast("Wallet created! ✅");
    setTimeout(init, 300);
  } catch (err) {
    showToast("Error: " + err.message);
    btn.textContent = "✨ Generate New Wallet";
    btn.disabled = false;
  }
}

// ============================================================
// Wallet Dashboard (shown when key exists)
// ============================================================
function renderWallet(state) {
  const { address, connectedSites } = state;
  const app = document.getElementById("app");

  const sitesHtml =
    connectedSites.length > 0
      ? connectedSites
          .map(
            (site) => `
        <div class="site-item">
          <span class="site-url">${site}</span>
          <div class="site-dot"></div>
        </div>
      `,
          )
          .join("")
      : '<div class="no-sites">No connected sites yet</div>';

  app.innerHTML = `
    <div class="header">
      <div class="logo-section">
        ${ICON_SVG}
        <span class="wallet-name">SuperWallet</span>
      </div>
      <span class="network-badge">Devnet</span>
    </div>

    <div class="account-card">
      <div class="account-label">Your Address</div>
      <div class="address-row">
        <span class="address" id="address" title="${address}">${address}</span>
        <button class="copy-btn" id="copyBtn" title="Copy address">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>
      <div class="balance-section">
        <div class="balance-label">Balance</div>
        <div class="balance-value" id="balance">—</div>
        <div class="balance-usd" id="balanceUsd"></div>
      </div>
    </div>

    <div class="section-title">Connected Sites</div>
    <div class="sites-list">
      ${sitesHtml}
    </div>

    <div class="actions">
      <button class="btn btn-primary" id="airdropBtn">🪂 Request Airdrop (Devnet)</button>
      <button class="btn btn-secondary" id="exportBtn">📤 Export Private Key</button>
      <button class="btn btn-secondary" id="refreshBtn">↻ Refresh Balance</button>
      <button class="btn btn-danger" id="resetBtn">🗑 Remove Wallet</button>
    </div>

    <div class="footer">SuperWallet v1.0.0 — Wallet Standard Compatible</div>
  `;

  // Copy button
  document.getElementById("copyBtn").addEventListener("click", () => {
    navigator.clipboard
      .writeText(address)
      .then(() => showToast("Address copied!"));
  });

  // Refresh balance
  document
    .getElementById("refreshBtn")
    .addEventListener("click", () => fetchBalance(address));

  // Airdrop
  document
    .getElementById("airdropBtn")
    .addEventListener("click", () => requestAirdrop(address));

  // Export private key
  document.getElementById("exportBtn").addEventListener("click", handleExport);

  // Reset / Remove wallet
  document.getElementById("resetBtn").addEventListener("click", async () => {
    if (
      confirm(
        "This will DELETE your wallet from the extension. Make sure you've backed up your private key!\n\nAre you sure?",
      )
    ) {
      await chrome.runtime.sendMessage({ method: "popup_resetWallet" });
      showToast("Wallet removed.");
      setTimeout(init, 500);
    }
  });

  // Load balance
  fetchBalance(address);
}

async function handleExport() {
  try {
    const response = await chrome.runtime.sendMessage({
      method: "popup_exportKey",
    });
    if (response?.error) {
      showToast("Error: " + response.error.message);
      return;
    }

    const pk = response.result.privateKey;
    const app = document.getElementById("app");

    // Find actions div and insert export box before it
    const actionsDiv = app.querySelector(".actions");
    if (actionsDiv) {
      // Remove existing export box if any
      const existing = document.getElementById("exportBox");
      if (existing) {
        existing.remove();
        return; // Toggle off
      }

      const exportDiv = document.createElement("div");
      exportDiv.id = "exportBox";
      exportDiv.style.marginBottom = "16px";
      exportDiv.innerHTML = `
        <div class="input-label" style="margin-bottom: 6px;">🔒 Your Private Key (click to copy)</div>
        <div class="export-box" id="exportKeyText">${pk}</div>
        <div class="warning-box" style="margin-top: 8px;">
          <p>⚠️ <strong>Never share this!</strong> Anyone with this key has full control of your wallet.</p>
        </div>
      `;
      actionsDiv.parentNode.insertBefore(exportDiv, actionsDiv);

      document.getElementById("exportKeyText").addEventListener("click", () => {
        navigator.clipboard
          .writeText(pk)
          .then(() => showToast("Private key copied! Keep it safe!"));
      });
    }
  } catch (err) {
    showToast("Error exporting key.");
  }
}

// ============================================================
// Balance & Airdrop
// ============================================================
async function fetchBalance(address) {
  const balanceEl = document.getElementById("balance");
  const usdEl = document.getElementById("balanceUsd");
  if (!balanceEl) return;

  balanceEl.textContent = "...";
  if (usdEl) usdEl.textContent = "";

  try {
    const response = await fetch("https://api.devnet.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
    });
    const data = await response.json();
    if (data.result?.value !== undefined) {
      const sol = data.result.value / 1e9;
      balanceEl.textContent = sol.toFixed(4) + " SOL";
      if (usdEl) usdEl.textContent = `≈ $${(sol * 0).toFixed(2)} (Devnet)`;
    } else {
      balanceEl.textContent = "0 SOL";
    }
  } catch (err) {
    balanceEl.textContent = "Error loading";
    console.error(err);
  }
}

async function requestAirdrop(address) {
  const btn = document.getElementById("airdropBtn");
  btn.textContent = "⏳ Requesting...";
  btn.disabled = true;

  try {
    const response = await fetch("https://api.devnet.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "requestAirdrop",
        params: [address, 1000000000],
      }),
    });
    const data = await response.json();
    if (data.result) {
      showToast("1 SOL airdropped! 🎉");
      setTimeout(() => fetchBalance(address), 3000);
    } else {
      showToast("Airdrop failed: " + (data.error?.message || "Unknown error"));
    }
  } catch (err) {
    showToast("Airdrop failed: " + err.message);
  } finally {
    btn.textContent = "🪂 Request Airdrop (Devnet)";
    btn.disabled = false;
  }
}

// ============================================================
// Error screen
// ============================================================
function renderError(message) {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="header">
      <div class="logo-section">
        ${ICON_SVG}
        <span class="wallet-name">SuperWallet</span>
      </div>
    </div>
    <div style="text-align: center; padding: 40px 0;">
      <p style="color: #ef4444; margin-bottom: 16px;">Error: ${message}</p>
      <button class="btn btn-primary" onclick="init()">Retry</button>
    </div>
  `;
}

// ============================================================
// Boot
// ============================================================
document.addEventListener("DOMContentLoaded", init);
