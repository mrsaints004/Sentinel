import { ethers } from "ethers";

/**
 * Verify a wallet-signed request.
 *
 * Expected headers:
 *   x-wallet-address: 0x...
 *   x-wallet-signature: 0x...
 *   x-wallet-timestamp: unix seconds
 *
 * Signature message format: "Sentinel Auth: {wallet}:{timestamp}"
 * Timestamp must be within 5 minutes to prevent replay.
 */
export function verifyWalletAuth(request: Request): string {
  const walletAddress = request.headers.get("x-wallet-address");
  const signature = request.headers.get("x-wallet-signature");
  const timestamp = request.headers.get("x-wallet-timestamp");

  if (!walletAddress || !signature || !timestamp) {
    throw new AuthError("Missing authentication headers", 401);
  }

  // Validate address format
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    throw new AuthError("Invalid wallet address", 401);
  }

  // Check timestamp freshness (5 minute window)
  const ts = parseInt(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    throw new AuthError("Signature expired or invalid timestamp", 401);
  }

  // Verify signature
  const message = `Sentinel Auth: ${walletAddress}:${timestamp}`;
  try {
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new AuthError("Signature verification failed", 401);
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("Invalid signature", 401);
  }

  return walletAddress.toLowerCase();
}

/**
 * Extract wallet from query params (for GET requests - no auth required).
 */
export function getWalletFromQuery(request: Request): string | null {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return null;
  return wallet.toLowerCase();
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "AuthError";
  }
}
