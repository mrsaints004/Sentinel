"use client";

import { useState, useEffect } from "react";

interface CrossChainPool {
  pool: string;
  apy: number;
  risk: string;
  tvl?: number;
}

interface ByrealData {
  solanaTopYield: number;
  mantleComparison: string;
  opportunities: CrossChainPool[];
  source: string;
  lastUpdated: string;
}

export default function ByrealSkills() {
  const [data, setData] = useState<ByrealData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchByreal() {
      try {
        const res = await fetch("/api/byreal");
        const json = await res.json();
        setData(json);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchByreal();
    const interval = setInterval(fetchByreal, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">{"\u{1F517}"}</span>
          <h3 className="text-white font-semibold text-sm">Cross-Chain Intelligence</h3>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-gray-700 rounded w-3/4" />
          <div className="h-8 bg-gray-800 rounded" />
          <div className="h-8 bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  if (!data || data.opportunities.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">{"\u{1F517}"}</span>
          <h3 className="text-white font-semibold text-sm">Cross-Chain Intelligence</h3>
          <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">Byreal CLI</span>
        </div>
        <p className="text-gray-500 text-xs">Connecting to Byreal DEX...</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{"\u{1F517}"}</span>
        <h3 className="text-white font-semibold text-sm">Cross-Chain Intelligence</h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          data.source === "byreal-cli-live"
            ? "bg-green-900 text-green-300"
            : "bg-gray-700 text-gray-400"
        }`}>
          {data.source === "byreal-cli-live" ? "LIVE" : "Byreal CLI"}
        </span>
      </div>

      <p className="text-gray-400 text-xs mb-3">{data.mantleComparison}</p>

      <div className="space-y-2">
        {data.opportunities.slice(0, 4).map((opp, i) => (
          <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-white text-xs font-medium">{opp.pool}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                opp.risk === "low" ? "bg-green-900 text-green-300" :
                opp.risk === "medium" ? "bg-yellow-900 text-yellow-300" :
                "bg-red-900 text-red-300"
              }`}>
                {opp.risk}
              </span>
            </div>
            <div className="text-right">
              <span className="text-green-400 text-xs font-mono">{opp.apy.toFixed(1)}% APY</span>
              {opp.tvl && opp.tvl > 0 && (
                <div className="text-gray-500 text-[9px]">${(opp.tvl / 1_000_000).toFixed(1)}M TVL</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-700 flex items-center justify-between">
        <span className="text-gray-500 text-[10px]">Solana CLMM via @byreal-io/byreal-cli</span>
        <span className="text-gray-500 text-[10px]">Top: {data.solanaTopYield.toFixed(1)}% APY</span>
      </div>
    </div>
  );
}
