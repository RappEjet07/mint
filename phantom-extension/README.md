# 🔮 SuperWallet — Solana Wallet Chrome Extension

A fully functional Solana wallet Chrome extension that registers itself via the **Wallet Standard** protocol, so it gets auto-detected by `@solana/wallet-adapter-react` — exactly like Phantom, Backpack, and Solflare.

Comes with a **Next.js test dApp** to verify that the wallet appears in the wallet-adapter modal, connects, signs messages, and handles transactions.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Folder Structure](#folder-structure)
- [How the Extension Works](#how-the-extension-works)
- [Wallet Standard Registration Flow](#wallet-standard-registration-flow)
- [User Flow](#user-flow)
- [File-by-File Breakdown](#file-by-file-breakdown)
  - [Chrome Extension (`extension/`)](#chrome-extension-extension)
  - [Next.js Test dApp (`app/`)](#nextjs-test-dapp-app)
- [Getting Started](#getting-started)
- [Tech Stack](#tech-stack)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    WEB PAGE                          │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  @solana/wallet-adapter-react                │    │
│  │  listens for wallet-standard:register-wallet │    │
│  │  fires wallet-standard:app-ready             │    │
│  └─────────────┬───────────────────────────────┘    │
│                │ detects                             │
│  ┌─────────────▼───────────────────────────────┐    │
│  │  inpage.js (MAIN WORLD)                      │    │
│  │  • Implements Wallet Standard interface       │    │
│  │  • Dispatches register-wallet event           │    │
│  │  • Listens for app-ready event                │    │
│  │  • Relays signing requests via window.postMsg │    │
│  └─────────────┬───────────────────────────────┘    │
│                │ window.postMessage                  │
│  ┌─────────────▼───────────────────────────────┐    │
│  │  content-script.js (ISOLATED WORLD)          │    │
│  │  • Injects inpage.js into the page           │    │
│  │  • Bridges messages: page ↔ background       │    │
│  └─────────────┬───────────────────────────────┘    │
└────────────────┼────────────────────────────────────┘
                 │ chrome.runtime.sendMessage
┌────────────────▼────────────────────────────────────┐
│  background.js (SERVICE WORKER)                      │
│  • Stores keypair in chrome.storage.local            │
│  • Handles connect, sign, import, generate, export   │
│  • Embedded TweetNaCl for Ed25519 signatures         │
│  • Base58 encode/decode                              │
└──────────────────────────────────────────────────────┘
                 ▲
                 │ chrome.runtime.sendMessage
┌────────────────┴────────────────────────────────────┐
│  popup/ (EXTENSION POPUP UI)                         │
│  • Onboarding: Import private key OR Generate new    │
│  • Dashboard: Address, balance, airdrop, export key  │
└──────────────────────────────────────────────────────┘
```

---

## Folder Structure

```
wallet-ext/
│
├── extension/                    # ← Chrome extension (load this in chrome://extensions)
│   ├── manifest.json             #    Extension manifest (MV3)
│   ├── background.js             #    Service worker — crypto, storage, message handling
│   ├── content-script.js         #    Bridge between page and background
│   ├── inpage.js                 #    Wallet Standard registration (injected into pages)
│   ├── generate-icons.js         #    Node script to regenerate PNG icons
│   ├── icons/
│   │   ├── icon16.png            #    Toolbar icon
│   │   ├── icon48.png            #    Extensions page icon
│   │   └── icon128.png           #    Chrome Web Store icon
│   └── popup/
│       ├── popup.html            #    Popup UI markup + styles
│       └── popup.js              #    Popup logic — onboarding, dashboard, airdrop
│
├── app/                          # ← Next.js test dApp
│   ├── layout.tsx                #    Root layout — wraps app with WalletContextProvider
│   ├── page.tsx                  #    Home page — renders WalletDashboard
│   ├── globals.css               #    Global styles (Tailwind)
│   └── components/
│       ├── WalletContextProvider.tsx  # ConnectionProvider + WalletProvider + WalletModalProvider
│       └── WalletDashboard.tsx       # Test UI — connect, balance, airdrop, sign message
│
├── public/                       #    Static assets
├── package.json                  #    Dependencies (Next.js + wallet-adapter packages)
├── tsconfig.json                 #    TypeScript config
├── next.config.ts                #    Next.js config
├── postcss.config.mjs            #    PostCSS (Tailwind)
└── eslint.config.mjs             #    ESLint config
```

---

## How the Extension Works

### Three execution contexts in Chrome extensions:

| Context             | File                | World       | Can access                                  |
| ------------------- | ------------------- | ----------- | ------------------------------------------- |
| **Service Worker**  | `background.js`     | Background  | `chrome.*` APIs, `chrome.storage`, no DOM   |
| **Content Script**  | `content-script.js` | Isolated    | DOM of the page + `chrome.runtime` (bridge) |
| **Injected Script** | `inpage.js`         | Main (page) | `window`, page JS, Wallet Standard events   |

These three layers exist because Chrome extensions can't directly access page JavaScript. The content script acts as a message bridge.

---

## Wallet Standard Registration Flow

This is the exact protocol that Phantom, Backpack, and all modern Solana wallets use:

```
1. inpage.js creates a SuperWallet class implementing the Wallet interface
2. inpage.js calls registerWallet(walletInstance)
3. registerWallet() does TWO things:

   a) Dispatches a CustomEvent "wallet-standard:register-wallet"
      → If the dApp already loaded wallet-adapter, the adapter catches this
        and calls the callback with { register } → wallet gets registered

   b) Adds a listener for "wallet-standard:app-ready"
      → If the dApp loads LATER, wallet-adapter dispatches "app-ready"
        and the wallet's listener fires → wallet gets registered

This two-way handshake guarantees detection regardless of load order.
```

### Wallet Standard interface implemented by `inpage.js`:

```
SuperWallet {
  version: '1.0.0'
  name: 'SuperWallet'
  icon: 'data:image/svg+xml;base64,...'
  chains: ['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet']
  accounts: []  →  [SuperWalletAccount] after connect

  features: {
    'standard:connect'              → connect({ silent? }) → { accounts }
    'standard:disconnect'           → disconnect() → void
    'standard:events'               → on('change', listener) → unsubscribe
    'solana:signTransaction'        → signTransaction(tx) → { signedTransaction }
    'solana:signAndSendTransaction' → signAndSendTransaction(tx) → { signature }
    'solana:signMessage'            → signMessage(msg) → { signature, signedMessage }
  }
}
```

---

## User Flow

```
┌───────────────────────────────────┐
│     User installs extension       │
│     (chrome://extensions)         │
└──────────────┬────────────────────┘
               ▼
┌───────────────────────────────────┐
│     Opens popup → No key found    │
│     Shows ONBOARDING screen       │
└──────────┬───────────┬────────────┘
           ▼           ▼
    ┌────────────┐ ┌────────────┐
    │ Import Key │ │ Generate   │
    │ (paste     │ │ New Wallet │
    │  base58)   │ │            │
    └─────┬──────┘ └─────┬──────┘
          └──────┬───────┘
                 ▼
┌───────────────────────────────────┐
│     Key saved to chrome.storage   │
│     Popup shows DASHBOARD         │
│     • Address, Balance, Airdrop   │
│     • Export key, Remove wallet   │
└──────────────┬────────────────────┘
               ▼
┌───────────────────────────────────┐
│     User visits any dApp with     │
│     @solana/wallet-adapter-react  │
│     → SuperWallet auto-detected!  │
│     → Click "Select Wallet"       │
│     → SuperWallet appears in list │
│     → Connect, sign, transact     │
└───────────────────────────────────┘
```

---

## File-by-File Breakdown

### Chrome Extension (`extension/`)

#### `manifest.json`

The Chrome extension manifest (Manifest V3). Declares:

- **`background.service_worker`** → `background.js` runs as the persistent service worker
- **`content_scripts`** → `content-script.js` is injected into every page at `document_start`
- **`web_accessible_resources`** → makes `inpage.js` loadable by the content script
- **`action.default_popup`** → `popup/popup.html` opens when clicking the extension icon
- **`permissions`** → `storage` (for keypair), `activeTab`

#### `background.js`

The brains of the extension. Runs as a **service worker** (no DOM access). Contains:

| Section                    | What it does                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TweetNaCl (embedded)**   | Full Ed25519 implementation — `sign.keyPair()`, `sign.detached()`, `sign.detachedVerify()`, `randomBytes()`. Embedded because service workers can't load external scripts easily. |
| **Base58 encode/decode**   | Converts between raw bytes and Solana's base58 address format.                                                                                                                    |
| **`getKeypair()`**         | Reads keypair from `chrome.storage.local`. Returns `null` if no key exists (does NOT auto-generate).                                                                              |
| **`saveKeypair()`**        | Persists a keypair to `chrome.storage.local`.                                                                                                                                     |
| **`requireKeypair()`**     | Like `getKeypair()` but throws if no key — used by sign operations.                                                                                                               |
| **Message handler**        | Listens for `chrome.runtime.onMessage` and routes by method name:                                                                                                                 |
| → `connect`                | Checks if keypair exists. If yes, saves origin to connected sites and returns public key. If no, returns error.                                                                   |
| → `disconnect`             | Removes origin from connected sites list.                                                                                                                                         |
| → `signTransaction`        | Signs transaction bytes with Ed25519, returns signature + public key.                                                                                                             |
| → `signAllTransactions`    | Signs multiple transactions in a batch.                                                                                                                                           |
| → `signMessage`            | Signs an arbitrary message, returns signature + signed message.                                                                                                                   |
| → `signAndSendTransaction` | Signs a transaction (sending would need an RPC endpoint).                                                                                                                         |
| → `popup_getState`         | Returns `{ hasKey, address, connectedSites }` for the popup UI.                                                                                                                   |
| → `popup_importKey`        | Accepts a base58 private key (32 or 64 bytes), derives keypair, saves it.                                                                                                         |
| → `popup_generateKey`      | Generates a fresh Ed25519 keypair using `crypto.getRandomValues()`.                                                                                                               |
| → `popup_exportKey`        | Returns the secret key as base58 for backup.                                                                                                                                      |
| → `popup_resetWallet`      | Clears `chrome.storage.local` — removes the keypair entirely.                                                                                                                     |

#### `content-script.js`

Runs in Chrome's **isolated world** (can access the DOM but not page JS). Two jobs:

1. **Injects `inpage.js`** into the page's main world by creating a `<script>` tag pointing to `chrome.runtime.getURL('inpage.js')`
2. **Message relay**: Listens for `window.postMessage` from `inpage.js` → forwards to `background.js` via `chrome.runtime.sendMessage` → sends response back via `window.postMessage`

#### `inpage.js`

The most critical file — runs in the **page's main world** (same as the dApp's JavaScript). This is what makes the wallet detectable.

| Section                   | What it does                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Base58 codec**          | Duplicate of the one in background.js (needed here since this is a separate context).                                                                                                                                      |
| **Message transport**     | `sendToBackground()` sends requests via `window.postMessage` to the content script, which forwards to the background. Uses a pending request map with IDs for async responses.                                             |
| **`WALLET_ICON`**         | SVG icon encoded as `data:image/svg+xml;base64,...` (required by Wallet Standard).                                                                                                                                         |
| **`SuperWalletAccount`**  | Implements the `WalletAccount` interface: `address` (base58), `publicKey` (Uint8Array), `chains`, `features`.                                                                                                              |
| **`SuperWallet`**         | Implements the `Wallet` interface with all 6 features (connect, disconnect, events, signTransaction, signAndSendTransaction, signMessage). Each feature method communicates with the background via the message transport. |
| **`RegisterWalletEvent`** | Custom `Event` subclass for `wallet-standard:register-wallet`. Overrides `preventDefault`/`stopPropagation` to throw (the event must not be cancelled — same as Phantom).                                                  |
| **`registerWallet()`**    | Dispatches the register event AND listens for `app-ready`. This two-way handshake is the Wallet Standard protocol.                                                                                                         |
| **`window.superWallet`**  | Legacy provider (like `window.solana` for Phantom) — exposes `connect()`, `signTransaction()`, `signMessage()`, etc. for direct access without wallet-adapter.                                                             |

#### `popup/popup.html`

Extension popup markup. Pure HTML + CSS (no framework). Contains all styles for:

- Onboarding screen (tabs, input field, generate section, warning boxes)
- Wallet dashboard (account card, balance, connected sites, buttons)
- Toasts, spinners, gradient backgrounds

#### `popup/popup.js`

Popup logic. Communicates with `background.js` via `chrome.runtime.sendMessage`.

| Function             | What it does                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `init()`             | Entry point. Calls `popup_getState` — if `hasKey` is false, shows onboarding; if true, shows dashboard.                   |
| `renderOnboarding()` | Renders the **Import Wallet** / **Create New** tabbed interface.                                                          |
| `switchTab()`        | Toggles between import and generate tabs, renders the appropriate form.                                                   |
| `handleImport()`     | Reads the private key textarea, sends `popup_importKey` to background, validates, shows errors or redirects to dashboard. |
| `handleGenerate()`   | Sends `popup_generateKey` to background, creates a new random keypair.                                                    |
| `renderWallet()`     | Renders the dashboard: address, balance, connected sites, action buttons.                                                 |
| `handleExport()`     | Toggles the private key display (click to copy). Sends `popup_exportKey` to background.                                   |
| `fetchBalance()`     | Direct JSON-RPC call to `https://api.devnet.solana.com` → `getBalance`.                                                   |
| `requestAirdrop()`   | Direct JSON-RPC call → `requestAirdrop` (1 SOL on devnet).                                                                |

#### `generate-icons.js`

A one-time Node.js utility script that programmatically generates the PNG icons (16×16, 48×48, 128×128) with a purple-blue gradient and an "S" shape. Run it with `node generate-icons.js` if you need to regenerate icons.

---

### Next.js Test dApp (`app/`)

#### `layout.tsx`

Root layout. Wraps the entire app with `<WalletContextProvider>` so every page has access to the wallet connection context.

#### `page.tsx`

Home page. Simply renders `<WalletDashboard />`.

#### `components/WalletContextProvider.tsx`

Sets up the Solana wallet-adapter stack:

- **`ConnectionProvider`** → connects to devnet RPC
- **`WalletProvider`** → `wallets` array is **empty** on purpose — Wallet Standard wallets (like SuperWallet and Phantom) are auto-detected, no manual adapters needed
- **`WalletModalProvider`** → provides the wallet selection modal UI

#### `components/WalletDashboard.tsx`

The test interface. Uses wallet-adapter hooks (`useWallet`, `useConnection`):

- **Connect button** → `<WalletMultiButton>` (dynamically imported to avoid SSR issues)
- **Connection status** → shows which wallet is connected by name
- **Account info** → public key, SOL balance
- **Test actions** → Request airdrop (1 SOL), Sign message

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Load the Chrome extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right toggle)
3. Click **"Load unpacked"**
4. Select the `extension/` folder from this project

You'll see SuperWallet appear in your extensions bar.

### 3. Set up the wallet

1. Click the SuperWallet extension icon
2. Choose **Import Wallet** (paste a base58 private key) or **Create New** (generates a fresh keypair)
3. Your address and balance will appear on the dashboard

### 4. Run the test dApp

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → Click **"Select Wallet"** → **SuperWallet** appears in the list → Connect and test.

---

## Tech Stack

| Layer           | Technology                                                            |
| --------------- | --------------------------------------------------------------------- |
| Extension       | Chrome Manifest V3, vanilla JS, embedded TweetNaCl                    |
| Wallet Protocol | [Wallet Standard](https://github.com/wallet-standard/wallet-standard) |
| Test dApp       | Next.js 16, React 19, TypeScript, Tailwind CSS v4                     |
| Wallet Adapter  | `@solana/wallet-adapter-react`, `@solana/wallet-adapter-react-ui`     |
| Blockchain      | Solana (devnet via `@solana/web3.js`)                                 |
