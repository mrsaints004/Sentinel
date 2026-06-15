"use client";

import { useEffect, useState } from "react";

interface AgentEntry {
  id: number;
  name: string;
  strategy: string;
  decisions: number;
  address: string;
  isYou?: boolean;
}

export default function AgentLeaderboard() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const res = await fetch("/api/leaderboard");
        const data = await res.json();
        if (data.length > 0) {
          setAgents(data);
        }
      } catch { /* Leaderboard API unavailable — keep existing agents */ }
      setLoading(false);
    }
    fetchLeaderboard();
  }, []);

  const sorted = [...agents].sort((a, b) => b.decisions - a.decisions);

  if (loading) {
    return (
      <div className="card">
        <h2 className="text-sm font-semibold text-s-text mb-4">Agent Leaderboard</h2>
        <div className="animate-pulse space-y-3">
          {[1,2,3,4].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-s-text">Agent Leaderboard</h2>
        <span className="text-xs text-s-text-muted">{agents.length} agents on-chain</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-s-text-muted uppercase tracking-wider">
              <th className="text-left pb-3 font-medium">#</th>
              <th className="text-left pb-3 font-medium">Agent</th>
              <th className="text-right pb-3 font-medium">Decisions</th>
              <th className="text-right pb-3 font-medium">NFT ID</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent, i) => (
              <tr key={agent.id} className={`border-t border-gray-50 ${agent.isYou ? "bg-blue-50/50" : ""}`}>
                <td className="py-3 text-s-text-muted font-medium">
                  {i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : i === 2 ? "\u{1F949}" : `${i + 1}`}
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-s-text">{agent.name}</span>
                    {agent.isYou && (
                      <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">YOU</span>
                    )}
                  </div>
                  <div className="text-[11px] text-s-text-muted">
                    {agent.strategy} · {agent.address.slice(0, 6)}...{agent.address.slice(-4)}
                  </div>
                </td>
                <td className="py-3 text-right font-bold text-s-text">
                  {agent.decisions}
                </td>
                <td className="py-3 text-right">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                    #{agent.id}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-s-text-muted mt-4 pt-3 border-t border-gray-100">
        All agents verified on-chain via Agent Identity NFTs on Mantle.
        <a href={`https://mantlescan.xyz/address/${process.env.NEXT_PUBLIC_IDENTITY_ADDRESS || "0x7292c3Bef25159Fb4119A8CF48AAa027596C7fFD"}`} target="_blank" rel="noopener" className="ml-1 text-indigo-500 hover:underline">View contract</a>
      </p>
    </div>
  );
}
