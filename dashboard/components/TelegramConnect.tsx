"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "./WalletProvider";

const BOT_USERNAME = "SentinelAl_bot";

export default function TelegramConnect() {
  const wallet = useWallet();
  const [isLinked, setIsLinked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showMCP, setShowMCP] = useState(false);

  // Check link status when wallet connects
  const checkLinkStatus = useCallback(async () => {
    if (!wallet.address) return;
    try {
      const res = await fetch(`/api/telegram-link?wallet=${wallet.address}`);
      const data = await res.json();
      setIsLinked(data.linked);
    } catch {}
  }, [wallet.address]);

  useEffect(() => {
    checkLinkStatus();
    // Poll to detect when linking completes (after user clicks the deep link)
    if (!wallet.address) return;
    const interval = setInterval(checkLinkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkLinkStatus, wallet.address]);

  async function handleLinkTelegram() {
    if (!wallet.address) return;
    setLoading(true);
    try {
      // Generate a token and get the deep link
      const res = await fetch("/api/telegram-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet.address }),
      });
      const data = await res.json();

      if (data.linked) {
        setIsLinked(true);
      } else if (data.token) {
        // Open Telegram deep link — bot receives the token via /start payload
        window.open(`https://t.me/${BOT_USERNAME}?start=${data.token}`, "_blank");
      }
    } catch {}
    setLoading(false);
  }

  async function unlinkWallet() {
    if (!wallet.address) return;
    try {
      await fetch("/api/telegram-link", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet.address }),
      });
      setIsLinked(false);
    } catch {}
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-s-text mb-3">Control Interfaces</h2>
      <p className="text-xs text-s-text-muted mb-4">
        Link your wallet to Telegram for mobile control, or connect any AI via MCP.
      </p>

      <div className="space-y-3">
        {/* Telegram Link Section */}
        <div className="rounded-xl border border-s-border p-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-s-text">Telegram Bot</div>
              <div className="text-[11px] text-s-text-muted">
                @{BOT_USERNAME} — full portfolio control
              </div>
            </div>
            {isLinked && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-50 border border-green-200">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-[10px] font-medium text-green-700">Linked</span>
              </div>
            )}
          </div>

          {/* Not connected state */}
          {!wallet.isConnected && (
            <div className="text-xs text-s-text-muted bg-gray-50 rounded-lg p-3 text-center">
              Connect your wallet first to link Telegram.
            </div>
          )}

          {/* Connected but not linked */}
          {wallet.isConnected && !isLinked && (
            <button
              onClick={handleLinkTelegram}
              disabled={loading}
              className="w-full py-2.5 px-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              {loading ? "Opening Telegram..." : "Link Telegram Account"}
            </button>
          )}

          {/* Linked state */}
          {wallet.isConnected && isLinked && (
            <div className="space-y-2">
              <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 flex items-center gap-2">
                <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs text-green-700">
                  Wallet linked. Manage your treasury from Telegram.
                </span>
              </div>
              <div className="flex gap-2">
                <a
                  href={`https://t.me/${BOT_USERNAME}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-1.5 px-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-600 font-medium text-center hover:bg-blue-100 transition-colors"
                >
                  Open Bot
                </a>
                <button
                  onClick={unlinkWallet}
                  className="py-1.5 px-3 rounded-lg border border-red-200 text-xs text-red-500 hover:bg-red-50 transition-colors"
                >
                  Unlink
                </button>
              </div>
            </div>
          )}
        </div>

        {/* MCP */}
        <button
          onClick={() => setShowMCP(!showMCP)}
          className="w-full flex items-center gap-3 p-3 rounded-xl border border-s-border hover:border-violet-300 hover:bg-violet-50/30 transition-all group text-left"
        >
          <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"/>
            </svg>
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-s-text group-hover:text-violet-600 transition-colors">
              MCP for AI Assistants
            </div>
            <div className="text-[11px] text-s-text-muted">
              Connect Claude, GPT, or any LLM to your treasury
            </div>
          </div>
          <svg className={`w-4 h-4 text-s-text-muted transition-transform ${showMCP ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M19 9l-7 7-7-7"/>
          </svg>
        </button>

        {showMCP && (
          <div className="rounded-xl bg-gray-900 p-3 text-xs font-mono text-gray-300 overflow-x-auto">
            <div className="text-gray-500 mb-2">// Add to Claude Desktop &rarr; Settings &rarr; MCP Servers</div>
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed">{`{
  "mcpServers": {
    "sentinel-treasury": {
      "command": "npx",
      "args": ["ts-node", "mcp-server/index.ts"],
      "cwd": "/path/to/mantle",
      "env": {
        "VAULT_ADDRESS": "your-vault",
        "LOGGER_ADDRESS": "your-logger",
        "IDENTITY_ADDRESS": "your-identity",
        "AGENT_WALLET_ADDRESS": "your-agent"
      }
    }
  }
}`}</pre>
            <div className="mt-2 pt-2 border-t border-gray-700 text-gray-500">
              Tools: <span className="text-violet-400">get_portfolio</span>, <span className="text-violet-400">get_yields</span>, <span className="text-violet-400">get_decisions</span>, <span className="text-violet-400">trigger_rebalance</span>, <span className="text-violet-400">get_agent_status</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
