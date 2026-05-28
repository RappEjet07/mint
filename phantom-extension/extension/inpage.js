/**
 * inpage.js — Injected into the page's main world
 *
 * This implements the Wallet Standard interface and registers itself
 * so that @solana/wallet-adapter-react detects it exactly like Phantom.
 */

(function () {
  "use strict";

  // Prevent double-injection
  if (window.__superWalletRegistered) return;
  window.__superWalletRegistered = true;

  // ============================================================
  // Base58 encoder/decoder (needed in page context)
  // ============================================================
  const BASE58_ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  function bs58encode(buffer) {
    if (buffer.length === 0) return "";
    const digits = [0];
    for (let i = 0; i < buffer.length; i++) {
      let carry = buffer[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    let str = "";
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) str += "1";
    for (let i = digits.length - 1; i >= 0; i--)
      str += BASE58_ALPHABET[digits[i]];
    return str;
  }

  function bs58decode(str) {
    if (str.length === 0) return new Uint8Array(0);
    const bytes = [0];
    for (let i = 0; i < str.length; i++) {
      const c = BASE58_ALPHABET.indexOf(str[i]);
      if (c < 0) throw new Error("Non-base58 character");
      let carry = c;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    for (let i = 0; i < str.length && str[i] === "1"; i++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  // ============================================================
  // Communication with background via content script
  // ============================================================
  let _messageId = 0;
  const _pendingRequests = new Map();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.target !== "superwallet-inpage") return;

    const { id, result, error } = event.data;
    const pending = _pendingRequests.get(id);
    if (pending) {
      _pendingRequests.delete(id);
      if (error) {
        pending.reject(new Error(error.message || "Unknown error"));
      } else {
        pending.resolve(result);
      }
    }
  });

  function sendToBackground(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++_messageId;
      _pendingRequests.set(id, { resolve, reject });
      window.postMessage(
        {
          target: "superwallet-content-script",
          id,
          method,
          params,
        },
        "*",
      );

      // Timeout after 30 seconds
      setTimeout(() => {
        if (_pendingRequests.has(id)) {
          _pendingRequests.delete(id);
          reject(new Error("Request timed out"));
        }
      }, 30000);
    });
  }

  // ============================================================
  // Wallet Icon (SVG as base64 data URI)
  // A sleek purple/blue gradient "S" bolt icon
  // ============================================================
  const WALLET_ICON =
    "data:image/svg+xml;base64," +
    btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
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
</svg>`);

  // ============================================================
  // SuperWalletAccount — implements WalletAccount
  // ============================================================
  class SuperWalletAccount {
    #address;
    #publicKey;
    #chains;
    #features;

    constructor(publicKey) {
      this.#publicKey = new Uint8Array(publicKey);
      this.#address = bs58encode(this.#publicKey);
      this.#chains = [
        "solana:mainnet",
        "solana:devnet",
        "solana:testnet",
        "solana:localnet",
      ];
      this.#features = [
        "standard:connect",
        "standard:disconnect",
        "standard:events",
        "solana:signTransaction",
        "solana:signAndSendTransaction",
        "solana:signMessage",
      ];
    }

    get address() {
      return this.#address;
    }
    get publicKey() {
      return this.#publicKey.slice();
    }
    get chains() {
      return this.#chains.slice();
    }
    get features() {
      return this.#features.slice();
    }
  }

  // ============================================================
  // SuperWallet — implements Wallet Standard interface
  // ============================================================
  class SuperWallet {
    #listeners = {};
    #account = null;

    get version() {
      return "1.0.0";
    }
    get name() {
      return "SuperWallet";
    }
    get icon() {
      return WALLET_ICON;
    }
    get chains() {
      return [
        "solana:mainnet",
        "solana:devnet",
        "solana:testnet",
        "solana:localnet",
      ];
    }
    get accounts() {
      return this.#account ? [this.#account] : [];
    }

    get features() {
      return {
        "standard:connect": {
          version: "1.0.0",
          connect: this.#connect,
        },
        "standard:disconnect": {
          version: "1.0.0",
          disconnect: this.#disconnect,
        },
        "standard:events": {
          version: "1.0.0",
          on: this.#on,
        },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: this.#signTransaction,
        },
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signAndSendTransaction: this.#signAndSendTransaction,
        },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: this.#signMessage,
        },
      };
    }

    // ---- standard:events ----
    #on = (event, listener) => {
      const listeners = this.#listeners[event] || (this.#listeners[event] = []);
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx > -1) listeners.splice(idx, 1);
      };
    };

    #emit(event, ...args) {
      const listeners = this.#listeners[event];
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(...args);
          } catch (e) {
            console.error(e);
          }
        }
      }
    }

    // ---- standard:connect ----
    #connect = async (input) => {
      const silent = input?.silent || false;

      const result = await sendToBackground("connect", { silent });

      if (!result || !result.publicKey) {
        throw new Error(
          "Wallet not set up. Open the SuperWallet extension popup to import or generate a key first.",
        );
      }

      const publicKey = new Uint8Array(result.publicKey);
      this.#account = new SuperWalletAccount(publicKey);
      this.#emit("change", { accounts: this.accounts });
      return { accounts: this.accounts };
    };

    // ---- standard:disconnect ----
    #disconnect = async () => {
      try {
        await sendToBackground("disconnect");
      } catch (e) {
        // Ignore errors during disconnect
      }
      this.#account = null;
      this.#emit("change", { accounts: this.accounts });
    };

    // ---- solana:signTransaction ----
    #signTransaction = async (...inputs) => {
      const outputs = [];
      for (const input of inputs) {
        const { transaction } = input;
        const result = await sendToBackground("signTransaction", {
          transaction: Array.from(transaction),
        });

        if (!result || !result.signature) {
          throw new Error(
            "Wallet not set up. Open SuperWallet popup to import or generate a key.",
          );
        }

        // Build signed transaction: inject the signature into the serialized transaction
        const signature = new Uint8Array(result.signature);
        const publicKey = new Uint8Array(result.publicKey);

        // For Solana transactions, the signature needs to be placed into the
        // transaction's signature slots. We'll return the original tx with signature prepended
        // The wallet-adapter handles reconstructing from the signed bytes
        const signedTx = this.#injectSignature(
          transaction,
          signature,
          publicKey,
        );

        outputs.push({ signedTransaction: signedTx });
      }
      return outputs;
    };

    // ---- solana:signAndSendTransaction ----
    #signAndSendTransaction = async (...inputs) => {
      const outputs = [];
      for (const input of inputs) {
        const { transaction, chain, options } = input;

        const result = await sendToBackground("signAndSendTransaction", {
          transaction: Array.from(transaction),
          chain,
          options,
        });

        if (!result || !result.signature) {
          throw new Error(
            "Wallet not set up. Open SuperWallet popup to import or generate a key.",
          );
        }

        outputs.push({
          signature: new Uint8Array(result.signature),
        });
      }
      return outputs;
    };

    // ---- solana:signMessage ----
    #signMessage = async (...inputs) => {
      const outputs = [];
      for (const input of inputs) {
        const { message } = input;
        const result = await sendToBackground("signMessage", {
          message: Array.from(message),
        });

        if (!result || !result.signature) {
          throw new Error(
            "Wallet not set up. Open SuperWallet popup to import or generate a key.",
          );
        }

        outputs.push({
          signedMessage: new Uint8Array(result.signedMessage),
          signature: new Uint8Array(result.signature),
          signatureType: "ed25519",
        });
      }
      return outputs;
    };

    // Helper: Inject ed25519 signature into serialized Solana transaction
    #injectSignature(txBytes, signature, publicKey) {
      // Solana transaction format:
      // [compact-u16 num_signatures] [signature_0 (64 bytes)] ... [message_bytes]
      // For a simple single-signer tx, we need to put our signature in the first slot
      const tx = new Uint8Array(txBytes);

      // Read number of signatures (compact-u16)
      let offset = 0;
      let numSigs = tx[offset];
      if (numSigs === 0) {
        // No signature slots, can't inject — return original
        return tx;
      }
      offset = 1; // after compact-u16 (assuming < 128 sigs = 1 byte)

      // The first signature is at offset, 64 bytes
      // Replace it with our signature
      const signed = new Uint8Array(tx.length);
      signed.set(tx);
      signed.set(signature, offset);

      return signed;
    }
  }

  // ============================================================
  // Register with Wallet Standard
  // This is the exact same pattern Phantom uses.
  // ============================================================
  function registerWallet(wallet) {
    const callback = ({ register }) => register(wallet);

    try {
      window.dispatchEvent(new RegisterWalletEvent(callback));
    } catch (error) {
      console.error(
        "[SuperWallet] wallet-standard:register-wallet event could not be dispatched\n",
        error,
      );
    }

    try {
      window.addEventListener("wallet-standard:app-ready", (event) => {
        callback(event.detail);
      });
    } catch (error) {
      console.error(
        "[SuperWallet] wallet-standard:app-ready event listener could not be added\n",
        error,
      );
    }
  }

  class RegisterWalletEvent extends Event {
    #detail;

    get detail() {
      return this.#detail;
    }

    get type() {
      return "wallet-standard:register-wallet";
    }

    constructor(callback) {
      super("wallet-standard:register-wallet", {
        bubbles: false,
        cancelable: false,
        composed: false,
      });
      this.#detail = callback;
    }

    preventDefault() {
      throw new Error("preventDefault cannot be called on RegisterWalletEvent");
    }

    stopImmediatePropagation() {
      throw new Error(
        "stopImmediatePropagation cannot be called on RegisterWalletEvent",
      );
    }

    stopPropagation() {
      throw new Error(
        "stopPropagation cannot be called on RegisterWalletEvent",
      );
    }
  }

  // ============================================================
  // Also expose on window.superWallet for legacy / direct access
  // (like window.solana for Phantom, window.backpack for Backpack, etc.)
  // ============================================================
  const walletInstance = new SuperWallet();

  // Legacy provider (like window.solana)
  const legacyProvider = {
    isSuperWallet: true,
    isConnected: false,
    publicKey: null,

    connect: async (opts) => {
      const result = await sendToBackground("connect", {
        silent: opts?.onlyIfTrusted,
      });
      if (!result || !result.publicKey) {
        throw new Error(
          "Wallet not set up. Open SuperWallet popup to import or generate a key.",
        );
      }
      const publicKey = new Uint8Array(result.publicKey);
      legacyProvider.isConnected = true;
      legacyProvider.publicKey = {
        toBytes: () => publicKey,
        toBase58: () => bs58encode(publicKey),
        toString: () => bs58encode(publicKey),
        equals: (other) => {
          const otherBytes =
            typeof other.toBytes === "function" ? other.toBytes() : other;
          if (publicKey.length !== otherBytes.length) return false;
          return publicKey.every((b, i) => b === otherBytes[i]);
        },
      };
      return { publicKey: legacyProvider.publicKey };
    },

    disconnect: async () => {
      await sendToBackground("disconnect");
      legacyProvider.isConnected = false;
      legacyProvider.publicKey = null;
    },

    signTransaction: async (transaction) => {
      // Serialize the transaction, sign, and return
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const result = await sendToBackground("signTransaction", {
        transaction: Array.from(serialized),
      });
      // Add signature to the transaction
      const signature = new Uint8Array(result.signature);
      const pubkey = new Uint8Array(result.publicKey);
      transaction.addSignature(
        { toBytes: () => pubkey, toBase58: () => bs58encode(pubkey) },
        Buffer.from(signature),
      );
      return transaction;
    },

    signAllTransactions: async (transactions) => {
      const serialized = transactions.map((tx) =>
        Array.from(
          tx.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        ),
      );
      const result = await sendToBackground("signAllTransactions", {
        transactions: serialized,
      });
      result.signatures.forEach((sig, i) => {
        const signature = new Uint8Array(sig);
        const pubkey = new Uint8Array(result.publicKey);
        transactions[i].addSignature(
          { toBytes: () => pubkey, toBase58: () => bs58encode(pubkey) },
          Buffer.from(signature),
        );
      });
      return transactions;
    },

    signMessage: async (message) => {
      const msgBytes =
        message instanceof Uint8Array
          ? message
          : new TextEncoder().encode(message);
      const result = await sendToBackground("signMessage", {
        message: Array.from(msgBytes),
      });
      return {
        signature: new Uint8Array(result.signature),
        publicKey: legacyProvider.publicKey,
      };
    },

    on: (event, callback) => {
      // Basic event emitter for connect/disconnect
      return legacyProvider;
    },

    off: (event, callback) => {
      return legacyProvider;
    },
  };

  // Expose on window
  Object.defineProperty(window, "superWallet", {
    value: legacyProvider,
    writable: false,
    configurable: false,
  });

  // Register with Wallet Standard (this is what makes it appear in wallet-adapter)
  registerWallet(walletInstance);

  console.log("[SuperWallet] ✅ Wallet registered with Wallet Standard");
})();
