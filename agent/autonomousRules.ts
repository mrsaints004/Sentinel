import { loadUserFileSync, saveUserFileSync } from "./userStore";

const RULES_FILE = "autonomous-rules.json";

export interface AutonomousRules {
  enabled: boolean;
  maxPortfolioChangeBps: number;  // max single-asset change per trade (e.g. 2000 = 20%)
  maxDailyTrades: number;
  allowedAssets: string[];
  riskProfile: "conservative" | "moderate" | "aggressive";
  maxRiskScore: number;           // won't execute if risk score exceeds this
  minConfidence: number;          // won't execute if AI confidence below this (0-100)
}

export interface TradeCheck {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  violations: string[];
}

const DEFAULT_RULES: AutonomousRules = {
  enabled: false,
  maxPortfolioChangeBps: 2000,    // 20%
  maxDailyTrades: 3,
  allowedAssets: ["USDY", "mETH", "USDC"],
  riskProfile: "moderate",
  maxRiskScore: 7,
  minConfidence: 60,
};

// Per-user daily trade counter (in-memory, resets on restart)
const userTradesToday: Map<string, { count: number; date: string }> = new Map();

function getUTCDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getUserTradesToday(wallet: string): number {
  const today = getUTCDateString();
  const entry = userTradesToday.get(wallet.toLowerCase());
  if (!entry || entry.date !== today) return 0;
  return entry.count;
}

function incrementUserTrades(wallet: string): void {
  const today = getUTCDateString();
  const key = wallet.toLowerCase();
  const entry = userTradesToday.get(key);
  if (!entry || entry.date !== today) {
    userTradesToday.set(key, { count: 1, date: today });
  } else {
    entry.count++;
  }
}

export function getRules(wallet: string): AutonomousRules {
  const data = loadUserFileSync<Partial<AutonomousRules>>(wallet, RULES_FILE, {});
  return { ...DEFAULT_RULES, ...data };
}

export function setRules(wallet: string, update: Partial<AutonomousRules>): AutonomousRules {
  const rules = getRules(wallet);
  const updated = { ...rules, ...update };
  saveUserFileSync(wallet, RULES_FILE, updated);
  return updated;
}

export function enableAutonomous(wallet: string, enabled: boolean): AutonomousRules {
  return setRules(wallet, { enabled });
}

export function checkTrade(
  wallet: string,
  decision: {
    action: string;
    confidence: number;
    riskLevel: string;
    newAllocations: { symbol: string; allocationBps: number }[];
  },
  currentAllocations: { symbol: string; allocationBps: number }[],
  riskScore: number
): TradeCheck {
  const rules = getRules(wallet);
  const tradesToday = getUserTradesToday(wallet);

  if (!rules.enabled) {
    return {
      allowed: false,
      reason: "Autonomous mode is disabled. Approval required.",
      requiresApproval: true,
      violations: [],
    };
  }

  // Hold decisions always pass
  if (decision.action === "hold") {
    return {
      allowed: true,
      reason: "Hold decision — no trade needed.",
      requiresApproval: false,
      violations: [],
    };
  }

  const violations: string[] = [];

  // Check 1: Daily trade limit
  if (tradesToday >= rules.maxDailyTrades) {
    violations.push(
      `Daily trade limit reached (${tradesToday}/${rules.maxDailyTrades})`
    );
  }

  // Check 2: Max portfolio change per asset
  for (const newAlloc of decision.newAllocations) {
    const current = currentAllocations.find((c) => c.symbol === newAlloc.symbol);
    const currentBps = current?.allocationBps ?? 3333;
    const delta = Math.abs(newAlloc.allocationBps - currentBps);

    if (delta > rules.maxPortfolioChangeBps) {
      violations.push(
        `${newAlloc.symbol} change ${(delta / 100).toFixed(0)}% exceeds max ${(rules.maxPortfolioChangeBps / 100).toFixed(0)}%`
      );
    }
  }

  // Check 3: Allowed assets only
  for (const alloc of decision.newAllocations) {
    if (!rules.allowedAssets.includes(alloc.symbol)) {
      violations.push(`${alloc.symbol} is not in allowed assets list`);
    }
  }

  // Check 4: Risk score limit
  if (riskScore > rules.maxRiskScore) {
    violations.push(
      `Risk score ${riskScore.toFixed(1)} exceeds max ${rules.maxRiskScore}`
    );
  }

  // Check 5: Minimum confidence
  if (decision.confidence < rules.minConfidence) {
    violations.push(
      `Confidence ${decision.confidence}% below minimum ${rules.minConfidence}%`
    );
  }

  // Emergency withdrawals always require approval unless risk is critical
  if (decision.action === "emergency_withdraw" && riskScore < 9) {
    violations.push("Emergency withdrawals require manual approval");
  }

  if (violations.length > 0) {
    return {
      allowed: false,
      reason: `Trade exceeds autonomous limits: ${violations.join("; ")}`,
      requiresApproval: true,
      violations,
    };
  }

  // All checks passed — trade is allowed
  incrementUserTrades(wallet);
  return {
    allowed: true,
    reason: `Trade within autonomous limits. (${tradesToday + 1}/${rules.maxDailyTrades} daily trades used)`,
    requiresApproval: false,
    violations: [],
  };
}

export function getTradesToday(wallet: string): number {
  return getUserTradesToday(wallet);
}

export function formatRules(wallet: string): string {
  const rules = getRules(wallet);
  return [
    `Autonomous Mode: ${rules.enabled ? "ENABLED" : "DISABLED"}`,
    `Max Portfolio Change: ${(rules.maxPortfolioChangeBps / 100).toFixed(0)}% per asset`,
    `Max Daily Trades: ${rules.maxDailyTrades}`,
    `Allowed Assets: ${rules.allowedAssets.join(", ")}`,
    `Risk Profile: ${rules.riskProfile}`,
    `Max Risk Score: ${rules.maxRiskScore}/10`,
    `Min Confidence: ${rules.minConfidence}%`,
  ].join("\n");
}
