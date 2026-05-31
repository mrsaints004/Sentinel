import * as fs from "fs";
import * as path from "path";
import { logActivity } from "./activityLog";

const STORE_PATH = path.join(__dirname, "..", ".telegram-links.json");

interface LinkStore {
  // token -> { walletAddress, createdAt }
  pendingTokens: Record<string, { walletAddress: string; createdAt: number }>;
  // walletAddress (lowercase) -> telegramChatId
  linkedWallets: Record<string, number>;
}

function readStore(): LinkStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
    }
  } catch {}
  return { pendingTokens: {}, linkedWallets: {} };
}

function writeStore(store: LinkStore): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

/**
 * Verify a deep link token from /start payload.
 * Links the wallet to the Telegram chatId if valid.
 */
export function verifyLinkToken(token: string, chatId: number): { success: boolean; walletAddress?: string; error?: string } {
  const store = readStore();
  const trimmed = token.trim();

  const pending = store.pendingTokens[trimmed];
  if (!pending) {
    return { success: false, error: "Invalid or expired link. Try again from the dashboard." };
  }

  // Check expiry (10 minutes)
  if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
    delete store.pendingTokens[trimmed];
    writeStore(store);
    return { success: false, error: "Link expired. Generate a new one from the dashboard." };
  }

  // Link the wallet to this chat
  store.linkedWallets[pending.walletAddress] = chatId;
  delete store.pendingTokens[trimmed];
  writeStore(store);

  logActivity({
    type: "link",
    action: "link",
    reasoning: `Telegram account linked to wallet ${pending.walletAddress.slice(0, 6)}...${pending.walletAddress.slice(-4)}`,
    source: "telegram",
  });

  return { success: true, walletAddress: pending.walletAddress };
}

export function getLinkedChat(walletAddress: string): number | null {
  const store = readStore();
  return store.linkedWallets[walletAddress.toLowerCase()] || null;
}

export function isWalletLinked(walletAddress: string): boolean {
  const store = readStore();
  return !!store.linkedWallets[walletAddress.toLowerCase()];
}

export function unlinkWallet(walletAddress: string): boolean {
  const store = readStore();
  const address = walletAddress.toLowerCase();
  if (store.linkedWallets[address]) {
    delete store.linkedWallets[address];
    writeStore(store);
    return true;
  }
  return false;
}

export function getAllLinkedWallets(): Record<string, number> {
  const store = readStore();
  return store.linkedWallets;
}
