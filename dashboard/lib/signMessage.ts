"use client";

import { useCallback } from "react";

/**
 * Hook that wraps fetch with wallet signature headers.
 * Used by dashboard components for authenticated POST requests.
 *
 * Usage:
 *   const signedFetch = useSignedFetch();
 *   await signedFetch("/api/dca", { method: "POST", body: JSON.stringify(data) });
 */
export function useSignedFetch() {
  return useCallback(async (url: string, init?: RequestInit): Promise<Response> => {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No wallet provider found");

    const provider = await import("ethers").then(m => new m.BrowserProvider(eth));
    const signer = await provider.getSigner();
    const walletAddress = await signer.getAddress();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `Sentinel Auth: ${walletAddress}:${timestamp}`;
    const signature = await signer.signMessage(message);

    const headers = new Headers(init?.headers);
    headers.set("x-wallet-address", walletAddress);
    headers.set("x-wallet-signature", signature);
    headers.set("x-wallet-timestamp", timestamp);
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }

    return fetch(url, { ...init, headers });
  }, []);
}

/**
 * Helper for GET requests with wallet scoping (no auth needed for reads).
 */
export function walletFetch(url: string, walletAddress: string): Promise<Response> {
  const separator = url.includes("?") ? "&" : "?";
  return fetch(`${url}${separator}wallet=${walletAddress}`);
}
