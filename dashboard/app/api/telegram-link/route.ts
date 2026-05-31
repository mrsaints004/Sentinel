import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve to project root (dashboard cwd is /mantle/dashboard, so go up one level)
const STORE_PATH = path.resolve(process.cwd(), "..", ".telegram-links.json");

interface LinkStore {
  pendingTokens: Record<string, { walletAddress: string; createdAt: number }>;
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

// POST: Generate a deep link token for a wallet address
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const walletAddress = body?.walletAddress;

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
    }

    const address = walletAddress.toLowerCase();
    const store = readStore();

    // Check if already linked
    if (store.linkedWallets[address]) {
      return NextResponse.json({ linked: true, chatId: store.linkedWallets[address] });
    }

    // Clean expired tokens (older than 10 minutes)
    const now = Date.now();
    for (const [token, data] of Object.entries(store.pendingTokens)) {
      if (now - data.createdAt > 10 * 60 * 1000) {
        delete store.pendingTokens[token];
      }
    }

    // Remove existing tokens for this wallet
    for (const [token, data] of Object.entries(store.pendingTokens)) {
      if (data.walletAddress === address) {
        delete store.pendingTokens[token];
      }
    }

    // Generate a token for the deep link (only a-z, A-Z, 0-9, _ allowed by Telegram)
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
    let token = "";
    for (let i = 0; i < 32; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }

    store.pendingTokens[token] = { walletAddress: address, createdAt: now };
    writeStore(store);

    return NextResponse.json({ token, expiresIn: 600 });
  } catch (err: any) {
    console.error("[telegram-link] POST error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Failed to generate token" }, { status: 500 });
  }
}

// GET: Check link status for a wallet
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("wallet");

    if (!walletAddress) {
      return NextResponse.json({ error: "wallet param required" }, { status: 400 });
    }

    const store = readStore();
    const address = walletAddress.toLowerCase();
    const chatId = store.linkedWallets[address];

    return NextResponse.json({ linked: !!chatId, chatId: chatId || null });
  } catch (err: any) {
    return NextResponse.json({ linked: false, chatId: null });
  }
}

// DELETE: Unlink a wallet
export async function DELETE(request: Request) {
  try {
    const { walletAddress } = await request.json();
    if (!walletAddress) {
      return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
    }

    const store = readStore();
    const address = walletAddress.toLowerCase();
    if (store.linkedWallets[address]) {
      delete store.linkedWallets[address];
      writeStore(store);
      return NextResponse.json({ unlinked: true });
    }

    return NextResponse.json({ unlinked: false });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to unlink" }, { status: 500 });
  }
}
