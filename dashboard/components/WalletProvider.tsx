"use client";

import { useState, useCallback, useEffect } from "react";

interface WalletState {
  address: string | null;
  isConnected: boolean;
  chainId: number | null;
  chainName: string;
  balance: string;
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    isConnected: false,
    chainId: null,
    chainName: "",
    balance: "0",
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasProvider, setHasProvider] = useState(false);

  // Detect provider on mount
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).ethereum) {
      setHasProvider(true);

      // Listen for account changes
      (window as any).ethereum.on("accountsChanged", (accounts: string[]) => {
        if (accounts.length === 0) {
          setWallet({ address: null, isConnected: false, chainId: null, chainName: "", balance: "0" });
        } else {
          refreshWallet(accounts[0]);
        }
      });

      // Listen for chain changes
      (window as any).ethereum.on("chainChanged", () => {
        window.location.reload();
      });

      // Check if already connected
      (window as any).ethereum
        .request({ method: "eth_accounts" })
        .then((accounts: string[]) => {
          if (accounts.length > 0) {
            refreshWallet(accounts[0]);
          }
        })
        .catch(() => {});
    }
  }, []);

  async function refreshWallet(address: string) {
    try {
      const eth = (window as any).ethereum;
      const chainId = await eth.request({ method: "eth_chainId" });
      const balance = await eth.request({
        method: "eth_getBalance",
        params: [address, "latest"],
      });

      const chainIdNum = parseInt(chainId, 16);
      let chainName = "Unknown";
      if (chainIdNum === 5000) chainName = "Mantle";
      else if (chainIdNum === 1) chainName = "Ethereum";
      else chainName = `Chain ${chainIdNum}`;

      setWallet({
        address,
        isConnected: true,
        chainId: chainIdNum,
        chainName,
        balance: (parseInt(balance, 16) / 1e18).toFixed(4),
      });
      setError(null);
    } catch (err) {
      console.error("Failed to refresh wallet:", err);
    }
  }

  const connect = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      const eth = (window as any).ethereum;

      if (!eth) {
        setError("Install MetaMask to deposit funds.");
        setIsConnecting(false);
        return;
      }

      // Request accounts
      const accounts = await eth.request({ method: "eth_requestAccounts" });

      if (!accounts || accounts.length === 0) {
        setError("No accounts returned. Please unlock your wallet.");
        setIsConnecting(false);
        return;
      }

      // Switch to Mantle Mainnet
      try {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x1388" }], // 5000
        });
      } catch (switchError: any) {
        // Chain not added — add it
        if (switchError.code === 4902) {
          try {
            await eth.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0x1388",
                  chainName: "Mantle",
                  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
                  rpcUrls: ["https://rpc.mantle.xyz"],
                  blockExplorerUrls: ["https://mantlescan.xyz"],
                },
              ],
            });
          } catch (addError) {
            console.error("Failed to add Mantle network:", addError);
          }
        }
      }

      // Refresh wallet state
      await refreshWallet(accounts[0]);
    } catch (err: any) {
      if (err.code === 4001) {
        setError("Connection rejected. Please try again.");
      } else {
        setError("Failed to connect wallet. Please try again.");
        console.error("Wallet connection error:", err);
      }
    }

    setIsConnecting(false);
  }, []);

  const disconnect = useCallback(() => {
    setWallet({ address: null, isConnected: false, chainId: null, chainName: "", balance: "0" });
    setError(null);
  }, []);

  return { ...wallet, connect, disconnect, isConnecting, error, hasProvider };
}

export function ConnectButton({
  address,
  isConnected,
  isConnecting,
  balance,
  chainName,
  chainId,
  error,
  hasProvider,
  onConnect,
  onDisconnect,
}: {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  balance: string;
  chainName?: string;
  chainId?: number | null;
  error?: string | null;
  hasProvider?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (isConnected && address) {
    const isMantle = chainId === 5000;
    return (
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
          isMantle
            ? "bg-s-teal-light border-teal-200 text-s-teal"
            : "bg-s-yellow-light border-yellow-200 text-s-yellow"
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${isMantle ? "bg-s-teal" : "bg-s-yellow"}`} />
          {chainName || "Unknown"}
        </div>
        <button
          onClick={onDisconnect}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-s-border bg-white hover:bg-gray-50 transition-colors"
        >
          <div className="w-5 h-5 rounded-full bg-s-accent flex items-center justify-center text-[9px] font-bold text-white">
            {address.slice(2, 4).toUpperCase()}
          </div>
          <span className="text-xs font-medium text-s-text">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
          <span className="text-xs text-s-text-muted">{balance} MNT</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {!hasProvider ? (
        <a
          href="https://metamask.io/download/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-s-border bg-white hover:bg-gray-50 transition-colors text-xs text-s-text-muted"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
          </svg>
          Connect Wallet
        </a>
      ) : (
        <button onClick={onConnect} disabled={isConnecting} className="btn-primary">
          {isConnecting ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Connecting...
            </span>
          ) : (
            "Connect Wallet"
          )}
        </button>
      )}
    </div>
  );
}
