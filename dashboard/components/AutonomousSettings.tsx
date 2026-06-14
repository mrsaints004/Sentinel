"use client";

import { useState, useEffect } from "react";

interface AutonomousRules {
  enabled: boolean;
  maxPortfolioChangeBps: number;
  maxDailyTrades: number;
  allowedAssets: string[];
  riskProfile: "conservative" | "moderate" | "aggressive";
  maxRiskScore: number;
  minConfidence: number;
  tradesToday?: number;
}

export default function AutonomousSettings() {
  const [rules, setRules] = useState<AutonomousRules>({
    enabled: true,
    maxPortfolioChangeBps: 1500,
    maxDailyTrades: 3,
    allowedAssets: ["USDY", "mETH", "USDC"],
    riskProfile: "moderate",
    maxRiskScore: 5,
    minConfidence: 70,
    tradesToday: 0,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/autonomous")
      .then((r) => r.json())
      .then((data) => {
        const { pendingApproval, ...rulesData } = data;
        setRules((prev) => ({ ...prev, ...rulesData }));
      })
      .catch(() => {});
  }, []);

  async function saveRules(update: Partial<AutonomousRules>) {
    setSaving(true);
    const newRules = { ...rules, ...update };
    setRules(newRules);
    try {
      await fetch("/api/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // failed to save settings
    }
    setSaving(false);
  }

  const allAssets = ["USDY", "mETH", "USDC"];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-s-text">Autonomous Mode</h2>
          <p className="text-[11px] text-s-text-muted mt-0.5">
            Set rules and let the AI execute within limits
          </p>
        </div>
        <button
          onClick={() => saveRules({ enabled: !rules.enabled })}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            rules.enabled ? "bg-s-accent" : "bg-gray-200"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              rules.enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {rules.enabled && (
        <div className="space-y-4">
          {/* Status bar */}
          <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 rounded-xl">
            <div className="w-2 h-2 rounded-full bg-s-accent animate-pulse" />
            <span className="text-xs font-medium text-s-accent">
              Active — {rules.tradesToday ?? 0}/{rules.maxDailyTrades} trades today
            </span>
          </div>

          {/* Max Portfolio Change */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-s-text-muted">Max Change Per Asset</label>
              <span className="text-xs font-semibold text-s-text">
                {(rules.maxPortfolioChangeBps / 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min={500}
              max={5000}
              step={500}
              value={rules.maxPortfolioChangeBps}
              onChange={(e) =>
                saveRules({ maxPortfolioChangeBps: parseInt(e.target.value) })
              }
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-s-accent"
            />
            <div className="flex justify-between text-[10px] text-s-text-muted mt-1">
              <span>5%</span>
              <span>50%</span>
            </div>
          </div>

          {/* Max Daily Trades */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-s-text-muted">Max Daily Trades</label>
              <span className="text-xs font-semibold text-s-text">{rules.maxDailyTrades}</span>
            </div>
            <div className="flex gap-2">
              {[1, 2, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => saveRules({ maxDailyTrades: n })}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    rules.maxDailyTrades === n
                      ? "bg-s-accent text-white"
                      : "bg-gray-100 text-s-text-muted hover:bg-gray-200"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Allowed Assets */}
          <div>
            <label className="text-xs text-s-text-muted block mb-1.5">Allowed Assets</label>
            <div className="flex gap-2">
              {allAssets.map((asset) => {
                const isAllowed = rules.allowedAssets.includes(asset);
                return (
                  <button
                    key={asset}
                    onClick={() => {
                      const newAssets = isAllowed
                        ? rules.allowedAssets.filter((a) => a !== asset)
                        : [...rules.allowedAssets, asset];
                      if (newAssets.length > 0) saveRules({ allowedAssets: newAssets });
                    }}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                      isAllowed
                        ? "bg-s-accent/10 border-s-accent text-s-accent"
                        : "bg-white border-s-border text-s-text-muted hover:border-gray-300"
                    }`}
                  >
                    {isAllowed ? "✓ " : ""}
                    {asset}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Min Confidence */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-s-text-muted">Min AI Confidence</label>
              <span className="text-xs font-semibold text-s-text">{rules.minConfidence}%</span>
            </div>
            <input
              type="range"
              min={30}
              max={95}
              step={5}
              value={rules.minConfidence}
              onChange={(e) =>
                saveRules({ minConfidence: parseInt(e.target.value) })
              }
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-s-accent"
            />
            <div className="flex justify-between text-[10px] text-s-text-muted mt-1">
              <span>30%</span>
              <span>95%</span>
            </div>
          </div>

          {/* Max Risk Score */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-s-text-muted">Max Risk Score</label>
              <span className="text-xs font-semibold text-s-text">{rules.maxRiskScore}/10</span>
            </div>
            <input
              type="range"
              min={3}
              max={10}
              step={1}
              value={rules.maxRiskScore}
              onChange={(e) =>
                saveRules({ maxRiskScore: parseInt(e.target.value) })
              }
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-s-accent"
            />
            <div className="flex justify-between text-[10px] text-s-text-muted mt-1">
              <span>3 (Safe)</span>
              <span>10 (Any)</span>
            </div>
          </div>

          {/* Saved indicator */}
          {saved && (
            <div className="flex items-center gap-1.5 text-xs text-s-green">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M5 13l4 4L19 7" />
              </svg>
              Settings saved
            </div>
          )}
        </div>
      )}

      {!rules.enabled && (
        <div className="text-center py-4">
          <p className="text-xs text-s-text-muted mb-3">
            When enabled, the AI will execute trades automatically within your configured limits.
            Trades that exceed limits will still require manual approval.
          </p>
          <button
            onClick={() => saveRules({ enabled: true })}
            className="btn-primary text-xs"
          >
            Enable Autonomous Mode
          </button>
        </div>
      )}
    </div>
  );
}
