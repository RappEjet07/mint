const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🔑 Generating a brand new Solana Burner Wallet...');
  const kp = Keypair.generate();
  
  // Convert secretKey array to base58 or hex/JSON
  const privateKeyRaw = Array.from(kp.secretKey);
  const publicKeyStr = kp.publicKey.toBase58();
  
  // For Phantom import, we can convert raw secret key to a Hex or Base58 string.
  // Standard Solana private keys are represented as Base58 (bs58).
  // Let's import bs58 package dynamically or just write raw JSON representation which Phantom also supports.
  // Actually, we can just use the standard bs58 encoding or write a small conversion.
  // Let's use standard node buffer hex conversion or a simple Base58 encoder.
  
  // Phantom supports importing via raw Private Key (64 bytes or 32 bytes) in hex/base58.
  // Let's install bs58 to make it super easy.
  let privateKeyBase58 = '';
  try {
    const bs58 = require('bs58');
    privateKeyBase58 = bs58.encode(kp.secretKey);
  } catch (e) {
    // Fallback if bs58 is not installed yet
    privateKeyBase58 = Buffer.from(kp.secretKey).toString('hex');
  }

  const envContent = `
# ==========================================
# SOLANA BURNER WALLET FOR KINTARA GAME BOT
# PUBLIC KEY: ${publicKeyStr}
# ==========================================
# Lu bisa import key ini ke Phantom pake Private Key (Base58 / Hex)
PHANTOM_PRIVATE_KEY="${privateKeyBase58}"
PHANTOM_PASSWORD="BurnerPassword123!"
`;

  const envPath = path.join(__dirname, '.env');
  fs.writeFileSync(envPath, envContent.trim());
  
  console.log('✅ Burner Wallet Generated!');
  console.log(`Public Key: ${publicKeyStr}`);
  console.log(`Saved automatically to: ${envPath}`);
  console.log('⚠️  Catatan: Jangan lupa isi SOL secukupnya ke address ini buat gas fee main Kintara.');
}

main().catch(console.error);
