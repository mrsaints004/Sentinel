import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getWalletFromQuery } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_WALLET = (process.env.AGENT_WALLET_ADDRESS || "0x76f61EA62C5A8F0b38D820F66DAF546f7Fa6015c").toLowerCase();

function readActivityLog(logPath: string): unknown[] {
  try {
    if (fs.existsSync(logPath)) {
      const data = JSON.parse(fs.readFileSync(logPath, "utf-8"));
      return Array.isArray(data) ? data : [];
    }
  } catch { /* Log missing or corrupt */ }
  return [];
}

export async function GET(request: Request) {
  const wallet = getWalletFromQuery(request);
  const dataDir = path.resolve(process.cwd(), "..", "data");

  let entries: unknown[] = [];

  // Check user's own activity log
  if (wallet) {
    const userLogPath = path.join(dataDir, wallet.toLowerCase(), "activity-log.json");
    entries = readActivityLog(userLogPath);
  }

  // Also check agent wallet's activity log (agent logs under its own wallet)
  if (entries.length === 0) {
    const agentLogPath = path.join(dataDir, AGENT_WALLET, "activity-log.json");
    entries = readActivityLog(agentLogPath);
  }

  // Fallback to global activity log
  if (entries.length === 0) {
    const globalLogPath = path.resolve(process.cwd(), "..", ".activity-log.json");
    entries = readActivityLog(globalLogPath);
  }

  const recent = entries.slice(-20).reverse();
  return NextResponse.json(recent);
}
