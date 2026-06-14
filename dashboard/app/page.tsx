"use client";

import { useEffect, useState } from "react";
import PortfolioChart from "@/components/PortfolioChart";
import DecisionLog from "@/components/DecisionLog";
import YieldComparison from "@/components/YieldComparison";
import AgentStatus from "@/components/AgentStatus";
import AITerminal from "@/components/AITerminal";
import CreateTreasury from "@/components/CreateTreasury";
import AgentLeaderboard from "@/components/AgentLeaderboard";
import PendingApproval from "@/components/PendingApproval";
import AutonomousSettings from "@/components/AutonomousSettings";
import DepositForm from "@/components/DepositForm";
import TelegramConnect from "@/components/TelegramConnect";
import HowItWorks from "@/components/HowItWorks";
import { useWallet, ConnectButton } from "@/components/WalletProvider";

interface PortfolioData {
  totalValueUSD: number;
  assets: {
    symbol: string;
    name: string;
    allocationBps: number;
    balanceUSD: number;
    apy: number;
  }[];
  blendedYield: number;
  rebalanceCount: number;
  lastRebalance: string;
}

interface AgentInfo {
  agentName: string;
  strategyType: string;
  totalDecisions: number;
  isRunning: boolean;
  uptime: number;
  walletAddress: string;
  lastActive: string;
}

interface DecisionEntry {
  id: number;
  action: string;
  reasoning: string;
  timestamp: number;
  confidence?: number;
  riskLevel?: string;
  commitHash?: string;
  verified?: boolean;
  txHash?: string;
}

