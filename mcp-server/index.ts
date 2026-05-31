import { createServer } from "http";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

/**
 * Sentinel MCP Server
 *
 * A Model Context Protocol (MCP) server that exposes the Sentinel AI Treasury
 * as tools for any LLM (Claude, GPT, etc). Paste the config into your AI assistant
 * and it gains the ability to manage your DeFi portfolio on Mantle.
 *
 * Tools exposed:
 * - get_portfolio: Read current portfolio state
 * - get_yields: Fetch live yield rates from DeFi protocols
 * - get_decisions: Read recent AI agent decisions
 * - trigger_rebalance: Request the agent to evaluate and rebalance
 * - get_agent_status: Check agent health and stats
 */

const PORT = parseInt(process.env.MCP_PORT || "3100");
const RPC = process.env.MANTLE_MAINNET_RPC || "https://rpc.mantle.xyz";
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || "";
const LOGGER_ADDRESS = process.env.LOGGER_ADDRESS || "";
const IDENTITY_ADDRESS = process.env.IDENTITY_ADDRESS || "";
const AGENT_ADDRESS = process.env.AGENT_WALLET_ADDRESS || "";

const VAULT_ABI = [
  "function getPortfolio() view returns (address[], string[], uint256[], uint256[])",
  "function rebalanceCount() view returns (uint256)",
  "function lastRebalanceTimestamp() view returns (uint256)",
];

const LOGGER_ABI = [
  "function getRecentDecisions(uint256 count) view returns (tuple(uint256 id, address agent, string reasoning, string action, uint256[] oldAllocations, uint256[] newAllocations, string[] assetNames, uint256 timestamp, uint256 portfolioValueUSD, string riskLevel)[])",
];

const IDENTITY_ABI = [
  "function agentToToken(address) view returns (uint256)",
  "function getAgentMetadata(uint256) view returns (tuple(string agentName, string strategyType, uint256 totalDecisions, int256 cumulativeROIBps, uint256 createdAt, uint256 lastActiveAt, address vaultAddress, address loggerAddress))",
];

const TOKEN_DECIMALS: Record<string, number> = { USDY: 18, mETH: 18, USDC: 6 };

const provider = new ethers.JsonRpcProvider(RPC);

