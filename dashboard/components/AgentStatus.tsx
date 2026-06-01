"use client";

interface ReputationMetrics {
  winRate: number;       // bps (0-10000)
  avgConfidence: number; // 0-100
  maxDrawdownBps: number;
  streakLength: number;  // positive = wins, negative = losses
  accuracyScore: number; // 0-1000
  totalGames: number;
}

interface AgentInfo {
  agentName: string;
  strategyType: string;
  totalDecisions: number;
  cumulativeROIBps: number;
  isRunning: boolean;
  uptime: number;
  walletAddress: string;
  lastActive: string;
  reputation?: ReputationMetrics;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatStreak(streak: number): string {
  if (streak === 0) return "—";
  if (streak > 0) return `W${streak}`;
  return `L${Math.abs(streak)}`;
}

function getScoreColor(score: number): string {
  if (score >= 700) return "text-s-green";
  if (score >= 400) return "text-yellow-400";
  return "text-s-red";
}

export default function AgentStatus({ agent }: { agent: AgentInfo }) {
  const roi = (agent.cumulativeROIBps / 100).toFixed(2);
  const rep = agent.reputation;

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
          Agent ID
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
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

      {rep && (
        <div className="mt-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-s-text-muted uppercase tracking-wider">
              On-Chain Reputation
            </h3>
            <span className={`text-xs font-bold ${getScoreColor(rep.accuracyScore)}`}>
              Score: {rep.accuracyScore}/1000
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center p-2.5 rounded-xl bg-s-bg border border-s-border">
              <div className={`text-sm font-bold ${rep.winRate >= 5000 ? "text-s-green" : "text-s-red"}`}>
                {(rep.winRate / 100).toFixed(1)}%
              </div>
              <div className="stat-label">Win Rate</div>
            </div>
            <div className="text-center p-2.5 rounded-xl bg-s-bg border border-s-border">
              <div className="text-sm font-bold text-s-text">
                {rep.avgConfidence}%
              </div>
              <div className="stat-label">Avg Conf.</div>
            </div>
            <div className="text-center p-2.5 rounded-xl bg-s-bg border border-s-border">
              <div className={`text-sm font-bold ${rep.streakLength > 0 ? "text-s-green" : rep.streakLength < 0 ? "text-s-red" : "text-s-text"}`}>
                {formatStreak(rep.streakLength)}
              </div>
              <div className="stat-label">Streak</div>
            </div>
            <div className="text-center p-2.5 rounded-xl bg-s-bg border border-s-border">
              <div className={`text-sm font-bold ${rep.maxDrawdownBps < 500 ? "text-s-green" : "text-s-red"}`}>
                {(rep.maxDrawdownBps / 100).toFixed(1)}%
              </div>
              <div className="stat-label">Max DD</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-s-text-muted text-center">
            Verified on-chain ({rep.totalGames} decisions tracked)
          </div>
        </div>
      )}
    </div>
  );
}
