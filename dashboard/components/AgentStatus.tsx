"use client";

interface AgentInfo {
  agentName: string;
  strategyType: string;
  totalDecisions: number;
  cumulativeROIBps: number;
  isRunning: boolean;
  uptime: number;
  walletAddress: string;
  lastActive: string;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function AgentStatus({ agent }: { agent: AgentInfo }) {
  const roi = (agent.cumulativeROIBps / 100).toFixed(2);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-s-text">Agent Identity</h2>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${agent.isRunning ? "bg-s-green animate-pulse" : "bg-red-400"}`} />
          <span className="text-xs text-s-text-muted">{agent.isRunning ? "Active" : "Offline"}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-5 p-4 rounded-xl bg-s-bg border border-s-border">
        <div className="w-12 h-12 rounded-xl bg-s-accent flex items-center justify-center shrink-0">
          <span className="text-xl font-black text-white">S</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-s-text">{agent.agentName}</div>
          <div className="text-xs text-s-accent mt-0.5">{agent.strategyType}</div>
          <div className="text-[11px] text-s-text-muted font-mono mt-0.5">
            {agent.walletAddress.slice(0, 6)}...{agent.walletAddress.slice(-4)}
          </div>
        </div>
        <div className="shrink-0 px-2 py-1 rounded-md bg-s-accent-light text-s-accent text-[10px] font-semibold">
          ERC-8004
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center p-3 rounded-xl bg-s-bg border border-s-border">
          <div className="stat-value">{agent.totalDecisions}</div>
          <div className="stat-label">Decisions</div>
        </div>
        <div className="text-center p-3 rounded-xl bg-s-bg border border-s-border">
          <div className={`stat-value ${Number(roi) >= 0 ? "text-s-green" : "text-s-red"}`}>
            {Number(roi) >= 0 ? "+" : ""}{roi}%
          </div>
          <div className="stat-label">ROI</div>
        </div>
        <div className="text-center p-3 rounded-xl bg-s-bg border border-s-border">
          <div className="stat-value">{formatUptime(agent.uptime)}</div>
          <div className="stat-label">Uptime</div>
        </div>
      </div>
    </div>
  );
}
