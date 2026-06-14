"use client";

import { useState, useEffect } from "react";
import { useSignedFetch, walletFetch } from "@/lib/signMessage";

interface PendingTrade {
  action: string;
  reasoning: string;
  confidence: number;
  riskLevel: string;
  currentAllocations: { symbol: string; pct: number }[];
  newAllocations: { symbol: string; pct: number }[];
  expectedYieldChange: number;
}

interface Props {
  walletAddress?: string;
}

export default function PendingApproval({ walletAddress }: Props) {
  const [trade, setTrade] = useState<PendingTrade | null>(null);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const signedFetch = useSignedFetch();

  // Poll for pending approvals from the agent
  useEffect(() => {
    if (!walletAddress) return;

    async function checkPending() {
      try {
        const res = await walletFetch("/api/autonomous", walletAddress!);
        const data = await res.json();
        if (data.pendingApproval) {
          setTrade({
            action: data.pendingApproval.action,
            reasoning: data.pendingApproval.reasoning,
            confidence: data.pendingApproval.confidence,
            riskLevel: data.pendingApproval.riskLevel || "low",
            currentAllocations: data.pendingApproval.currentAllocations || [],
            newAllocations: data.pendingApproval.newAllocations || [],
            expectedYieldChange: data.pendingApproval.expectedYieldChange || 0,
          });
          setStatus("pending");
        } else {
          setTrade(null);
        }
      } catch {
        // No pending trade available
      }
    }
    checkPending();
    const interval = setInterval(checkPending, 15000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  async function handleAction(action: "approve" | "reject") {
    setStatus(action === "approve" ? "approved" : "rejected");
    try {
      await signedFetch("/api/autonomous", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
    } catch {
      // Approval/rejection request failed
    }
  }

  if (status === "approved") {
    return (
      <div className="card border-green-200 bg-green-50/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-s-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M5 13l4 4L19 7"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-s-green">Trade Approved & Executed</p>
            <p className="text-xs text-s-text-muted">Rebalance submitted to Mantle. Decision recorded on-chain.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!trade || status !== "pending") {
    return null;
  }

  return (
    <div className="card border-amber-200 bg-amber-50/30">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-s-yellow animate-pulse" />
        <h2 className="text-sm font-semibold text-s-text">Pending Approval</h2>
        <span className="ml-auto badge bg-amber-100 text-amber-700">Awaiting</span>
      </div>

      <p className="text-[13px] text-s-text-secondary leading-relaxed mb-4">
        {trade.reasoning}
      </p>

      {trade.newAllocations.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {trade.newAllocations.map((newA) => {
            const current = trade.currentAllocations.find((c) => c.symbol === newA.symbol);
            const delta = newA.pct - (current?.pct || 0);
            return (
              <div key={newA.symbol} className="text-center p-3 rounded-xl bg-white border border-gray-200">
                <div className="text-xs text-s-text-muted mb-1">{newA.symbol}</div>
                <div className="text-sm font-semibold text-s-text">
                  {current?.pct || 0}% → {newA.pct}%
                </div>
                {delta !== 0 && (
                  <div className={`text-xs font-medium ${delta > 0 ? "text-s-green" : "text-s-red"}`}>
                    {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-s-text-muted mb-4">
        <span>Confidence: <strong className="text-s-text">{trade.confidence}%</strong></span>
        {trade.expectedYieldChange > 0 && (
          <span>Expected yield: <strong className="text-s-teal">+{trade.expectedYieldChange}%</strong></span>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => handleAction("reject")}
          className="btn-secondary flex-1"
        >
          Reject
        </button>
        <button
          onClick={() => handleAction("approve")}
          className="btn-primary flex-1"
        >
          Approve Trade
        </button>
      </div>
    </div>
  );
}
