import * as fs from "fs/promises";
import * as path from "path";

const LOG_PATH = path.join(__dirname, "..", ".activity-log.json");

export interface ActivityEntry {
  id: number;
  type: "decision" | "approval" | "rejection" | "link" | "mcp";
  action: string;
  reasoning: string;
  confidence?: number;
  riskLevel?: string;
  allocations?: { symbol: string; allocationBps: number }[];
  txHash?: string | null;
  source: "agent" | "telegram" | "mcp" | "dashboard";
  timestamp: number;
}

// In-memory cache to avoid reading from disk on every call
let logCache: ActivityEntry[] | null = null;

async function readLog(): Promise<ActivityEntry[]> {
  if (logCache) return logCache;
  try {
    const data = await fs.readFile(LOG_PATH, "utf-8");
    logCache = JSON.parse(data);
    return logCache!;
  } catch {
    logCache = [];
    return [];
  }
}

async function writeLog(entries: ActivityEntry[]): Promise<void> {
  // Keep last 100 entries
  const trimmed = entries.slice(-100);
  logCache = trimmed;
  await fs.writeFile(LOG_PATH, JSON.stringify(trimmed, null, 2));
}

export function logActivity(entry: Omit<ActivityEntry, "id" | "timestamp">): void {
  // Fire-and-forget async write to avoid blocking the agent loop
  _logAsync(entry).catch((err) =>
    console.warn("[ActivityLog] Write failed:", err.message)
  );
}

async function _logAsync(entry: Omit<ActivityEntry, "id" | "timestamp">): Promise<void> {
  const log = await readLog();
  const newEntry: ActivityEntry = {
    ...entry,
    id: log.length + 1,
    timestamp: Date.now(),
  };
  log.push(newEntry);
  await writeLog(log);
}

export async function getRecentActivity(limit = 20): Promise<ActivityEntry[]> {
  const log = await readLog();
  return log.slice(-limit).reverse();
}
