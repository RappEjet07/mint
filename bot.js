const { chromium } = require('playwright');
require('dotenv').config();
const path = require('path');

const extensionPath = path.resolve(__dirname, 'phantom-extension');

async function run() {
  console.log('🤖 Menjalankan Browser dengan SuperWallet Extension di Kintara.gg...');

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let [page] = context.pages();
  if (!page) page = await context.newPage();

  // --- STEP 1: SETTING WALLET SECARA PROGRAMMATIC ---
  console.log('🔑 Mengonfigurasi wallet burner ke storage extension...');

  const bs58 = require('bs58').default || require('bs58');
  const privateKeyBase58 = process.env.PHANTOM_PRIVATE_KEY;
  if (!privateKeyBase58) {
    console.error('❌ PHANTOM_PRIVATE_KEY tidak ditemukan di .env!');
    await context.close();
    return;
  }

  const keyBytes = bs58.decode(privateKeyBase58);
  const secretKeyArray = Array.from(keyBytes);
  const publicKeyArray = Array.from(keyBytes.slice(32));

  // Cari background page / service worker dari extension
  let backgroundPage = null;
  
  // Cek background pages (Manifest V2 style)
  const existingBg = context.backgroundPages();
  if (existingBg.length > 0) {
    backgroundPage = existingBg[0];
    console.log('✅ Background page ditemukan!');
  } else {
    // Tunggu serviceWorker (Manifest V3 style) dulu
    console.log('⏳ Menunggu service worker extension (MV3)...');
    backgroundPage = await context.waitForEvent('backgroundpage', { timeout: 10000 }).catch(() => null);
  }

  if (backgroundPage) {
    await backgroundPage.evaluate(async ({ secretKey, publicKey }) => {
      return new Promise((resolve) => {
        chrome.storage.local.set({
          secretKey: secretKey,
          publicKey: publicKey,
          connectedSites: ['https://kintara.gg'],
        }, () => resolve(true));
      });
    }, { secretKey: secretKeyArray, publicKey: publicKeyArray });
    console.log('✅ Wallet berhasil diinjek ke background page storage!');
  } else {
    // Fallback: Inject via IndexedDB/localStorage lewat halaman extension popup
    console.log('⚠️  Background page tidak ditemukan. Mencoba cara CDP inject...');
    
    // Buka popup extension buat trigger service worker
    const workers = context.serviceWorkers();
    console.log(`   Service workers: ${workers.length}`);
    
    // Buka kintara.gg dulu supaya extension content-script inject, terus manfaatkan
    // window.postMessage untuk trigger "popup_importKey" ke background
    await page.goto('https://kintara.gg');
    await page.waitForLoadState('networkidle');
    
    // Inject key via message bridge (content-script -> background)
    await page.evaluate(async ({ keyB58 }) => {
      return new Promise((resolve, reject) => {
        const msgId = Date.now();
        const handler = (event) => {
          if (event.data && event.data.target === 'superwallet-inpage' && event.data.id === msgId) {
            window.removeEventListener('message', handler);
            resolve(event.data.result);
          }
        };
        window.addEventListener('message', handler);
        window.postMessage({
          target: 'superwallet-content-script',
          id: msgId,
          method: 'popup_importKey',
          params: { privateKey: keyB58 }
        }, '*');
        setTimeout(() => reject(new Error('timeout')), 8000);
      });
    }, { keyB58: privateKeyBase58 });
    
    console.log('✅ Wallet injected via message bridge!');
  }

  // --- STEP 2: BUKA KINTARA GAME ---
  console.log('🚀 Membuka kintara.gg/play ...');
  await page.goto('https://kintara.gg/play');
  await page.waitForLoadState('networkidle');

  // Cari tombol Connect Wallet / Play kalau belum konek
  try {
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('🎮 Canvas game terdeteksi!');
  } catch (e) {
    console.log('ℹ️  Canvas belum muncul dalam 30s, mungkin perlu connect wallet dulu...');
  }

  // Coba auto-klik tombol connect wallet kalau ada
  const connectBtn = await page.$('text=Connect Wallet').catch(() => null)
    || await page.$('[class*="connect"]').catch(() => null)
    || await page.$('button:has-text("Play")').catch(() => null);
  
  if (connectBtn) {
    console.log('🔗 Tombol connect wallet/play ketemu, klik otomatis...');
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 5000 }).catch(() => null),
      connectBtn.click({ force: true }).catch(() => {}),
    ]);
    if (popup) {
      await popup.waitForLoadState();
      // Auto-approve popup approval kalau ada
      const approveBtn = await popup.$('button:has-text("Connect")').catch(() => null)
        || await popup.$('button:has-text("Approve")').catch(() => null);
      if (approveBtn) {
        await approveBtn.click();
        console.log('✅ Auto-approved popup wallet!');
      }
    }
  }

  console.log('');
  console.log('🎉 SELESAI! Bot Kintara sudah jalan.');
  console.log(`   Burner wallet public key: ${bs58.encode(Uint8Array.from(publicKeyArray))}`);
  console.log('   Browser tetap terbuka. Tekan Ctrl+C untuk stop.');
}

run().catch(console.error);