function walletUrl(url: string, walletAddress?: string): string {
  if (!walletAddress) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}wallet=${walletAddress}`;
}

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [decisions, setDecisions] = useState<DecisionEntry[]>([]);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [tab, setTab] = useState<"dashboard" | "create" | "leaderboard">("dashboard");
  const [showCreate, setShowCreate] = useState(false);
  const wallet = useWallet();

  useEffect(() => {
    if (!wallet.isConnected || !wallet.address) return;
    const addr = wallet.address;

    async function fetchData() {
      try {
        const [portfolioRes, decisionsRes, agentRes] = await Promise.all([
          fetch(walletUrl("/api/portfolio", addr)),
          fetch(walletUrl("/api/decisions", addr)),
          fetch(walletUrl("/api/agent-status", addr)),
        ]);
        setPortfolio(await portfolioRes.json());
        setDecisions(await decisionsRes.json());
        setAgent(await agentRes.json());
      } catch {
        // API fetch failed — will retry on next interval
      }
    }
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [wallet.isConnected, wallet.address]);

  // Show hero landing page when wallet is not connected
  if (!wallet.isConnected) {
    return (
      <div className="min-h-screen bg-s-bg">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white border-b border-s-border">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-s-accent flex items-center justify-center">
                <span className="text-sm font-black text-white">S</span>
              </div>
              <div>
                <h1 className="text-sm font-bold text-s-text leading-none">Sentinel</h1>
                <p className="text-[10px] text-s-text-muted leading-none mt-0.5">AI Treasury</p>
              </div>
            </div>
            <ConnectButton
              address={wallet.address}
              isConnected={wallet.isConnected}
              isConnecting={wallet.isConnecting}
              balance={wallet.balance}
              chainName={wallet.chainName}
              chainId={wallet.chainId}
              error={wallet.error}
              hasProvider={wallet.hasProvider}
              onConnect={wallet.connect}
              onDisconnect={wallet.disconnect}
            />
          </div>
        </header>

        {/* Hero Section */}
        <main className="max-w-[800px] mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <div className="mb-6">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-s-accent flex items-center justify-center">
              <span className="text-3xl font-black text-white">S</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-s-text mb-3">
              Your AI Treasury on Mantle
            </h1>
            <p className="text-base sm:text-lg text-s-text-muted max-w-[560px] mx-auto">
              Set your risk level. Sentinel watches DeFi yields 24/7 and rebalances your portfolio — all on-chain, fully autonomous.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex items-center justify-center gap-3 mb-10">
            <span className="px-3 py-1.5 rounded-full bg-teal-50 border border-teal-200 text-xs font-medium text-teal-700">
              Live Yields
            </span>
            <span className="px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-xs font-medium text-indigo-700">
              AI Rebalancing
            </span>
            <span className="px-3 py-1.5 rounded-full bg-violet-50 border border-violet-200 text-xs font-medium text-violet-700">
              On-Chain Proof
            </span>
          </div>

          {/* CTA */}
          <button
            onClick={wallet.connect}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-s-accent text-white font-semibold text-sm hover:bg-s-accent/90 transition-colors shadow-lg shadow-s-accent/20"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Connect Wallet to Start
          </button>

          {/* How it works */}
          <div className="mt-16 text-left max-w-[480px] mx-auto">
            <h2 className="text-sm font-semibold text-s-text mb-6 text-center">How it works</h2>
            <div className="space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-s-accent">1</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-s-text">Deploy your vault</p>
                  <p className="text-xs text-s-text-muted mt-0.5">Create your own vault on Mantle — non-custodial, transparent.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-s-accent">2</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-s-text">Choose your risk level</p>
                  <p className="text-xs text-s-text-muted mt-0.5">Conservative, moderate, or aggressive — you decide.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-s-accent">3</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-s-text">Sentinel's AI manages the rest</p>
                  <p className="text-xs text-s-text-muted mt-0.5">Rebalances, earns yield, logs every decision on-chain.</p>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="max-w-[800px] mx-auto px-4 sm:px-6 lg:px-8 py-8 border-t border-s-border">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-s-accent flex items-center justify-center">
                <span className="text-[9px] font-black text-white">S</span>
              </div>
              <span className="text-xs text-s-text-muted">Built on Mantle · Powered by Llama 3.3 70B · On-chain Agent Identity NFTs</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-s-text-muted">
              <a href="https://t.me/SentinelTreasuryBot" target="_blank" rel="noopener noreferrer" className="hover:text-s-accent transition-colors">Telegram</a>
              <span className="text-s-border">|</span>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-s-accent transition-colors">GitHub</a>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  if (!portfolio || !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-s-accent flex items-center justify-center">
            <span className="text-2xl font-black text-white">S</span>
          </div>
          <div className="w-6 h-6 border-2 border-s-accent/30 border-t-s-accent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-s-text-muted text-sm">Loading Sentinel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-s-bg">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-s-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-s-accent flex items-center justify-center">
              <span className="text-sm font-black text-white">S</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-s-text leading-none">Sentinel</h1>
              <p className="text-[10px] text-s-text-muted leading-none mt-0.5">AI Treasury</p>
            </div>
          </div>

          {/* Tabs */}
          <nav className="hidden sm:flex items-center gap-1">
            {([
              ["dashboard", "Dashboard"],
              ["create", "Create Treasury"],
              ["leaderboard", "Leaderboard"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tab === id
                    ? "bg-s-accent text-white"
                    : "text-s-text-muted hover:text-s-text hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200">
              <div className="w-1.5 h-1.5 rounded-full bg-s-teal animate-pulse" />
              <span className="text-[10px] font-medium text-teal-700">Mantle Mainnet</span>
            </div>
            <ConnectButton
              address={wallet.address}
              isConnected={wallet.isConnected}
              isConnecting={wallet.isConnecting}
              balance={wallet.balance}
              chainName={wallet.chainName}
              chainId={wallet.chainId}
              error={wallet.error}
              hasProvider={wallet.hasProvider}
              onConnect={wallet.connect}
              onDisconnect={wallet.disconnect}
            />
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Create Treasury Page */}
        {tab === "create" && (
          <div className="max-w-lg mx-auto">
            <CreateTreasury
              isConnected={wallet.isConnected}
              onConnect={wallet.connect}
              onClose={() => setTab("dashboard")}
              walletAddress={wallet.address ?? undefined}
            />
          </div>
        )}

        {/* Leaderboard Page */}
        {tab === "leaderboard" && (
          <AgentLeaderboard />
        )}

        {/* Dashboard */}
        {tab !== "dashboard" ? null : (<>
        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="card !p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-s-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <div>
              <div className="text-lg font-bold text-s-text">${portfolio.totalValueUSD.toLocaleString()}</div>
              <div className="text-[10px] text-s-text-muted uppercase tracking-wider">Portfolio</div>
            </div>
          </div>

          <div className="card !p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-s-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"/>
              </svg>
            </div>
            <div>
              <div className="text-lg font-bold text-s-teal">{portfolio.blendedYield.toFixed(2)}%</div>
              <div className="text-[10px] text-s-text-muted uppercase tracking-wider">Est. APY</div>
            </div>
          </div>

          <div className="card !p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-s-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3"/>
              </svg>
            </div>
            <div>
              <div className="text-lg font-bold text-s-text">{portfolio.rebalanceCount}</div>
              <div className="text-[10px] text-s-text-muted uppercase tracking-wider">Rebalances</div>
            </div>
          </div>

          <div className="card !p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-s-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
              </svg>
            </div>
            <div>
              <div className="text-lg font-bold text-s-green">
                {agent.totalDecisions}
              </div>
              <div className="text-[10px] text-s-text-muted uppercase tracking-wider">Decisions</div>
            </div>
          </div>
        </div>

        {/* Pending Approval */}
        <div className="mb-6">
          <PendingApproval walletAddress={wallet.address ?? undefined} />
        </div>

        {/* AI Terminal */}
        <div className="mb-6">
          <AITerminal wallet={wallet.address || undefined} />
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left */}
          <div className="lg:col-span-8 space-y-6">
            <PortfolioChart
              assets={portfolio.assets}
              totalValueUSD={portfolio.totalValueUSD}
              blendedYield={portfolio.blendedYield}
            />
            <DecisionLog decisions={decisions} />
          </div>

          {/* Right */}
          <div className="lg:col-span-4 space-y-6">
            <AgentStatus agent={agent} />
            <YieldComparison
              assets={portfolio.assets}
              blendedYield={portfolio.blendedYield}
            />

            <HowItWorks />
            <AutonomousSettings />
            <TelegramConnect />
            <DepositForm isConnected={wallet.isConnected} onConnect={wallet.connect} walletAddress={wallet.address || undefined} />

            {/* On-chain info */}
            <div className="card">
              <h2 className="text-sm font-semibold text-s-text mb-4">On-Chain Details</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-xs text-s-text-muted">Last Rebalance</span>
                  <span className="text-xs text-s-text font-mono">
                    {new Date(portfolio.lastRebalance).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-s-text-muted">Your Wallet</span>
                  <span className="text-xs text-s-accent font-mono">
                    {wallet.address ? `${wallet.address.slice(0, 8)}...${wallet.address.slice(-4)}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-s-text-muted">Agent Wallet</span>
                  <span className="text-xs text-s-accent font-mono">
                    {agent.walletAddress.slice(0, 8)}...{agent.walletAddress.slice(-4)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-s-text-muted">Network</span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-s-teal" />
                    <span className="text-xs text-s-text">Mantle</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        </>)}

        {/* Footer */}
        <footer className="mt-10 pt-6 border-t border-s-border flex flex-col sm:flex-row items-center justify-between gap-3 pb-8">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-s-accent flex items-center justify-center">
              <span className="text-[9px] font-black text-white">S</span>
            </div>
            <span className="text-xs text-s-text-muted">Built on Mantle · Powered by Llama 3.3 70B · On-chain Agent Identity NFTs</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-s-text-muted">
            <a href="https://t.me/SentinelTreasuryBot" target="_blank" rel="noopener noreferrer" className="hover:text-s-accent transition-colors">Telegram</a>
            <span className="text-s-border">|</span>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-s-accent transition-colors">GitHub</a>
          </div>
        </footer>
      </main>
    </div>
  );
}
