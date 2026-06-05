import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getWalletFromQuery } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = getWalletFromQuery(request);

  if (wallet) {
    // Per-user activity log
    const userLogPath = path.resolve(process.cwd(), "..", "data", wallet.toLowerCase(), "activity-log.json");
    try {
      if (fs.existsSync(userLogPath)) {
        const data = JSON.parse(fs.readFileSync(userLogPath, "utf-8"));
        const recent = Array.isArray(data) ? data.slice(-20).reverse() : [];
        return NextResponse.json(recent);
      }
    } catch {}
  }

  // Fallback to global log (legacy)
  const globalLogPath = path.resolve(process.cwd(), "..", ".activity-log.json");
  try {
    if (fs.existsSync(globalLogPath)) {
      const data = JSON.parse(fs.readFileSync(globalLogPath, "utf-8"));
      const recent = Array.isArray(data) ? data.slice(-20).reverse() : [];
      return NextResponse.json(recent);
    }
  } catch {}
  return NextResponse.json([]);
}
