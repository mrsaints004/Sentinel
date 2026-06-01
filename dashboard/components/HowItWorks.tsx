"use client";

import { useState } from "react";

export default function HowItWorks() {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="card">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between"
      >
        <h2 className="text-sm font-semibold text-s-text">How Sentinel Works</h2>
        <svg
          className={`w-4 h-4 text-s-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-s-text-muted">
            Every 5 minutes, 4 AI agents collaborate:
          </p>
          <div className="space-y-2.5">
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px]">📊</span>
              </div>
              <div>
                <span className="text-xs font-medium text-s-text">Market Agent</span>
                <span className="text-xs text-s-text-muted"> — tracks ETH, USDY, USDC prices</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded bg-teal-50 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px]">📈</span>
              </div>
              <div>
                <span className="text-xs font-medium text-s-text">Yield Agent</span>
                <span className="text-xs text-s-text-muted"> — finds the best APY on Mantle</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded bg-red-50 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px]">🛡</span>
              </div>
              <div>
                <span className="text-xs font-medium text-s-text">Risk Agent</span>
                <span className="text-xs text-s-text-muted"> — checks for peg issues or volatility</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded bg-violet-50 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px]">🧠</span>
              </div>
              <div>
                <span className="text-xs font-medium text-s-text">Portfolio Agent</span>
                <span className="text-xs text-s-text-muted"> — decides whether to rebalance</span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-s-text-muted pt-1 border-t border-s-border">
            All decisions are logged on-chain. You stay in control with approve/reject.
          </p>
        </div>
      )}
    </div>
  );
}