// MCP Tool Definitions
const TOOLS = [
  {
    name: "get_portfolio",
    description: "Get the current Sentinel vault portfolio on Mantle — shows all assets, their USD values, allocations, and blended yield.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_yields",
    description: "Fetch live DeFi yield rates from Mantle protocols (Ondo USDY, mETH staking, USDC lending) via DeFiLlama.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_decisions",
    description: "Read recent AI agent decisions logged immutably on-chain, including reasoning, allocations, and risk levels.",
    inputSchema: {
      type: "object",
      properties: { count: { type: "number", description: "Number of recent decisions to fetch (default 5)" } },
      required: [],
    },
  },
  {
    name: "trigger_rebalance",
    description: "Request the Sentinel agent to evaluate current market conditions and decide whether to rebalance. Returns the analysis steps.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_agent_status",
    description: "Get the Sentinel AI agent's current status — name, strategy, total decisions, ROI, uptime, and on-chain identity.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// Tool Implementations
async function getPortfolio() {
  if (!VAULT_ADDRESS) return { error: "Vault not deployed yet" };
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);
  const [, names, balances, allocations] = await vault.getPortfolio();
  const rebalanceCount = await vault.rebalanceCount();

  // Fetch prices
  const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=mantle-staked-ether,ondo-us-dollar-yield,usd-coin&vs_currencies=usd");
  const priceData = await priceRes.json();
  const prices: Record<string, number> = {
    USDY: priceData["ondo-us-dollar-yield"]?.usd ?? 1.05,
    mETH: priceData["mantle-staked-ether"]?.usd ?? 2500,
    USDC: priceData["usd-coin"]?.usd ?? 1.0,
  };

  const assets = (names as string[]).map((symbol: string, i: number) => {
    const decimals = TOKEN_DECIMALS[symbol] || 18;
    const balance = parseFloat(ethers.formatUnits(balances[i], decimals));
    const usdValue = balance * (prices[symbol] || 1);
    return {
      symbol,
      balance: balance.toFixed(decimals === 6 ? 2 : 4),
      allocationBps: Number(allocations[i]),
      allocationPercent: (Number(allocations[i]) / 100).toFixed(1) + "%",
      usdValue: Math.round(usdValue * 100) / 100,
      priceUSD: prices[symbol],
    };
  });

  const totalUSD = assets.reduce((s, a) => s + a.usdValue, 0);

  return {
    network: "Mantle Mainnet",
    vault: VAULT_ADDRESS,
    totalValueUSD: Math.round(totalUSD * 100) / 100,
    rebalanceCount: Number(rebalanceCount),
    assets,
  };
}

async function getYields() {
  const res = await fetch("https://yields.llama.fi/pools");
  const data = await res.json();
  const pools = (data.data || []).filter((p: any) => p.chain === "Mantle");

  const usdy = pools.find((p: any) => p.symbol?.toUpperCase().includes("USDY"));
  const meth = pools.find((p: any) => p.symbol?.toUpperCase().includes("METH"));
  const usdc = pools.find((p: any) => p.symbol?.toUpperCase().includes("USDC") && p.tvlUsd > 100000);

  return {
    source: "DeFiLlama (live)",
    yields: [
      { symbol: "USDY", apy: usdy?.apy?.toFixed(2) ?? "4.85", protocol: usdy?.project ?? "Ondo Finance", tvlUSD: usdy?.tvlUsd ?? 150000000 },
      { symbol: "mETH", apy: meth?.apy?.toFixed(2) ?? "3.65", protocol: meth?.project ?? "Mantle LSP", tvlUSD: meth?.tvlUsd ?? 800000000 },
      { symbol: "USDC", apy: usdc?.apy?.toFixed(2) ?? "2.80", protocol: usdc?.project ?? "Lendle", tvlUSD: usdc?.tvlUsd ?? 500000000 },
    ],
  };
}

async function getDecisions(count = 5) {
  if (!LOGGER_ADDRESS) return { error: "Logger not deployed" };
  const logger = new ethers.Contract(LOGGER_ADDRESS, LOGGER_ABI, provider);
  const decisions = await logger.getRecentDecisions(count);

  return decisions.map((d: any) => ({
    id: Number(d.id),
    action: d.action,
    reasoning: d.reasoning,
    riskLevel: d.riskLevel,
    assets: d.assetNames,
    oldAllocations: d.oldAllocations.map((a: bigint) => Number(a)),
    newAllocations: d.newAllocations.map((a: bigint) => Number(a)),
    portfolioValueUSD: Number(d.portfolioValueUSD),
    timestamp: new Date(Number(d.timestamp) * 1000).toISOString(),
  })).sort((a: any, b: any) => b.id - a.id);
}

async function triggerRebalance() {
  // Call the dashboard's agent-cycle API
  const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:3000";
  try {
    const res = await fetch(`${dashboardUrl}/api/agent-cycle`, { method: "POST" });
    const data = await res.json();
    return {
      status: "cycle_complete",
      steps: data.steps?.map((s: any) => `[${s.type.toUpperCase()}] ${s.message}`) || [],
    };
  } catch {
    return { status: "error", message: "Dashboard not running. Start with: npm run dev" };
  }
}

async function getAgentStatus() {
  if (!IDENTITY_ADDRESS || !AGENT_ADDRESS) return { error: "Identity contract not deployed" };
  const identity = new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, provider);
  const tokenId = await identity.agentToToken(AGENT_ADDRESS);
  if (tokenId === BigInt(0)) return { error: "Agent not registered" };

  const meta = await identity.getAgentMetadata(tokenId);
  return {
    name: meta.agentName,
    strategy: meta.strategyType,
    totalDecisions: Number(meta.totalDecisions),
    roiPercent: (Number(meta.cumulativeROIBps) / 100).toFixed(2) + "%",
    createdAt: new Date(Number(meta.createdAt) * 1000).toISOString(),
    lastActive: new Date(Number(meta.lastActiveAt) * 1000).toISOString(),
    wallet: AGENT_ADDRESS,
    identityNFT: `ERC-8004 #${Number(tokenId)}`,
    network: "Mantle Mainnet (chainId 5000)",
    explorer: `https://mantlescan.xyz/address/${AGENT_ADDRESS}`,
  };
}

// MCP HTTP Handler (JSON-RPC 2.0)
const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    res.end(JSON.stringify({ error: "POST only" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const request = JSON.parse(body);
      const { method, params, id } = request;

      let result: any;

      switch (method) {
        case "initialize":
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "sentinel-treasury", version: "1.0.0" },
          };
          break;

        case "tools/list":
          result = { tools: TOOLS };
          break;

        case "tools/call":
          const toolName = params?.name;
          const toolArgs = params?.arguments || {};

          try {
            let content: any;
            switch (toolName) {
              case "get_portfolio": content = await getPortfolio(); break;
              case "get_yields": content = await getYields(); break;
              case "get_decisions": content = await getDecisions(toolArgs.count || 5); break;
              case "trigger_rebalance": content = await triggerRebalance(); break;
              case "get_agent_status": content = await getAgentStatus(); break;
              default: content = { error: `Unknown tool: ${toolName}` };
            }
            result = { content: [{ type: "text", text: JSON.stringify(content, null, 2) }] };
          } catch (err: any) {
            result = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
          }
          break;

        default:
          result = { error: `Unknown method: ${method}` };
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: err.message } }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  Sentinel MCP Server running on port ${PORT}   ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  console.log(`Tools available:`);
  TOOLS.forEach((t) => console.log(`  • ${t.name} — ${t.description.slice(0, 60)}...`));
  console.log(`\nAdd to Claude Desktop → Settings → MCP Servers`);
  console.log(`Or use the config from: mcp-server/claude-config.json\n`);
});
