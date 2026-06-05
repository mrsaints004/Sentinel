import { loadUserFile, saveUserFile } from "./userStore";

const LOG_FILE = "activity-log.json";

export interface ActivityEntry {
  id: number;
  type: "decision" | "approval" | "rejection" | "link" | "mcp" | "dca" | "scheduled";
  action: string;
  reasoning: string;
  confidence?: number;
  riskLevel?: string;
  allocations?: { symbol: string; allocationBps: number }[];
  txHash?: string | null;
  source: "agent" | "telegram" | "mcp" | "dashboard";
  timestamp: number;
}

// Per-user in-memory cache
const logCaches: Map<string, ActivityEntry[]> = new Map();

async function readLog(wallet: string): Promise<ActivityEntry[]> {
  const key = wallet.toLowerCase();
  const cached = logCaches.get(key);
  if (cached) return cached;
  const data = await loadUserFile<ActivityEntry[]>(key, LOG_FILE, []);
  logCaches.set(key, data);
  return data;
}

async function writeLog(wallet: string, entries: ActivityEntry[]): Promise<void> {
  const key = wallet.toLowerCase();
  const trimmed = entries.slice(-100);
  logCaches.set(key, trimmed);
  await saveUserFile(key, LOG_FILE, trimmed);
}

export function logActivity(wallet: string, entry: Omit<ActivityEntry, "id" | "timestamp">): void {
  _logAsync(wallet, entry).catch((err) =>
    console.warn("[ActivityLog] Write failed:", err.message)
  );
}

async function _logAsync(wallet: string, entry: Omit<ActivityEntry, "id" | "timestamp">): Promise<void> {
  const log = await readLog(wallet);
  const newEntry: ActivityEntry = {
    ...entry,
    id: log.length + 1,
    timestamp: Date.now(),
  };
  log.push(newEntry);
  await writeLog(wallet, log);
}

export async function getRecentActivity(wallet: string, limit = 20): Promise<ActivityEntry[]> {
  const log = await readLog(wallet);
  return log.slice(-limit).reverse();
}
