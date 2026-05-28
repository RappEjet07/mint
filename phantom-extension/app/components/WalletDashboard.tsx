"use client";

import dynamic from "next/dynamic";
import React from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

// Dynamically import wallet button to avoid SSR issues
const WalletMultiButtonDynamic = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

const WalletDisconnectButtonDynamic = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletDisconnectButton,
  { ssr: false },
);

export default function WalletDashboard() {
  const { publicKey, connected, signMessage, wallet, connecting } = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = React.useState<number | null>(null);
  const [signResult, setSignResult] = React.useState<string>("");
  const [airdropStatus, setAirdropStatus] = React.useState<string>("");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (publicKey) {
      connection
        .getBalance(publicKey)
        .then((bal) => {
          setBalance(bal / LAMPORTS_PER_SOL);
        })
        .catch(() => setBalance(null));
    } else {
      setBalance(null);
    }
  }, [publicKey, connection]);

  const handleSignMessage = async () => {
    if (!signMessage || !publicKey) return;
    try {
      const message = new TextEncoder().encode(
        "Hello from SuperWallet test! 🚀",
      );
      const signature = await signMessage(message);
      setSignResult(
        `✅ Signed! Signature: ${Buffer.from(signature).toString("hex").slice(0, 32)}...`,
      );
    } catch (err: any) {
      setSignResult(`❌ Error: ${err.message}`);
    }
  };

  const handleAirdrop = async () => {
    if (!publicKey) return;
    setAirdropStatus("Requesting...");
    try {
      const sig = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      setAirdropStatus("✅ 1 SOL airdropped!");
      const bal = await connection.getBalance(publicKey);
      setBalance(bal / LAMPORTS_PER_SOL);
    } catch (err: any) {
      setAirdropStatus(`❌ ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Decorative gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3">
            <span className="bg-linear-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
              SuperWallet
            </span>{" "}
            Test dApp
          </h1>
          <p className="text-gray-400 text-lg">
            Test your wallet extension with the Solana Wallet Adapter
          </p>
        </div>

        {/* Wallet Connect Button */}
        <div className="flex justify-center gap-4 mb-10">
          <WalletMultiButtonDynamic className="bg-linear-to-r! from-purple-600! to-blue-600! rounded-xl! px-6! py-3! text-sm! font-semibold! hover:opacity-90! transition-all!" />
          {connected && (
            <WalletDisconnectButtonDynamic className="bg-white/5! border! border-white/10! rounded-xl! px-6! py-3! text-sm! font-semibold! hover:bg-white/10! transition-all!" />
          )}
        </div>

        {/* Connection Status */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Connection Status
          </h2>
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                connected
                  ? "bg-green-400 shadow-green-400/50 shadow-lg"
                  : connecting
                    ? "bg-yellow-400 animate-pulse"
                    : "bg-gray-600"
              }`}
            />
            <span className="text-lg font-medium">
              {connected
                ? "Connected"
                : connecting
                  ? "Connecting..."
                  : "Not Connected"}
            </span>
          </div>
          {mounted && wallet && (
            <p className="text-sm text-gray-500 mt-2">
              via{" "}
              <span className="text-purple-400 font-medium">
                {wallet.adapter.name}
              </span>
            </p>
          )}
        </div>

        {/* Setup reminder when not connected */}
        {!connected && !connecting && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 mb-6">
            <div className="flex gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="text-amber-300 font-medium text-sm mb-1">
                  Before connecting
                </p>
                <p className="text-amber-200/60 text-sm leading-relaxed">
                  Make sure you&apos;ve opened the SuperWallet extension popup
                  and either
                  <strong> imported a private key</strong> or{" "}
                  <strong>generated a new wallet</strong>. The wallet won&apos;t
                  connect if no key is set up.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Account Info */}
        {connected && publicKey && (
          <>
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 mb-6">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                Account
              </h2>
              <div className="mb-4">
                <label className="text-xs text-gray-500 block mb-1">
                  Address
                </label>
                <p className="font-mono text-sm text-gray-200 break-all bg-black/30 rounded-lg p-3">
                  {publicKey.toBase58()}
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  Balance
                </label>
                <p className="text-2xl font-bold">
                  {balance !== null
                    ? `${balance.toFixed(4)} SOL`
                    : "Loading..."}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 mb-6">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                Test Actions
              </h2>
              <div className="space-y-4">
                <div>
                  <button
                    onClick={handleAirdrop}
                    className="w-full py-3 px-4 bg-linear-to-r from-purple-600 to-blue-600 rounded-xl font-semibold text-sm hover:opacity-90 transition-all"
                  >
                    🪂 Request Airdrop (1 SOL)
                  </button>
                  {airdropStatus && (
                    <p className="text-sm text-gray-400 mt-2">
                      {airdropStatus}
                    </p>
                  )}
                </div>

                <div>
                  <button
                    onClick={handleSignMessage}
                    className="w-full py-3 px-4 bg-white/10 border border-white/10 rounded-xl font-semibold text-sm hover:bg-white/15 transition-all"
                  >
                    ✍️ Sign Message
                  </button>
                  {signResult && (
                    <p className="text-sm text-gray-400 mt-2 break-all">
                      {signResult}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Info */}
        <div className="bg-white/2 border border-white/5 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            How It Works
          </h2>
          <ol className="text-sm text-gray-500 space-y-2 list-decimal list-inside">
            <li>
              Load the <code className="text-purple-400">extension/</code>{" "}
              folder in{" "}
              <code className="text-purple-400">chrome://extensions</code>
            </li>
            <li>
              Open the extension popup →{" "}
              <strong className="text-gray-300">Import a private key</strong> or{" "}
              <strong className="text-gray-300">Generate a new wallet</strong>
            </li>
            <li>SuperWallet registers via the Wallet Standard protocol</li>
            <li>The wallet-adapter automatically detects it (like Phantom!)</li>
            <li>
              Click &quot;Select Wallet&quot; above — you&apos;ll see
              SuperWallet in the list
            </li>
          </ol>
        </div>

        <p className="text-center text-gray-700 text-xs mt-8">
          SuperWallet v1.0.0 — Wallet Standard Compatible
        </p>
      </div>
    </div>
  );
}
