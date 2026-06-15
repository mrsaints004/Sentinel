"use client";

import { useState, useCallback, useEffect, createContext, useContext, ReactNode } from "react";
import { getDefaultConfig, RainbowKitProvider, ConnectButton as RKConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { WagmiProvider, useAccount, useBalance, useDisconnect, useChainId } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defineChain } from "viem";
import "@rainbow-me/rainbowkit/styles.css";

// Define Mantle chain
const mantle = defineChain({
  id: 5000,
  name: "Mantle",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mantle.xyz"] },
  },
  blockExplorers: {
    default: { name: "Mantlescan", url: "https://mantlescan.xyz" },
  },
});

// RainbowKit config
const config = getDefaultConfig({
  appName: "Sentinel AI Treasury",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "sentinel-ai-treasury",
  chains: [mantle],
  ssr: true,
});

const queryClient = new QueryClient();

// Wallet context for child components
interface WalletState {
  address: string | null;
  isConnected: boolean;
  chainId: number | null;
  chainName: string;
  balance: string;
}

interface WalletContextType extends WalletState {
  connect: () => void;
  disconnect: () => void;
  isConnecting: boolean;
  error: string | null;
  hasProvider: boolean;
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  isConnected: false,
  chainId: null,
  chainName: "",
  balance: "0",
  connect: () => {},
  disconnect: () => {},
  isConnecting: false,
  error: null,
  hasProvider: true,
});

export function useWallet() {
  return useContext(WalletContext);
}

// Internal hook that uses wagmi + RainbowKit
function WalletStateProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, isConnecting } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { data: balanceData } = useBalance({ address: address });
  const { openConnectModal } = useConnectModal();

  const chainName = chainId === 5000 ? "Mantle" : chainId ? `Chain ${chainId}` : "";
  const balance = balanceData ? parseFloat(balanceData.formatted).toFixed(4) : "0";

  const ctx: WalletContextType = {
    address: address || null,
    isConnected,
    chainId: chainId || null,
    chainName,
    balance,
    connect: () => { openConnectModal?.(); },
    disconnect: () => disconnect(),
    isConnecting,
    error: null,
    hasProvider: true,
  };

  return (
    <WalletContext.Provider value={ctx}>
      {children}
    </WalletContext.Provider>
  );
}

// Main provider that wraps the app
export function WalletProviderWrapper({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <WalletStateProvider>
            {children}
          </WalletStateProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// Re-export RainbowKit's connect button with custom styling
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
  // Use RainbowKit's ConnectButton which supports MetaMask, WalletConnect, Coinbase, etc.
  return (
    <RKConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const connected = mounted && account && chain;

        if (!mounted) {
          return <div className="h-8" />;
        }

        if (!connected) {
          return (
            <button onClick={openConnectModal} className="btn-primary">
              Connect Wallet
            </button>
          );
        }

        const isMantle = chain.id === 5000;

        return (
          <div className="flex items-center gap-2">
            <button
              onClick={openChainModal}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                isMantle
                  ? "bg-s-teal-light border-teal-200 text-s-teal"
                  : "bg-s-yellow-light border-yellow-200 text-s-yellow"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${isMantle ? "bg-s-teal" : "bg-s-yellow"}`} />
              {chain.name}
            </button>
            <button
              onClick={openAccountModal}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-s-border bg-white hover:bg-gray-50 transition-colors"
            >
              <div className="w-5 h-5 rounded-full bg-s-accent flex items-center justify-center text-[9px] font-bold text-white">
                {account.address.slice(2, 4).toUpperCase()}
              </div>
              <span className="text-xs font-medium text-s-text">
                {account.displayName}
              </span>
              <span className="text-xs text-s-text-muted">
                {account.displayBalance || ""}
              </span>
            </button>
          </div>
        );
      }}
    </RKConnectButton.Custom>
  );
}
