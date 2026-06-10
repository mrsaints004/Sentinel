"use client";

import { useState, useEffect, useRef } from "react";

interface LogEntry {
  id: number;
  type: "system" | "data" | "reasoning" | "action" | "success" | "warning";
  message: string;
  timestamp: number;
}

export default function AITerminal({ wallet }: { wallet?: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [queue, setQueue] = useState<{ type: string; message: string }[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Animate through queued steps
  useEffect(() => {
    if (!isRunning || queueIndex >= queue.length) {
      if (queueIndex >= queue.length && queue.length > 0) {
        setIsRunning(false);
      }
      return;
    }

    const entry = queue[queueIndex];
    const delay = entry.type === "reasoning" ? 700 : entry.type === "success" ? 500 : entry.type === "action" ? 600 : 350;

    const timer = setTimeout(() => {
      setLogs((prev) => [
        ...prev,
        { ...entry, id: Date.now() + queueIndex, timestamp: Date.now() } as LogEntry,
      ]);
      setQueueIndex((i) => i + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [isRunning, queueIndex, queue]);

  const startAgent = async () => {
    setLogs([]);
    setQueue([]);
    setQueueIndex(0);
    setIsRunning(true);

    try {
      const url = wallet ? `/api/agent-cycle?wallet=${wallet}` : "/api/agent-cycle";
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();

      if (data.steps && data.steps.length > 0) {
        setQueue(data.steps);
        setQueueIndex(0);
      } else {
        setLogs([{ id: 1, type: "warning", message: "No data returned from agent cycle", timestamp: Date.now() }]);
        setIsRunning(false);
      }
    } catch (error: any) {
      setLogs([{ id: 1, type: "warning", message: `Failed to run cycle: ${error.message}`, timestamp: Date.now() }]);
      setIsRunning(false);
    }
  };

  const colorMap: Record<string, string> = {
    system: "text-gray-400",
    data: "text-blue-400",
    reasoning: "text-violet-400",
    action: "text-amber-400",
    success: "text-emerald-400",
    warning: "text-orange-400",
  };

  const labelMap: Record<string, { text: string }> = {
    system: { text: "SYS" },
    data: { text: "DATA" },
    reasoning: { text: "AI" },
    action: { text: "TX" },
    success: { text: "\u2713" },
    warning: { text: "!" },
  };

  return (
    <div className="card-accent">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className={`w-2.5 h-2.5 rounded-full ${isRunning ? "bg-s-green animate-pulse" : "bg-gray-300"}`} />
          </div>
          <h2 className="text-sm font-semibold text-s-text">
            AI Agent Terminal
          </h2>
          {isRunning && (
            <span className="text-xs text-s-green font-medium animate-pulse">Live</span>
          )}
        </div>
        <button
          onClick={startAgent}
          disabled={isRunning}
          className={isRunning ? "btn-secondary opacity-60 cursor-not-allowed" : "btn-primary"}
        >
          {isRunning ? "Running..." : "Run Agent Cycle"}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="bg-gray-900 rounded-xl p-4 h-[360px] overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 && !isRunning && (
          <div className="h-full flex flex-col items-center justify-center text-gray-500">
            <svg className="w-10 h-10 mb-3 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <path d="M8 12h.01M12 12h.01M16 12h.01"/>
            </svg>
            <p className="text-sm text-gray-400 mb-1">Sentinel Agent Ready</p>
            <p className="text-[11px] text-gray-600">Runs real analysis: CoinGecko prices, DeFiLlama yields, on-chain state</p>
          </div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex gap-2 mb-0.5">
            <span className="text-gray-600 shrink-0">
              {new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className={`shrink-0 font-bold w-5 text-center ${colorMap[log.type]}`}>
              {labelMap[log.type]?.text}
            </span>
            <span className={colorMap[log.type]}>{log.message}</span>
          </div>
        ))}
        {isRunning && queueIndex < queue.length && (
          <div className="flex gap-2 mb-0.5">
            <span className="text-gray-600 shrink-0">
              {new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className="text-gray-400 animate-pulse">_</span>
          </div>
        )}
      </div>
    </div>
  );
}
