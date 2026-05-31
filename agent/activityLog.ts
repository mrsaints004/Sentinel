import * as fs from "fs";
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

function readLog(): ActivityEntry[] {
  try {
    if (fs.existsSync(LOG_PATH)) {
      return JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
    }
  } catch {}
  return [];
}

function writeLog(entries: ActivityEntry[]): void {
  // Keep last 100 entries
  const trimmed = entries.slice(-100);
  fs.writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2));
}

export function logActivity(entry: Omit<ActivityEntry, "id" | "timestamp">): ActivityEntry {
  const log = readLog();
  const newEntry: ActivityEntry = {
    ...entry,
    id: log.length + 1,
    timestamp: Date.now(),
  };
  log.push(newEntry);
  writeLog(log);
  return newEntry;
}

export function getRecentActivity(limit = 20): ActivityEntry[] {
  const log = readLog();
  return log.slice(-limit).reverse();
}
