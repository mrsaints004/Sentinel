import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_PATH = path.resolve(process.cwd(), "..", ".activity-log.json");

export async function GET() {
  try {
    if (fs.existsSync(LOG_PATH)) {
      const data = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
      const recent = Array.isArray(data) ? data.slice(-20).reverse() : [];
      return NextResponse.json(recent);
    }
  } catch {}
  return NextResponse.json([]);
}
