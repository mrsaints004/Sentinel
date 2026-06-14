import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";

const DATA_ROOT = path.join(__dirname, "..", "data");

/**
 * Per-user file-based persistence.
 * Each user's data lives in data/{walletAddress}/.
 */

export function getUserDir(wallet: string): string {
  const dir = path.join(DATA_ROOT, wallet.toLowerCase());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function loadUserFileSync<T>(wallet: string, filename: string, fallback: T): T {
  try {
    const filePath = path.join(getUserDir(wallet), filename);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
    // File doesn't exist or is invalid JSON — use fallback
  }
  return fallback;
}

export function saveUserFileSync(wallet: string, filename: string, data: unknown): void {
  try {
    const filePath = path.join(getUserDir(wallet), filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`[UserStore] Failed to save ${filename} for ${wallet}:`, (err as Error).message);
  }
}

export async function loadUserFile<T>(wallet: string, filename: string, fallback: T): Promise<T> {
  try {
    const filePath = path.join(getUserDir(wallet), filename);
    const data = await fsp.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    // File doesn't exist or is invalid JSON — use fallback
  }
  return fallback;
}

export async function saveUserFile(wallet: string, filename: string, data: unknown): Promise<void> {
  try {
    const filePath = path.join(getUserDir(wallet), filename);
    getUserDir(wallet); // ensure dir exists
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`[UserStore] Failed to save ${filename} for ${wallet}:`, (err as Error).message);
  }
}

/**
 * List all wallet directories in the data root.
 */
export function getAllUserWallets(): string[] {
  try {
    if (!fs.existsSync(DATA_ROOT)) return [];
    return fs.readdirSync(DATA_ROOT).filter((name) => name.startsWith("0x"));
  } catch {
    return [];
  }
}

// Moves global data files into a user's directory (one-time migration on first run)
export function migrateGlobalToUser(wallet: string): void {
  const projectRoot = path.join(__dirname, "..");
  const globalFiles = [
    { global: ".dca-plans.json", user: "dca-plans.json" },
    { global: ".scheduled-tasks.json", user: "scheduled-tasks.json" },
    { global: ".autonomous-rules.json", user: "autonomous-rules.json" },
    { global: ".activity-log.json", user: "activity-log.json" },
  ];

  const userDir = getUserDir(wallet);

  for (const { global: globalName, user: userName } of globalFiles) {
    const globalPath = path.join(projectRoot, globalName);
    const userPath = path.join(userDir, userName);

    if (fs.existsSync(globalPath) && !fs.existsSync(userPath)) {
      try {
        fs.copyFileSync(globalPath, userPath);
        console.log(`[Migration] Copied ${globalName} -> data/${wallet}/${userName}`);
      } catch (err) {
        console.warn(`[Migration] Failed to copy ${globalName}:`, (err as Error).message);
      }
    }
  }
}
