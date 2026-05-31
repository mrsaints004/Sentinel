import TelegramBot from "node-telegram-bot-api";
import { config } from "./config";
import {
  getRules,
  setRules,
  enableAutonomous,
  getTradesToday,
} from "./autonomousRules";
import {
  getDecisionHistory,
  getCurrentAllocations,
  getAgentStats,
  getPendingApproval,
  approveDecision,
  rejectDecision,
  setRiskProfile,
  toggleAutonomous,
  updateAutonomousRules,
  getAutonomousStatus,
} from "./index";
import { fetchYieldData, fetchPriceData } from "./dataFeeds";
import { getCrossChainOpportunities } from "./skills/byrealSkill";
import { verifyLinkToken, getAllLinkedWallets } from "./linkStore";

export function startTelegramBot(token: string) {
  const bot = new TelegramBot(token, { polling: true });

  console.log("[Telegram] Bot started. Waiting for messages...");

  // --- /start (with optional deep link token) ---
  bot.onText(/\/start\s*(.*)/, (msg, match) => {
    const chatId = msg.chat.id;
    const payload = match?.[1]?.trim();

    // If payload exists, this is a deep link from the dashboard
    if (payload) {
      const result = verifyLinkToken(payload, chatId);

      if (result.success) {
        const shortAddr = result.walletAddress!.slice(0, 6) + "..." + result.walletAddress!.slice(-4);
        bot.sendMessage(
          chatId,
          `\u2705 *Account linked.*\n\n` +
            `*Wallet:* \`${shortAddr}\`\n` +
            `*Network:* Mantle Mainnet\n\n` +
            `You can now manage your treasury from here.\n\n` +
            `*Commands:*\n` +
            `/portfolio \u2014 View your treasury\n` +
            `/yields \u2014 Current yield rates\n` +
            `/approve \u2014 Approve pending trade\n` +
            `/help \u2014 All commands`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(
          chatId,
          `\u274C *Link Failed*\n\n${result.error}\n\nUse /help to see available commands.`,
          { parse_mode: "Markdown" }
        );
      }
      return;
    }

    // No payload — normal /start
    bot.sendMessage(
      chatId,
      `*Welcome to Sentinel* \u{1F3E6}\n\n` +
        `Your Mantle Treasury AI.\n\n` +
        `I continuously monitor yield opportunities, assess risk, and manage your portfolio \u2014 all on-chain.\n\n` +
        `To link your wallet, click "Link Telegram" on the Sentinel dashboard.\n\n` +
        `*Commands:*\n` +
        `/portfolio \u2014 View your treasury\n` +
        `/yields \u2014 Current yield rates\n` +
        `/risk \u2014 Risk assessment\n` +
        `/lastdecision \u2014 Last AI decision\n` +
        `/agents \u2014 View agent status\n` +
        `/autonomous \u2014 Autonomous mode settings\n` +
        `/approve \u2014 Approve pending trade\n` +
        `/reject \u2014 Reject pending trade\n` +
        `/setrisk \u2014 Change risk profile\n` +
        `/byreal \u2014 Cross-chain pool analysis\n` +
        `/help \u2014 Show all commands`,
      { parse_mode: "Markdown" }
    );
  });

  // --- /portfolio ---
  bot.onText(/\/portfolio/, async (msg) => {
    const chatId = msg.chat.id;
    const stats = getAgentStats();
    const allocations = getCurrentAllocations();
    const history = getDecisionHistory();

    // Get real yields for display
    let yields: any[] = [];
    try {
      yields = await fetchYieldData();
    } catch {}

    const roi = (stats.cumulativeROIBps / 100).toFixed(2);

    // Calculate estimated USD values
    const totalValueUSD = 100000 * (1 + stats.cumulativeROIBps / 10000);

    let allocText = "";
    allocations.forEach((a) => {
      const pct = (a.allocationBps / 100).toFixed(1);
      const bar = "\u2588".repeat(Math.round(a.allocationBps / 500)) + "\u2591".repeat(20 - Math.round(a.allocationBps / 500));
      const yieldData = yields.find((y) => y.symbol === a.symbol);
      const apy = yieldData ? yieldData.apy.toFixed(2) : "—";
      const balanceUSD = Math.round((totalValueUSD * a.allocationBps) / 10000);
      allocText += `\n*${a.symbol}* ${pct}%  $${balanceUSD.toLocaleString()}\n\`${bar}\`  ${apy}% APY\n`;
    });

    const blended = yields.length > 0
      ? allocations.reduce((sum, a) => {
          const y = yields.find((yd) => yd.symbol === a.symbol);
          return sum + ((y?.apy ?? 0) * a.allocationBps) / 10000;
        }, 0)
      : 3.8;

    bot.sendMessage(
      chatId,
      `\u{1F4CA} *Treasury Status*\n\n` +
        `*Total Value:* $${Math.round(totalValueUSD).toLocaleString()}\n` +
        `*Blended Yield:* ${blended.toFixed(2)}% APY\n` +
        `*ROI:* ${Number(roi) >= 0 ? "+" : ""}${roi}%\n` +
        `*Decisions Made:* ${stats.totalDecisions}\n` +
        `*Uptime:* ${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m\n` +
        `\n\u2501\u2501\u2501 *Allocation* \u2501\u2501\u2501${allocText}\n` +
        `*Network:* Mantle Mainnet (5000)\n` +
        `*Agent:* ERC-8004 NFT #1`,
      { parse_mode: "Markdown" }
    );
  });

  // --- /yields ---
  bot.onText(/\/yields/, async (msg) => {
    const chatId = msg.chat.id;

    try {
      const yields = await fetchYieldData();
      let text = "\u{1F4C8} *Live Yield Rates*\n\n";

      const sorted = [...yields].sort((a, b) => b.apy - a.apy);
      sorted.forEach((y, i) => {
        const medal = i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : "\u{1F949}";
        text += `${medal} *${y.symbol}:* ${y.apy.toFixed(2)}% APY\n`;
        text += `   Source: ${y.source} | TVL: $${(y.tvl / 1_000_000).toFixed(0)}M\n`;
      });

      const allocations = getCurrentAllocations();
      const blended = allocations.reduce((sum, a) => {
        const y = yields.find((yd) => yd.symbol === a.symbol);
        return sum + ((y?.apy ?? 0) * a.allocationBps) / 10000;
      }, 0);

      text += `\n*Blended Portfolio:* ${blended.toFixed(2)}% APY`;
      text += `\n*Yield Spread:* ${(sorted[0].apy - sorted[sorted.length - 1].apy).toFixed(2)}%`;
      text += `\n\n_Data from DeFiLlama & CoinGecko_`;

      bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (error) {
      bot.sendMessage(chatId, "Failed to fetch yield data. Try again shortly.");
    }
  });

  // --- /risk ---
  bot.onText(/\/risk/, async (msg) => {
    const chatId = msg.chat.id;
    const allocations = getCurrentAllocations();
    const history = getDecisionHistory();
    const lastCycle = history[history.length - 1];

    let riskScore = 3.0;
    let riskLevel = "low";
    if (lastCycle) {
      riskScore = lastCycle.risk.riskScore;
      riskLevel = lastCycle.risk.riskScore > 7 ? "high" : lastCycle.risk.riskScore > 4 ? "medium" : "low";
    }

    let riskEmoji = "\u{1F7E2}";
    if (riskScore > 5) riskEmoji = "\u{1F7E1}";
    if (riskScore > 7) riskEmoji = "\u{1F534}";

    let text = `\u{1F6E1} *Risk Assessment*\n\n`;
    text += `${riskEmoji} *Risk Score:* ${riskScore.toFixed(1)} / 10\n`;
    text += `*Max Drawdown Est:* ${(riskScore * 1.5).toFixed(1)}%\n\n`;

    text += `*Exposure Analysis:*\n`;
    allocations.forEach((a) => {
      const pct = (a.allocationBps / 100).toFixed(0);
      const warning = a.allocationBps > 5000 ? " \u26A0\uFE0F Over-concentrated" : " \u2705 OK";
      text += `\u2022 ${a.symbol}: ${pct}%${warning}\n`;
    });

    const stableAlloc = allocations
      .filter((a) => a.symbol === "USDC" || a.symbol === "USDY")
      .reduce((s, a) => s + a.allocationBps, 0);

    text += `\n*Stable allocation:* ${(stableAlloc / 100).toFixed(0)}%`;
    text += stableAlloc >= 2000 ? " \u2705" : " \u26A0\uFE0F Below minimum";

    if (lastCycle && lastCycle.risk.exposureWarnings.length > 0) {
      text += `\n\n*Warnings:*\n`;
      lastCycle.risk.exposureWarnings.forEach((w: any) => {
        text += `\u2022 [${w.severity}] ${w.asset}: ${w.issue}\n`;
      });
    }

    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  // --- /lastdecision ---
  bot.onText(/\/lastdecision/, (msg) => {
    const chatId = msg.chat.id;
    const history = getDecisionHistory();

    if (history.length === 0) {
      bot.sendMessage(chatId, "No decisions made yet. Agent may still be warming up.");
      return;
    }

    const last = history[history.length - 1];
    const d = last.decision;
    const ago = Math.floor((Date.now() - last.timestamp) / 60000);

    let text = `\u{1F916} *Last AI Decision*\n\n`;
    text += `*Action:* ${d.action.toUpperCase()}\n`;
    text += `*Risk Level:* ${d.riskLevel}\n`;
    text += `*Confidence:* ${d.confidence}%\n`;
    text += `*Time:* ${ago}m ago\n\n`;
    text += `*Reasoning:*\n${d.reasoning}\n\n`;
    text += `*Agent Contributions:*\n`;
    text += `\u2022 Market: ${d.agentContributions.market}\n`;
    text += `\u2022 Yield: ${d.agentContributions.yield}\n`;
    text += `\u2022 Risk: ${d.agentContributions.risk}\n\n`;

    if (last.txHash) {
      text += `*TX:* [View on Explorer](https://mantlescan.xyz/tx/${last.txHash})`;
    } else {
      text += `_Decision recorded in agent memory_`;
    }

    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  // --- /agents ---
  bot.onText(/\/agents/, (msg) => {
    const chatId = msg.chat.id;
    const stats = getAgentStats();
    const history = getDecisionHistory();
    const last = history[history.length - 1];

    let text = `\u{1F9E0} *Multi-Agent System Status*\n\n`;
    text += `*Market Intelligence Agent*\n`;
    text += `  Status: \u{1F7E2} Active\n`;
    text += `  Last: ${last?.market ? `${last.market.outlook} outlook, ${last.market.confidence}% confidence` : "Awaiting data"}\n\n`;
    text += `*Yield Optimization Agent*\n`;
    text += `  Status: \u{1F7E2} Active\n`;
    text += `  Last: ${last?.yields ? `${last.yields.bestYieldAsset} leading at ${last.yields.bestYieldApy.toFixed(2)}% APY` : "Awaiting data"}\n\n`;
    text += `*Risk Management Agent*\n`;
    text += `  Status: \u{1F7E2} Active\n`;
    text += `  Last: ${last?.risk ? `Score ${last.risk.riskScore.toFixed(1)}/10, ${last.risk.exposureWarnings.length} warnings` : "Awaiting data"}\n\n`;
    text += `*Portfolio Manager Agent*\n`;
    text += `  Status: \u{1F7E2} Active\n`;
    text += `  Decisions: ${stats.totalDecisions}\n`;
    text += `  ROI: ${(stats.cumulativeROIBps / 100).toFixed(2)}%\n\n`;
    text += `_All agents run every ${config.intervalMs / 1000}s._`;

    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  // --- /setrisk ---
  bot.onText(/\/setrisk/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId, "Choose your risk profile:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "\u{1F6E1} Conservative", callback_data: "risk_conservative" },
            { text: "\u2696\uFE0F Moderate", callback_data: "risk_moderate" },
            { text: "\u{1F680} Aggressive", callback_data: "risk_aggressive" },
          ],
        ],
      },
    });
  });

  // --- /approve & /reject ---
  bot.onText(/\/approve/, (msg) => {
    handleApproval(msg.chat.id, true);
  });

  bot.onText(/\/reject/, (msg) => {
    handleApproval(msg.chat.id, false);
  });

  // --- /byreal ---
  bot.onText(/\/byreal/, (msg) => {
    const chatId = msg.chat.id;

    try {
      const data = getCrossChainOpportunities();

      let text = `\u{1F517} *Cross-Chain Intelligence (Byreal)*\n\n`;
      text += `*Solana CLMM Top Yield:* ${data.solanaTopYield.toFixed(1)}% APY\n`;
      text += `*Analysis:* ${data.mantleComparison}\n\n`;
      text += `*Top Opportunities:*\n`;
      data.opportunities.forEach((o, i) => {
        const emoji = o.risk === "low" ? "\u{1F7E2}" : o.risk === "medium" ? "\u{1F7E1}" : "\u{1F534}";
        text += `${emoji} ${o.pool}: ${o.apy.toFixed(1)}% APY [${o.risk}]\n`;
      });
      text += `\n_Powered by Byreal CLI (@byreal-io/byreal-cli)_`;

      bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch {
      bot.sendMessage(chatId, "Cross-chain data unavailable. Byreal CLI not configured.");
    }
  });

  // --- Callback queries (inline buttons) ---
  bot.on("callback_query", (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId) return;

    const data = query.data || "";

    if (data.startsWith("risk_")) {
      const profile = data.replace("risk_", "") as "conservative" | "moderate" | "aggressive";
      setRiskProfile(profile);
      bot.answerCallbackQuery(query.id, { text: `Risk profile set to ${profile}` });
      bot.sendMessage(
        chatId,
        `\u2705 Risk profile updated to *${profile}*.\n\nThe Portfolio Manager Agent will adjust allocations in the next cycle.`,
        { parse_mode: "Markdown" }
      );
    }

    if (data === "approve_trade") {
      bot.answerCallbackQuery(query.id, { text: "Trade approved!" });
      handleApproval(chatId, true);
    }

    if (data === "reject_trade") {
      bot.answerCallbackQuery(query.id, { text: "Trade rejected." });
      handleApproval(chatId, false);
    }

    // Autonomous mode callbacks
    if (data === "auto_enable") {
      toggleAutonomous(true);
      bot.answerCallbackQuery(query.id, { text: "Autonomous mode enabled!" });
      bot.sendMessage(chatId, "\u26A1 *Autonomous mode ENABLED*\n\nThe AI will now execute trades within your configured limits without asking for approval.", { parse_mode: "Markdown" });
    }

    if (data === "auto_disable") {
      toggleAutonomous(false);
      bot.answerCallbackQuery(query.id, { text: "Autonomous mode disabled." });
      bot.sendMessage(chatId, "\u{1F534} *Autonomous mode DISABLED*\n\nAll trades will now require manual approval.", { parse_mode: "Markdown" });
    }

    if (data.startsWith("auto_maxchange_")) {
      const bps = parseInt(data.replace("auto_maxchange_", ""));
      updateAutonomousRules({ maxPortfolioChangeBps: bps });
      bot.answerCallbackQuery(query.id, { text: `Max change set to ${bps / 100}%` });
      bot.sendMessage(chatId, `\u2705 Max portfolio change per asset set to *${bps / 100}%*`, { parse_mode: "Markdown" });
    }

    if (data.startsWith("auto_maxtrades_")) {
      const max = parseInt(data.replace("auto_maxtrades_", ""));
      updateAutonomousRules({ maxDailyTrades: max });
      bot.answerCallbackQuery(query.id, { text: `Max daily trades set to ${max}` });
      bot.sendMessage(chatId, `\u2705 Max daily trades set to *${max}*`, { parse_mode: "Markdown" });
    }

    if (data.startsWith("auto_minconf_")) {
      const conf = parseInt(data.replace("auto_minconf_", ""));
      updateAutonomousRules({ minConfidence: conf });
      bot.answerCallbackQuery(query.id, { text: `Min confidence set to ${conf}%` });
      bot.sendMessage(chatId, `\u2705 Minimum confidence set to *${conf}%*`, { parse_mode: "Markdown" });
    }
  });

  // --- Natural language ---
  bot.on("message", (msg) => {
    if (msg.text?.startsWith("/")) return; // skip commands

    const chatId = msg.chat.id;
    const text = (msg.text || "").toLowerCase();

    if (text.includes("how") && (text.includes("treasury") || text.includes("portfolio") || text.includes("doing"))) {
      const stats = getAgentStats();
      const allocations = getCurrentAllocations();
      bot.sendMessage(
        chatId,
        `Your treasury is performing well.\n\n` +
          `*ROI:* ${(stats.cumulativeROIBps / 100).toFixed(2)}%\n` +
          `*Decisions:* ${stats.totalDecisions}\n` +
          `*Assets:* ${allocations.map((a) => `${a.symbol} ${(a.allocationBps / 100).toFixed(0)}%`).join(", ")}\n\n` +
          `Use /portfolio for full details.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (text.includes("why") && (text.includes("buy") || text.includes("meth") || text.includes("usdy") || text.includes("rebalance"))) {
      const history = getDecisionHistory();
      const last = history[history.length - 1];
      if (last) {
        bot.sendMessage(
          chatId,
          `Here's why the AI made its last decision:\n\n*${last.decision.action.toUpperCase()}*\n\n${last.decision.reasoning}\n\n` +
            `The decision was based on analysis from 4 specialized agents: Market Intelligence, Yield Optimization, Risk Management, and Portfolio Manager.`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(chatId, "No decisions have been made yet.");
      }
      return;
    }

    if (text.includes("risk")) {
      const status = getAutonomousStatus();
      bot.sendMessage(
        chatId,
        `Your current risk profile is *${status.riskProfile}*.\n\n` +
          `Use /risk for a detailed assessment or /setrisk to change it.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Default response
    bot.sendMessage(
      chatId,
      `I can help you with:\n\n` +
        `\u2022 "How is my treasury doing?"\n` +
        `\u2022 "Why did you buy mETH?"\n` +
        `\u2022 "What are my risks?"\n\n` +
        `Or use /help for all commands.`
    );
  });

  // --- /autonomous ---
  bot.onText(/\/autonomous/, (msg) => {
    const chatId = msg.chat.id;
    const status = getAutonomousStatus();

    let text = `\u26A1 *Autonomous Mode*\n\n`;
    text += `*Status:* ${status.enabled ? "\u{1F7E2} ENABLED" : "\u{1F534} DISABLED"}\n`;
    text += `*Trades Today:* ${status.tradesToday}/${status.maxDailyTrades}\n\n`;
    text += `*Current Rules:*\n`;
    text += `\u2022 Max change per asset: ${(status.maxPortfolioChangeBps / 100).toFixed(0)}%\n`;
    text += `\u2022 Max daily trades: ${status.maxDailyTrades}\n`;
    text += `\u2022 Allowed assets: ${status.allowedAssets.join(", ")}\n`;
    text += `\u2022 Risk profile: ${status.riskProfile}\n`;
    text += `\u2022 Max risk score: ${status.maxRiskScore}/10\n`;
    text += `\u2022 Min confidence: ${status.minConfidence}%\n`;

    bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: status.enabled ? "\u{1F534} Disable Autonomous" : "\u{1F7E2} Enable Autonomous",
              callback_data: status.enabled ? "auto_disable" : "auto_enable",
            },
          ],
          [
            { text: "Max Change: 10%", callback_data: "auto_maxchange_1000" },
            { text: "Max Change: 20%", callback_data: "auto_maxchange_2000" },
            { text: "Max Change: 30%", callback_data: "auto_maxchange_3000" },
          ],
          [
            { text: "Max 2 trades/day", callback_data: "auto_maxtrades_2" },
            { text: "Max 3 trades/day", callback_data: "auto_maxtrades_3" },
            { text: "Max 5 trades/day", callback_data: "auto_maxtrades_5" },
          ],
          [
            { text: "Min Confidence: 50%", callback_data: "auto_minconf_50" },
            { text: "Min Confidence: 70%", callback_data: "auto_minconf_70" },
            { text: "Min Confidence: 80%", callback_data: "auto_minconf_80" },
          ],
        ],
      },
    });
  });

  // --- /help ---
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      `*Sentinel Treasury AI \u2014 Commands*\n\n` +
        `\u{1F4CA} /portfolio \u2014 Treasury status & allocation\n` +
        `\u{1F4C8} /yields \u2014 Current yield rates (live)\n` +
        `\u{1F6E1} /risk \u2014 Risk assessment\n` +
        `\u{1F916} /lastdecision \u2014 Last AI decision\n` +
        `\u{1F9E0} /agents \u2014 Multi-agent system status\n` +
        `\u2699\uFE0F /setrisk \u2014 Change risk profile\n` +
        `\u26A1 /autonomous \u2014 Autonomous mode settings\n` +
        `\u2705 /approve \u2014 Approve pending trade\n` +
        `\u274C /reject \u2014 Reject pending trade\n` +
        `\u{1F517} /byreal \u2014 Cross-chain pool analysis\n\n` +
        `You can also ask me questions in plain English!`,
      { parse_mode: "Markdown" }
    );
  });

  function handleApproval(chatId: number, approved: boolean) {
    const pending = getPendingApproval();
    if (!pending) {
      bot.sendMessage(chatId, "No pending trade to " + (approved ? "approve" : "reject") + ".");
      return;
    }

    if (approved) {
      const success = approveDecision();
      if (success) {
        const stats = getAgentStats();
        bot.sendMessage(
          chatId,
          `\u2705 *Trade Approved & Executed*\n\n` +
            `The rebalance has been submitted to Mantle.\n` +
            `Decision #${stats.totalDecisions} recorded on-chain.\n\n` +
            `Use /portfolio to see updated allocation.`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(chatId, "Failed to approve trade.");
      }
    } else {
      rejectDecision();
      bot.sendMessage(
        chatId,
        `\u274C *Trade Rejected*\n\nThe AI will reassess in the next cycle.`,
        { parse_mode: "Markdown" }
      );
    }
  }

  return bot;
}

// --- Notification System ---
// Broadcasts messages to all linked Telegram users
let botInstance: TelegramBot | null = null;

export function setBotInstance(bot: TelegramBot) {
  botInstance = bot;
}

export function notifyAllLinkedUsers(message: string) {
  if (!botInstance) return;
  const linked = getAllLinkedWallets();
  const chatIds = new Set(Object.values(linked));
  chatIds.forEach((chatId) => {
    botInstance!.sendMessage(chatId, message, { parse_mode: "Markdown" }).catch(() => {});
  });
}

export function notifyDecision(decision: {
  action: string;
  confidence: number;
  reasoning: string;
  riskLevel: string;
  newAllocations: { symbol: string; allocationBps: number }[];
}, txHash: string | null) {
  const allocText = decision.newAllocations
    .map((a) => `${a.symbol}: ${(a.allocationBps / 100).toFixed(1)}%`)
    .join(" | ");

  let text = `\u{1F4E2} *New AI Decision*\n\n`;
  text += `*Action:* ${decision.action.toUpperCase()}\n`;
  text += `*Confidence:* ${decision.confidence}%\n`;
  text += `*Risk:* ${decision.riskLevel}\n`;
  text += `*Allocation:* ${allocText}\n\n`;
  text += `*Reasoning:* ${decision.reasoning}\n`;

  if (txHash) {
    text += `\n\u{1F517} [View TX](https://mantlescan.xyz/tx/${txHash})`;
  }

  notifyAllLinkedUsers(text);
}

export function notifyApprovalNeeded(decision: {
  action: string;
  confidence: number;
  reasoning: string;
  newAllocations: { symbol: string; allocationBps: number }[];
}) {
  const allocText = decision.newAllocations
    .map((a) => `${a.symbol}: ${(a.allocationBps / 100).toFixed(1)}%`)
    .join(" | ");

  let text = `\u26A0\uFE0F *Approval Required*\n\n`;
  text += `*Action:* ${decision.action.toUpperCase()}\n`;
  text += `*Confidence:* ${decision.confidence}%\n`;
  text += `*New Allocation:* ${allocText}\n\n`;
  text += `*Reasoning:* ${decision.reasoning}\n\n`;
  text += `Use /approve or /reject`;

  notifyAllLinkedUsers(text);
}

// Standalone mode
import * as dotenv from "dotenv";
dotenv.config();

const isStandalone =
  typeof require !== "undefined"
    ? require.main === module
    : !process.argv[1] || process.argv[1].includes("telegram");

if (isStandalone) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("Set TELEGRAM_BOT_TOKEN in .env");
    process.exit(1);
  }
  const bot = startTelegramBot(token);
  setBotInstance(bot);
}
