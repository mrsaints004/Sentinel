"use client";

import { useEffect, useState } from "react";

interface Decision {
  id: number;
  action: string;
  reasoning: string;
  oldAllocations?: number[];
  newAllocations?: number[];
  assetNames?: string[];
  timestamp: number;
  portfolioValueUSD?: number;
  riskLevel?: string;
  commitHash?: string;
  verified?: boolean;
}

interface Activity {
  id: number;
  type: string;
  action: string;
  reasoning: string;
  confidence?: number;
  riskLevel?: string;
  allocations?: { symbol: string; allocationBps: number }[];
  txHash?: string | null;
  source: string;
  timestamp: number;
}

function RiskBadge({ level }: { level: string }) {
  const cls: Record<string, string> = {
    low: "badge-low",
    medium: "badge-medium",
    high: "badge-high",
    critical: "badge-critical",
  };
  return <span className={cls[level] || cls.low}>{level}</span>;
}

function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, string> = {
    rebalance: "bg-s-accent-light text-s-accent",
    hold: "bg-gray-100 text-gray-500",
    emergency_withdraw: "bg-red-50 text-red-600",
  };
  const labels: Record<string, string> = {
    rebalance: "Rebalance",
    hold: "Hold",
    emergency_withdraw: "Emergency",
  };
  return (
    <span className={`badge ${styles[action] || styles.hold}`}>
      {labels[action] || action}
    </span>
  );
}

function VerifiedBadge({ verified, hasCommit }: { verified?: boolean; hasCommit: boolean }) {
  if (!hasCommit) return null;
  if (verified) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
        </svg>
        Verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600">
      Unverified
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, string> = {
    agent: "bg-indigo-50 text-indigo-600",
    telegram: "bg-blue-50 text-blue-600",
    mcp: "bg-violet-50 text-violet-600",
    dashboard: "bg-teal-50 text-teal-600",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[source] || styles.agent}`}>
      {source}
    </span>
  );
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function DecisionLog({ decisions }: { decisions: Decision[] }) {
  const [activity, setActivity] = useState<Activity[]>([]);

  useEffect(() => {
    async function fetchActivity() {
      try {
        const res = await fetch("/api/activity");
        const data = await res.json();
        if (Array.isArray(data)) setActivity(data);
      } catch {
        // Activity API unavailable — skip
      }
    }
    fetchActivity();
    const interval = setInterval(fetchActivity, 15000);
    return () => clearInterval(interval);
  }, []);

  // Merge on-chain decisions with local activity log
  const hasOnChain = decisions.length > 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-s-text">Decision Log</h2>
        <span className="text-xs text-s-text-muted">
          {hasOnChain ? `${decisions.length} on-chain` : `${activity.length} recorded`}
        </span>
      </div>
      <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
        {/* Show on-chain decisions if available */}
        {hasOnChain && decisions.map((d, idx) => (
          <div
            key={`chain-${d.id}`}
            className="decision-entry rounded-xl border border-s-border p-4 hover:border-s-border-hover hover:shadow-sm transition-all"
            style={{ animationDelay: `${idx * 60}ms` }}
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs font-mono text-s-text-muted">#{d.id}</span>
              <ActionBadge action={d.action} />
              {d.riskLevel && <RiskBadge level={d.riskLevel} />}
              <SourceBadge source="agent" />
              <VerifiedBadge verified={d.verified} hasCommit={!!d.commitHash && d.commitHash !== "0x0000000000000000000000000000000000000000000000000000000000000000"} />
              <span className="text-[11px] text-s-text-muted ml-auto">{timeAgo(d.timestamp)}</span>
            </div>
            <p className="text-[13px] text-s-text-secondary leading-relaxed mb-3">
              {d.reasoning}
            </p>
            {d.action !== "hold" && d.assetNames && d.oldAllocations && d.newAllocations && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 pt-2 border-t border-gray-100">
                {d.assetNames.map((name, i) => {
                  const oldPct = (d.oldAllocations![i] || 0) / 100;
                  const newPct = (d.newAllocations![i] || 0) / 100;
                  const delta = newPct - oldPct;
                  return (
                    <div key={name} className="flex items-center gap-1.5 text-xs">
                      <span className="font-medium text-s-text">{name}</span>
                      <span className="text-s-text-muted">{oldPct.toFixed(0)}%</span>
                      <span className="text-s-text-muted">&#8594;</span>
                      <span className="font-semibold text-s-text">{newPct.toFixed(0)}%</span>
                      {delta !== 0 && (
                        <span className={`font-medium ${delta > 0 ? "text-s-green" : "text-s-red"}`}>
                          {delta > 0 ? "+" : ""}{delta.toFixed(0)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {/* Show activity log (always, or as primary when no on-chain data) */}
        {activity.map((a, idx) => (
          <div
            key={`act-${a.id}`}
            className="decision-entry rounded-xl border border-s-border p-4 hover:border-s-border-hover hover:shadow-sm transition-all"
            style={{ animationDelay: `${(decisions.length + idx) * 60}ms` }}
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs font-mono text-s-text-muted">#{a.id}</span>
              <ActionBadge action={a.action} />
              {a.riskLevel && <RiskBadge level={a.riskLevel} />}
              <SourceBadge source={a.source} />
              {a.confidence && (
                <span className="text-[10px] text-s-text-muted">{a.confidence}% conf</span>
              )}
              <span className="text-[11px] text-s-text-muted ml-auto">{timeAgo(a.timestamp)}</span>
            </div>
            <p className="text-[13px] text-s-text-secondary leading-relaxed mb-2">
              {a.reasoning}
            </p>
            {a.allocations && a.allocations.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t border-gray-100">
                {a.allocations.map((alloc) => (
                  <div key={alloc.symbol} className="flex items-center gap-1 text-xs">
                    <span className="font-medium text-s-text">{alloc.symbol}</span>
                    <span className="text-s-accent font-semibold">{(alloc.allocationBps / 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
            {a.txHash && (
              <a
                href={`https://mantlescan.xyz/tx/${a.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-[11px] text-s-accent hover:underline"
              >
                View TX
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                </svg>
              </a>
            )}
          </div>
        ))}

        {/* Empty state */}
        {!hasOnChain && activity.length === 0 && (
          <div className="text-center py-8 text-s-text-muted text-xs">
            No decisions yet. The agent will log activity here once it runs.
          </div>
        )}
      </div>
    </div>
  );
}
