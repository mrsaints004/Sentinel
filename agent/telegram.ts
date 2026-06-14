import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
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
  getDcaPlans,
  createDcaPlan,
  removeDcaPlan,
  pauseDcaPlan,
  resumeDcaPlan,
  formatInterval,
  getScheduledTasks,
  createScheduledTask,
  removeScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  createWeeklyRebalance,
  createSafetyShift,
  createYieldChase,
  runNow,
  getPortfolioValue,
} from "./index";
import { fetchYieldData, fetchPriceData } from "./dataFeeds";
import { verifyLinkToken, getAllLinkedWallets, getWalletForChat, getLinkedChat, isWalletLinked, createLinkToken, unlinkWallet } from "./linkStore";
import * as http from "http";

// --- AI for conversational responses (Groq - Llama 3.3 70B) ---
const AI_BASE_URL = "https://api.groq.com/openai/v1";
const AI_MODEL = "llama-3.3-70b-versatile";

function getAIClient(): OpenAI | null {
  if (!config.openaiApiKey) return null;
  return new OpenAI({ apiKey: config.openaiApiKey, baseURL: AI_BASE_URL });
}

function resolveWallet(chatId: number): string | null {
  return getWalletForChat(chatId);
}

function requireWallet(bot: TelegramBot, chatId: number): string | null {
  const wallet = resolveWallet(chatId);
  if (!wallet) {
    bot.sendMessage(
      chatId,
      "You need to link your wallet first.\n\n" +
        "Go to the Sentinel dashboard, connect your wallet, and click *Link Telegram*. " +
        "Then click the deep link to connect.",
      { parse_mode: "Markdown" }
    );
    return null;
  }
  return wallet;
}

function buildContext(wallet: string): string {
  const stats = getAgentStats(wallet);
  const allocations = getCurrentAllocations(wallet);
  const history = getDecisionHistory(wallet);
  const lastCycle = history[history.length - 1];
  const autoStatus = getAutonomousStatus(wallet);
  const pending = getPendingApproval(wallet);

  const allocText = allocations
    .map((a) => `${a.symbol}: ${(a.allocationBps / 100).toFixed(1)}%`)
    .join(", ");

  let context = `CURRENT STATE:\n`;
  context += `- Portfolio: ${allocText}\n`;
  context += `- ROI: ${(stats.cumulativeROIBps / 100).toFixed(2)}%\n`;
  context += `- Total decisions: ${stats.totalDecisions}\n`;
  context += `- Uptime: ${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m\n`;
  context += `- Risk profile: ${autoStatus.riskProfile}\n`;
  context += `- Autonomous mode: ${autoStatus.enabled ? "ON" : "OFF"}\n`;
  context += `- Trades today: ${autoStatus.tradesToday}/${autoStatus.maxDailyTrades}\n`;
  context += `- Network: Mantle Mainnet (chainId 5000)\n`;

  if (pending) {
    context += `\nPENDING TRADE awaiting approval:\n`;
    context += `- Action: ${pending.action}\n`;
    context += `- Confidence: ${pending.confidence}%\n`;
    context += `- Reasoning: ${pending.reasoning}\n`;
    context += `- Allocations: ${pending.newAllocations.map((a) => `${a.symbol}: ${(a.allocationBps / 100).toFixed(1)}%`).join(", ")}\n`;
  }

  if (lastCycle) {
    context += `\nLAST DECISION:\n`;
    context += `- Action: ${lastCycle.decision.action}\n`;
    context += `- Confidence: ${lastCycle.decision.confidence}%\n`;
    context += `- Risk level: ${lastCycle.decision.riskLevel}\n`;
    context += `- Reasoning: ${lastCycle.decision.reasoning}\n`;
    context += `- Market outlook: ${lastCycle.market.outlook} (${lastCycle.market.confidence}% confidence)\n`;
    context += `- Best yield: ${lastCycle.yields.bestYieldAsset} at ${lastCycle.yields.bestYieldApy.toFixed(2)}% APY\n`;
    context += `- Risk score: ${lastCycle.risk.riskScore}/10\n`;
    if (lastCycle.txHash) {
      context += `- TX: https://mantlescan.xyz/tx/${lastCycle.txHash}\n`;
    }
  }

  return context;
}

async function askAI(wallet: string, userMessage: string): Promise<string> {
  const client = getAIClient();
  if (!client) return "";

  const context = buildContext(wallet);

  const systemPrompt = `You are Sentinel, an AI treasury manager on Mantle blockchain. You manage a portfolio of USDY, mETH, and USDC using 4 specialized sub-agents (Market, Yield, Risk, Portfolio).

You speak naturally and conversationally - like a knowledgeable financial advisor who happens to be an AI. Be concise (2-4 sentences unless the user asks for detail). Use real data from the context below. Never make up numbers.

When the user asks about actions they can take, mention the relevant option naturally but don't list all commands. If they want to change settings, tell them what to do in plain language.

${context}

IMPORTANT RULES:
- Keep responses short and natural. No walls of text.
- Use the real data above, never invent numbers.
- If you don't have data for something, say so honestly.
- Format for Telegram Markdown: *bold*, _italic_, \`code\`
- Don't use headers or bullet lists unless the user asks for a breakdown.
- Sound like a smart advisor, not a help menu.`;

  try {
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 400,
    });

    return response.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error("[Telegram AI] AI call failed:", error);
    return "";
  }
}

function detectIntent(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.match(/\b(risk profile|risk level|change risk|set risk|conservative|moderate|aggressive)\b/)) return "setrisk";
  if (lower.match(/\b(approve|reject|pending)\b/)) return "approval";
  if (lower.match(/\b(autonomous|auto mode|auto trading|self.?trading)\b/)) return "autonomous";
  if (lower.match(/\b(portfolio|treasury|holdings|balance|how.*doing|status)\b/)) return "portfolio";
  if (lower.match(/\b(yield|apy|rates|interest|earn)\b/)) return "yields";
  if (lower.match(/\b(risk|danger|safe|exposure|drawdown)\b/)) return "risk";
  if (lower.match(/\b(last decision|why did|explain|reasoning|last trade)\b/)) return "lastdecision";
  if (lower.match(/\b(agents?|sub.?agents?|market agent|yield agent|risk agent)\b/)) return "agents";
  if (lower.match(/\b(dca|dollar.?cost|recurring buy|auto.?buy)\b/)) return "dca";
  if (lower.match(/\b(plan|schedule|task|rebalance every|weekly|if .* drops|conditional)\b/)) return "plans";
  if (lower.match(/\b(help|commands|what can you)\b/)) return "help";
  return null;
}

export function startTelegramBot(token: string) {
  const bot = new TelegramBot(token, { polling: true });

  console.log("[Telegram] Bot started. Waiting for messages...");

  // --- /start (with optional deep link token) ---
  bot.onText(/\/start\s*(.*)/, (msg, match) => {
    const chatId = msg.chat.id;
    const payload = match?.[1]?.trim();

    if (payload) {
      const result = verifyLinkToken(payload, chatId);
      if (result.success) {
        const shortAddr = result.walletAddress!.slice(0, 6) + "..." + result.walletAddress!.slice(-4);
        bot.sendMessage(
          chatId,
          `*Account linked.* \u2705\n\n` +
            `Wallet \`${shortAddr}\` is now connected to Sentinel on Mantle Mainnet.\n\n` +
            `Just message me in plain English anytime. I'll handle the rest.`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(chatId, `Link failed: ${result.error}\n\nTry generating a new link from the dashboard.`);
      }
      return;
    }

    bot.sendMessage(
      chatId,
      `Hey! I'm *Sentinel* \u2014 your AI treasury manager on Mantle.\n\n` +
        `I manage your portfolio of USDY, mETH, and USDC using 4 specialized AI agents. ` +
        `I monitor markets, optimize yields, assess risk, and rebalance automatically.\n\n` +
        `Just talk to me naturally. Ask things like:\n` +
        `\u2022 _"How is my portfolio doing?"_\n` +
        `\u2022 _"Why did you sell mETH?"_\n` +
        `\u2022 _"What are the current yields?"_\n` +
        `\u2022 _"Change my risk to aggressive"_\n\n` +
        `Or pick an option below to get started:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "\u{1F4CA} Portfolio", callback_data: "quick_portfolio" },
              { text: "\u{1F4C8} Yields", callback_data: "quick_yields" },
            ],
            [
              { text: "\u{1F6E1} Risk", callback_data: "quick_risk" },
              { text: "\u{1F9E0} Agents", callback_data: "quick_agents" },
            ],
            [
              { text: "\u2699\uFE0F Set Risk Profile", callback_data: "show_risk_picker" },
              { text: "\u26A1 Autonomous", callback_data: "quick_autonomous" },
            ],
          ],
        },
      }
    );
  });

  // --- Slash commands ---
  bot.onText(/\/portfolio/, (msg) => { const w = requireWallet(bot, msg.chat.id); if (w) sendPortfolio(bot, msg.chat.id, w); });
  bot.onText(/\/yields/, (msg) => { const w = requireWallet(bot, msg.chat.id); if (w) sendYields(bot, msg.chat.id, w); });
  bot.onText(/\/risk/, (msg) => { const w = requireWallet(bot, msg.chat.id); if (w) sendRisk(bot, msg.chat.id, w); });
  bot.onText(/\/lastdecision/, (msg) => { const w = requireWallet(bot, msg.chat.id); if (w) sendLastDecision(bot, msg.chat.id, w); });
  bot.onText(/\/agents/, (msg) => { const w = requireWallet(bot, msg.chat.id); if (w) sendAgents(bot, msg.chat.id, w); });
  bot.onText(/\/autonomous/, (msg) => { const w = requireWallet(bot, msg.chat.id); if (w) sendAutonomous(bot, msg.chat.id, w); });
  bot.onText(/\/approve/, (msg) => { const w = requireWallet(bot, msg.chat.id); if (w) handleApproval(bot, msg.chat.id, w, true); });
  bot.onText(/\/reject/, (msg) => { const w = requireWallet(bot, msg.chat.id); if (w) handleApproval(bot, msg.chat.id, w, false); });
  bot.onText(/\/runnow/, async (msg) => {
    bot.sendMessage(msg.chat.id, "⏳ Triggering agent cycle...");
    const ok = await runNow();
    bot.sendMessage(msg.chat.id, ok ? "✅ Cycle complete." : "❌ Agent not running.");
  });

  bot.onText(/\/setrisk/, (msg) => {
    const w = requireWallet(bot, msg.chat.id);
    if (!w) return;
    bot.sendMessage(msg.chat.id, "What risk level works for you?", {
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

  bot.onText(/\/dca/, (msg) => { const w = requireWallet(bot, msg.chat.id); if (w) sendDca(bot, msg.chat.id, w); });
  bot.onText(/\/plans/, (msg) => { const w = requireWallet(bot, msg.chat.id); if (w) sendPlans(bot, msg.chat.id, w); });

  bot.onText(/\/vault/, (msg) => {
    const chatId = msg.chat.id;
    const w = resolveWallet(chatId);
    if (!w) {
      bot.sendMessage(chatId, "No wallet linked. Link your wallet from the dashboard first.");
      return;
    }
    const stats = getAgentStats(w);
    bot.sendMessage(
      chatId,
      `*Your Vault*\n\nWallet: \`${w.slice(0, 6)}...${w.slice(-4)}\`\n` +
        `Decisions: ${stats.totalDecisions}\n` +
        `ROI: ${(stats.cumulativeROIBps / 100).toFixed(2)}%\n` +
        `Status: ${stats.isRunning ? "\u{1F7E2} Running" : "\u{1F534} Stopped"}`,
      { parse_mode: "Markdown" }
    );
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `You can talk to me naturally or use these quick commands:\n\n` +
        `/portfolio \u2014 Treasury overview\n` +
        `/yields \u2014 Live APY rates\n` +
        `/risk \u2014 Risk analysis\n` +
        `/lastdecision \u2014 Last AI decision\n` +
        `/agents \u2014 Sub-agent status\n` +
        `/setrisk \u2014 Change risk profile\n` +
        `/autonomous \u2014 Auto-trading settings\n` +
        `/dca \u2014 DCA plans\n` +
        `/plans \u2014 Scheduled tasks\n` +
        `/vault \u2014 Your vault info\n` +
        `/approve \u2014 Approve pending trade\n` +
        `/reject \u2014 Reject pending trade\n` +
        `But honestly, just ask me anything in your own words.`,
      { parse_mode: "Markdown" }
    );
  });

  // --- Callback queries ---
  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId) return;
    const data = query.data || "";
    const wallet = resolveWallet(chatId);

    // Quick actions that don't need wallet
    if (data === "quick_yields") { bot.answerCallbackQuery(query.id); sendYields(bot, chatId, wallet || ""); return; }

    // All other actions require wallet
    if (!wallet) {
      bot.answerCallbackQuery(query.id, { text: "Link your wallet first" });
      requireWallet(bot, chatId);
      return;
    }

    if (data === "quick_portfolio") { bot.answerCallbackQuery(query.id); sendPortfolio(bot, chatId, wallet); return; }
    if (data === "quick_risk") { bot.answerCallbackQuery(query.id); sendRisk(bot, chatId, wallet); return; }
    if (data === "quick_agents") { bot.answerCallbackQuery(query.id); sendAgents(bot, chatId, wallet); return; }
    if (data === "quick_autonomous") { bot.answerCallbackQuery(query.id); sendAutonomous(bot, chatId, wallet); return; }

    if (data === "show_risk_picker") {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, "What risk level works for you?", {
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
      return;
    }

    if (data.startsWith("risk_")) {
      const profile = data.replace("risk_", "") as "conservative" | "moderate" | "aggressive";
      setRiskProfile(wallet, profile);
      bot.answerCallbackQuery(query.id, { text: `Set to ${profile}` });
      bot.sendMessage(chatId, `Done \u2014 risk profile is now *${profile}*. I'll adjust your allocations in the next cycle to match.`, { parse_mode: "Markdown" });
      return;
    }

    if (data === "approve_trade") { bot.answerCallbackQuery(query.id, { text: "Approving..." }); handleApproval(bot, chatId, wallet, true); return; }
    if (data === "reject_trade") { bot.answerCallbackQuery(query.id, { text: "Rejected" }); handleApproval(bot, chatId, wallet, false); return; }

    if (data === "auto_enable") { toggleAutonomous(wallet, true); bot.answerCallbackQuery(query.id, { text: "Enabled!" }); bot.sendMessage(chatId, "Autonomous mode is *ON*.", { parse_mode: "Markdown" }); return; }
    if (data === "auto_disable") { toggleAutonomous(wallet, false); bot.answerCallbackQuery(query.id, { text: "Disabled" }); bot.sendMessage(chatId, "Autonomous mode is *OFF*.", { parse_mode: "Markdown" }); return; }
    if (data.startsWith("auto_maxchange_")) { const bps = parseInt(data.replace("auto_maxchange_", "")); updateAutonomousRules(wallet, { maxPortfolioChangeBps: bps }); bot.answerCallbackQuery(query.id); bot.sendMessage(chatId, `Max portfolio change per asset set to *${bps / 100}%*.`, { parse_mode: "Markdown" }); return; }
    if (data.startsWith("auto_maxtrades_")) { const max = parseInt(data.replace("auto_maxtrades_", "")); updateAutonomousRules(wallet, { maxDailyTrades: max }); bot.answerCallbackQuery(query.id); bot.sendMessage(chatId, `Max daily trades set to *${max}*.`, { parse_mode: "Markdown" }); return; }
    if (data.startsWith("auto_minconf_")) { const conf = parseInt(data.replace("auto_minconf_", "")); updateAutonomousRules(wallet, { minConfidence: conf }); bot.answerCallbackQuery(query.id); bot.sendMessage(chatId, `Min confidence set to *${conf}%*.`, { parse_mode: "Markdown" }); return; }

    // DCA callbacks
    if (data === "quick_dca") { bot.answerCallbackQuery(query.id); sendDca(bot, chatId, wallet); return; }
    if (data === "quick_plans") { bot.answerCallbackQuery(query.id); sendPlans(bot, chatId, wallet); return; }

    if (data === "dca_create") {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, "What do you want to *buy* with DCA?", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "mETH", callback_data: "dca_target_mETH" },
              { text: "USDY", callback_data: "dca_target_USDY" },
              { text: "USDC", callback_data: "dca_target_USDC" },
            ],
          ],
        },
      });
      return;
    }

    if (data.startsWith("dca_target_")) {
      const target = data.replace("dca_target_", "");
      bot.answerCallbackQuery(query.id);
      const otherAssets = ["USDY", "mETH", "USDC"].filter((a) => a !== target);
      bot.sendMessage(chatId, `Buy *${target}* using which asset?`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [otherAssets.map((a) => ({ text: a, callback_data: `dca_source_${a}_${target}` }))] },
      });
      return;
    }

    if (data.startsWith("dca_source_")) {
      const parts = data.replace("dca_source_", "").split("_");
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, `How much per execution? (% of portfolio)`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: "0.5%", callback_data: `dca_amount_50_${parts[0]}_${parts[1]}` },
            { text: "1%", callback_data: `dca_amount_100_${parts[0]}_${parts[1]}` },
            { text: "2%", callback_data: `dca_amount_200_${parts[0]}_${parts[1]}` },
            { text: "5%", callback_data: `dca_amount_500_${parts[0]}_${parts[1]}` },
          ]],
        },
      });
      return;
    }

    if (data.startsWith("dca_amount_")) {
      const parts = data.replace("dca_amount_", "").split("_");
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, `How often?`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Every 1h", callback_data: `dca_interval_3600000_${parts[0]}_${parts[1]}_${parts[2]}` },
              { text: "Every 4h", callback_data: `dca_interval_14400000_${parts[0]}_${parts[1]}_${parts[2]}` },
            ],
            [
              { text: "Every 12h", callback_data: `dca_interval_43200000_${parts[0]}_${parts[1]}_${parts[2]}` },
              { text: "Every 24h", callback_data: `dca_interval_86400000_${parts[0]}_${parts[1]}_${parts[2]}` },
            ],
          ],
        },
      });
      return;
    }

    if (data.startsWith("dca_interval_")) {
      const parts = data.replace("dca_interval_", "").split("_");
      const intervalMs = parseInt(parts[0]);
      const amountBps = parseInt(parts[1]);
      const source = parts[2];
      const target = parts[3];
      bot.answerCallbackQuery(query.id);

      const plan = createDcaPlan(wallet, { sourceAsset: source, targetAsset: target, amountBps, intervalMs });
      bot.sendMessage(
        chatId,
        `*DCA Plan Created* \u2705\n\n${source} \u2192 ${target}\nAmount: ${amountBps / 100}% per execution\nInterval: every ${formatInterval(intervalMs)}\nNext execution: ${new Date(plan.nextExecutionAt).toLocaleString()}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (data.startsWith("dca_pause_")) { const id = data.replace("dca_pause_", ""); pauseDcaPlan(wallet, id); bot.answerCallbackQuery(query.id, { text: "Paused" }); sendDca(bot, chatId, wallet); return; }
    if (data.startsWith("dca_resume_")) { const id = data.replace("dca_resume_", ""); resumeDcaPlan(wallet, id); bot.answerCallbackQuery(query.id, { text: "Resumed" }); sendDca(bot, chatId, wallet); return; }
    if (data.startsWith("dca_cancel_")) { const id = data.replace("dca_cancel_", ""); removeDcaPlan(wallet, id); bot.answerCallbackQuery(query.id, { text: "Cancelled" }); bot.sendMessage(chatId, "DCA plan cancelled."); return; }

    // Scheduled task callbacks
    if (data === "plan_weekly") { bot.answerCallbackQuery(query.id); try { createWeeklyRebalance(wallet); bot.sendMessage(chatId, `*Weekly Rebalance Created* \u2705\n\nForced rebalance every Sunday at 00:00 UTC.`, { parse_mode: "Markdown" }); } catch (err: any) { bot.sendMessage(chatId, `Could not create: ${err.message}`); } return; }
    if (data === "plan_safety") {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, "Set mETH price trigger (USD). If mETH drops *below* this price, 20% shifts to stablecoins.\n\nPick a threshold:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[
          { text: "$2,500", callback_data: "plan_safety_2500" },
          { text: "$2,000", callback_data: "plan_safety_2000" },
          { text: "$1,500", callback_data: "plan_safety_1500" },
        ]] },
      });
      return;
    }
    if (data.startsWith("plan_safety_")) { const price = parseInt(data.replace("plan_safety_", "")); bot.answerCallbackQuery(query.id); try { createSafetyShift(wallet, price); bot.sendMessage(chatId, `*Safety Shift Created* \u2705\n\nIf mETH drops below $${price.toLocaleString()}, 20% shifts to stablecoins.`, { parse_mode: "Markdown" }); } catch (err: any) { bot.sendMessage(chatId, `Could not create: ${err.message}`); } return; }
    if (data === "plan_yield") {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, "Set mETH price target (USD). If mETH goes *above* this, mETH allocation increases to 50%.\n\nPick a threshold:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[
          { text: "$3,000", callback_data: "plan_yield_3000" },
          { text: "$3,500", callback_data: "plan_yield_3500" },
          { text: "$4,000", callback_data: "plan_yield_4000" },
        ]] },
      });
      return;
    }
    if (data.startsWith("plan_yield_")) { const price = parseInt(data.replace("plan_yield_", "")); bot.answerCallbackQuery(query.id); try { createYieldChase(wallet, price); bot.sendMessage(chatId, `*Yield Chase Created* \u2705\n\nIf mETH goes above $${price.toLocaleString()}, mETH allocation increases to 50%.`, { parse_mode: "Markdown" }); } catch (err: any) { bot.sendMessage(chatId, `Could not create: ${err.message}`); } return; }
    if (data.startsWith("plan_pause_")) { const id = data.replace("plan_pause_", ""); pauseScheduledTask(wallet, id); bot.answerCallbackQuery(query.id, { text: "Paused" }); sendPlans(bot, chatId, wallet); return; }
    if (data.startsWith("plan_resume_")) { const id = data.replace("plan_resume_", ""); resumeScheduledTask(wallet, id); bot.answerCallbackQuery(query.id, { text: "Resumed" }); sendPlans(bot, chatId, wallet); return; }
    if (data.startsWith("plan_cancel_")) { const id = data.replace("plan_cancel_", ""); removeScheduledTask(wallet, id); bot.answerCallbackQuery(query.id, { text: "Cancelled" }); bot.sendMessage(chatId, "Scheduled task cancelled."); return; }
  });

  // --- Main message handler ---
  bot.on("message", async (msg) => {
    if (msg.text?.startsWith("/")) return;
    const chatId = msg.chat.id;
    const userText = msg.text || "";
    if (!userText.trim()) return;

    const wallet = resolveWallet(chatId);
    if (!wallet) {
      requireWallet(bot, chatId);
      return;
    }

    bot.sendChatAction(chatId, "typing");
    const intent = detectIntent(userText);
    let aiResponse = await askAI(wallet, userText);

    if (!aiResponse) {
      if (intent === "portfolio") { sendPortfolio(bot, chatId, wallet); return; }
      if (intent === "yields") { sendYields(bot, chatId, wallet); return; }
      if (intent === "risk") { sendRisk(bot, chatId, wallet); return; }
      if (intent === "lastdecision") { sendLastDecision(bot, chatId, wallet); return; }
      if (intent === "agents") { sendAgents(bot, chatId, wallet); return; }
      if (intent === "autonomous") { sendAutonomous(bot, chatId, wallet); return; }
      if (intent === "dca") { sendDca(bot, chatId, wallet); return; }
      if (intent === "plans") { sendPlans(bot, chatId, wallet); return; }

      const stats = getAgentStats(wallet);
      const alloc = getCurrentAllocations(wallet);
      bot.sendMessage(
        chatId,
        `Your portfolio is at *${(stats.cumulativeROIBps / 100).toFixed(2)}% ROI* with ${alloc.map((a) => `${a.symbol} ${(a.allocationBps / 100).toFixed(0)}%`).join(", ")}.\n\nWhat would you like to know?`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "\u{1F4CA} Portfolio", callback_data: "quick_portfolio" },
              { text: "\u{1F4C8} Yields", callback_data: "quick_yields" },
              { text: "\u{1F6E1} Risk", callback_data: "quick_risk" },
            ]],
          },
        }
      );
      return;
    }

    let replyMarkup: TelegramBot.InlineKeyboardMarkup | undefined;
    if (intent === "setrisk") {
      replyMarkup = { inline_keyboard: [[
        { text: "\u{1F6E1} Conservative", callback_data: "risk_conservative" },
        { text: "\u2696\uFE0F Moderate", callback_data: "risk_moderate" },
        { text: "\u{1F680} Aggressive", callback_data: "risk_aggressive" },
      ]] };
    } else if (intent === "approval" && getPendingApproval(wallet)) {
      replyMarkup = { inline_keyboard: [[
        { text: "\u2705 Approve Trade", callback_data: "approve_trade" },
        { text: "\u274C Reject Trade", callback_data: "reject_trade" },
      ]] };
    } else if (intent === "autonomous") {
      const status = getAutonomousStatus(wallet);
      replyMarkup = {
        inline_keyboard: [
          [{ text: status.enabled ? "\u{1F534} Disable Auto Mode" : "\u{1F7E2} Enable Auto Mode", callback_data: status.enabled ? "auto_disable" : "auto_enable" }],
          [
            { text: "Max 10%/asset", callback_data: "auto_maxchange_1000" },
            { text: "Max 20%/asset", callback_data: "auto_maxchange_2000" },
            { text: "Max 30%/asset", callback_data: "auto_maxchange_3000" },
          ],
        ],
      };
    } else if (intent === "dca") {
      const plans = getDcaPlans(wallet);
      replyMarkup = { inline_keyboard: [[
        { text: `\u{1F504} DCA Plans (${plans.length})`, callback_data: "quick_dca" },
        { text: "\u2795 Create DCA", callback_data: "dca_create" },
      ]] };
    } else if (intent === "plans") {
      replyMarkup = { inline_keyboard: [
        [{ text: "\u{1F4C5} View Plans", callback_data: "quick_plans" }, { text: "\u{1F4C6} Weekly Rebalance", callback_data: "plan_weekly" }],
        [{ text: "\u{1F6E1} Safety Shift", callback_data: "plan_safety" }, { text: "\u{1F4B0} Yield Chase", callback_data: "plan_yield" }],
      ] };
    } else if (intent === "portfolio" || intent === "yields" || intent === "risk") {
      replyMarkup = { inline_keyboard: [[
        { text: "\u{1F4CA} Full Portfolio", callback_data: "quick_portfolio" },
        { text: "\u{1F4C8} Yields", callback_data: "quick_yields" },
        { text: "\u{1F6E1} Risk", callback_data: "quick_risk" },
      ]] };
    }

    bot.sendMessage(chatId, aiResponse, { parse_mode: "Markdown", reply_markup: replyMarkup }).catch(() => {
      bot.sendMessage(chatId, aiResponse, { reply_markup: replyMarkup });
    });
  });

  // --- Data display functions (wallet-scoped) ---

  async function sendPortfolio(b: TelegramBot, chatId: number, wallet: string) {
    const stats = getAgentStats(wallet);
    const allocations = getCurrentAllocations(wallet);
    let yields: any[] = [];
    try { yields = await fetchYieldData(); } catch { /* Yield API unavailable — use empty defaults */ }

    const roi = (stats.cumulativeROIBps / 100).toFixed(2);
    const totalValueUSD = await getPortfolioValue(wallet);

    let allocText = "";
    allocations.forEach((a) => {
      const pct = (a.allocationBps / 100).toFixed(1);
      const bar = "\u2588".repeat(Math.round(a.allocationBps / 500)) + "\u2591".repeat(20 - Math.round(a.allocationBps / 500));
      const yieldData = yields.find((y) => y.symbol === a.symbol);
      const apy = yieldData ? yieldData.apy.toFixed(2) : "\u2014";
      const balanceUSD = Math.round((totalValueUSD * a.allocationBps) / 10000);
      allocText += `\n*${a.symbol}* ${pct}%  $${balanceUSD.toLocaleString()}\n\`${bar}\`  ${apy}% APY\n`;
    });

    const blended = yields.length > 0
      ? allocations.reduce((sum, a) => { const y = yields.find((yd) => yd.symbol === a.symbol); return sum + ((y?.apy ?? 0) * a.allocationBps) / 10000; }, 0)
      : 3.8;

    b.sendMessage(chatId,
      `\u{1F4CA} *Treasury Status*\n\n*Value:* $${Math.round(totalValueUSD).toLocaleString()}\n*Yield:* ${blended.toFixed(2)}% APY\n*ROI:* ${Number(roi) >= 0 ? "+" : ""}${roi}%\n*Decisions:* ${stats.totalDecisions}\n${allocText}\nMantle Mainnet`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[
        { text: "\u{1F4C8} Yields", callback_data: "quick_yields" },
        { text: "\u{1F6E1} Risk", callback_data: "quick_risk" },
        { text: "\u{1F9E0} Agents", callback_data: "quick_agents" },
      ]] } }
    );
  }

  async function sendYields(b: TelegramBot, chatId: number, wallet: string) {
    try {
      const yields = await fetchYieldData();
      const sorted = [...yields].sort((a, b) => b.apy - a.apy);
      let text = "\u{1F4C8} *Live Yield Rates*\n\n";
      sorted.forEach((y, i) => {
        const medal = i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : "\u{1F949}";
        text += `${medal} *${y.symbol}:* ${y.apy.toFixed(2)}% APY\n   ${y.source} | TVL: $${(y.tvl / 1_000_000).toFixed(0)}M\n`;
      });
      if (wallet) {
        const allocations = getCurrentAllocations(wallet);
        const blended = allocations.reduce((sum, a) => { const y = yields.find((yd) => yd.symbol === a.symbol); return sum + ((y?.apy ?? 0) * a.allocationBps) / 10000; }, 0);
        text += `\n*Your blended yield:* ${blended.toFixed(2)}% APY`;
      }
      b.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch {
      b.sendMessage(chatId, "Yield data is temporarily unavailable.");
    }
  }

  function sendRisk(b: TelegramBot, chatId: number, wallet: string) {
    const allocations = getCurrentAllocations(wallet);
    const history = getDecisionHistory(wallet);
    const lastCycle = history[history.length - 1];

    let riskScore = 3.0;
    if (lastCycle) riskScore = lastCycle.risk.riskScore;

    const emoji = riskScore > 7 ? "\u{1F534}" : riskScore > 4 ? "\u{1F7E1}" : "\u{1F7E2}";

    let text = `\u{1F6E1} *Risk Assessment*\n\n`;
    text += `${emoji} *Score:* ${riskScore.toFixed(1)} / 10\n*Max Drawdown Est:* ${(riskScore * 1.5).toFixed(1)}%\n\n`;
    allocations.forEach((a) => {
      const pct = (a.allocationBps / 100).toFixed(0);
      text += `${a.symbol}: ${pct}%${a.allocationBps > 5000 ? " \u26A0\uFE0F" : " \u2705"}\n`;
    });
    const stableAlloc = allocations.filter((a) => a.symbol === "USDC" || a.symbol === "USDY").reduce((s, a) => s + a.allocationBps, 0);
    text += `\nStables: ${(stableAlloc / 100).toFixed(0)}%${stableAlloc >= 2000 ? " \u2705" : " \u26A0\uFE0F low"}`;

    b.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[
        { text: "\u{1F6E1} Conservative", callback_data: "risk_conservative" },
        { text: "\u2696\uFE0F Moderate", callback_data: "risk_moderate" },
        { text: "\u{1F680} Aggressive", callback_data: "risk_aggressive" },
      ]] },
    });
  }

  function sendLastDecision(b: TelegramBot, chatId: number, wallet: string) {
    const history = getDecisionHistory(wallet);
    if (history.length === 0) { b.sendMessage(chatId, "No decisions yet."); return; }
    const last = history[history.length - 1];
    const d = last.decision;
    const ago = Math.floor((Date.now() - last.timestamp) / 60000);
    let text = `\u{1F916} *Last Decision* (${ago}m ago)\n\n*${d.action.toUpperCase()}* | ${d.riskLevel} risk | ${d.confidence}% confidence\n\n${d.reasoning}\n\n_Market: ${d.agentContributions.market}_\n_Yield: ${d.agentContributions.yield}_\n_Risk: ${d.agentContributions.risk}_`;
    if (last.txHash) text += `\n\n[View on Explorer](https://mantlescan.xyz/tx/${last.txHash})`;
    b.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  function sendAgents(b: TelegramBot, chatId: number, wallet: string) {
    const stats = getAgentStats(wallet);
    const history = getDecisionHistory(wallet);
    const last = history[history.length - 1];
    let text = `\u{1F9E0} *Sub-Agent Status*\n\n`;
    text += `*Market* \u{1F7E2} ${last?.market ? `${last.market.outlook}, ${last.market.confidence}% conf` : "warming up"}\n`;
    text += `*Yield* \u{1F7E2} ${last?.yields ? `${last.yields.bestYieldAsset} at ${last.yields.bestYieldApy.toFixed(2)}%` : "warming up"}\n`;
    text += `*Risk* \u{1F7E2} ${last?.risk ? `score ${last.risk.riskScore.toFixed(1)}/10` : "warming up"}\n`;
    text += `*Portfolio* \u{1F7E2} ${stats.totalDecisions} decisions, ${(stats.cumulativeROIBps / 100).toFixed(2)}% ROI\n\n_Cycle interval: ${config.intervalMs / 1000}s_`;
    b.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  function sendAutonomous(b: TelegramBot, chatId: number, wallet: string) {
    const status = getAutonomousStatus(wallet);
    let text = `\u26A1 *Autonomous Trading*\n\n`;
    text += status.enabled
      ? `\u{1F7E2} *ON* — AI trades automatically within your limits\n\n`
      : `\u{1F534} *OFF* — AI will ask for your approval before every trade\n\n`;
    text += `*Your Limits:*\n`;
    text += `  Max move per token: ${(status.maxPortfolioChangeBps / 100).toFixed(0)}% _(e.g. can't shift more than ${(status.maxPortfolioChangeBps / 100).toFixed(0)}% of USDY in one trade)_\n`;
    text += `  Max trades per day: ${status.maxDailyTrades} _(used ${status.tradesToday} today)_\n`;
    text += `  Min AI confidence: ${status.minConfidence}% _(AI must be at least this sure before trading)_\n`;
    text += `  Max risk score: ${status.maxRiskScore}/10 _(won't trade if market risk is above this)_\n`;
    text += `\nTrades that exceed these limits still require your /approve.\n`;

    b.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: status.enabled ? "\u{1F534} Turn OFF" : "\u{1F7E2} Turn ON", callback_data: status.enabled ? "auto_disable" : "auto_enable" }],
          [
            { text: "Safe (10%)", callback_data: "auto_maxchange_1000" },
            { text: "Normal (20%)", callback_data: "auto_maxchange_2000" },
            { text: "Bold (30%)", callback_data: "auto_maxchange_3000" },
          ],
          [
            { text: "2 trades/day", callback_data: "auto_maxtrades_2" },
            { text: "3 trades/day", callback_data: "auto_maxtrades_3" },
            { text: "5 trades/day", callback_data: "auto_maxtrades_5" },
          ],
          [
            { text: "Low bar (50%)", callback_data: "auto_minconf_50" },
            { text: "Medium (70%)", callback_data: "auto_minconf_70" },
            { text: "High bar (80%)", callback_data: "auto_minconf_80" },
          ],
        ],
      },
    });
  }

  function sendDca(b: TelegramBot, chatId: number, wallet: string) {
    const plans = getDcaPlans(wallet);
    if (plans.length === 0) {
      b.sendMessage(chatId, `\u{1F504} *DCA Plans*\n\nNo active DCA plans.`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[{ text: "\u2795 Create DCA Plan", callback_data: "dca_create" }]] },
      });
      return;
    }
    let text = `\u{1F504} *DCA Plans* (${plans.length})\n\n`;
    const buttons: TelegramBot.InlineKeyboardButton[][] = [];
    plans.forEach((plan) => {
      const status = plan.enabled ? "\u{1F7E2}" : "\u23F8\uFE0F";
      text += `${status} *${plan.sourceAsset} \u2192 ${plan.targetAsset}*\n   ${plan.amountBps / 100}% every ${formatInterval(plan.intervalMs)} | #${plan.totalExecutions} fills\n\n`;
      buttons.push([
        { text: plan.enabled ? `\u23F8 Pause` : `\u25B6 Resume`, callback_data: plan.enabled ? `dca_pause_${plan.id}` : `dca_resume_${plan.id}` },
        { text: `\u274C Cancel`, callback_data: `dca_cancel_${plan.id}` },
      ]);
    });
    buttons.push([{ text: "\u2795 Create DCA Plan", callback_data: "dca_create" }]);
    b.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } });
  }

  function sendPlans(b: TelegramBot, chatId: number, wallet: string) {
    const tasks = getScheduledTasks(wallet);
    if (tasks.length === 0) {
      b.sendMessage(chatId, `\u{1F4C5} *Scheduled Tasks*\n\nNo scheduled tasks.`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "\u{1F4C6} Weekly Rebalance", callback_data: "plan_weekly" }, { text: "\u{1F6E1} Safety Shift", callback_data: "plan_safety" }],
          [{ text: "\u{1F4B0} Yield Chase", callback_data: "plan_yield" }],
        ] },
      });
      return;
    }
    let text = `\u{1F4C5} *Scheduled Tasks* (${tasks.length})\n\n`;
    const buttons: TelegramBot.InlineKeyboardButton[][] = [];
    tasks.forEach((task) => {
      const status = task.enabled ? "\u{1F7E2}" : "\u23F8\uFE0F";
      text += `${status} *${task.name}* (${task.type.replace("_", " ")})\n   Executions: ${task.totalExecutions}`;
      if (task.condition) text += `\n   Trigger: ${task.condition.asset} ${task.condition.operator} $${task.condition.priceUSD.toLocaleString()}`;
      text += "\n\n";
      buttons.push([
        { text: task.enabled ? `\u23F8 Pause` : `\u25B6 Resume`, callback_data: task.enabled ? `plan_pause_${task.id}` : `plan_resume_${task.id}` },
        { text: `\u274C Cancel`, callback_data: `plan_cancel_${task.id}` },
      ]);
    });
    buttons.push([{ text: "\u{1F4C6} Weekly Rebalance", callback_data: "plan_weekly" }, { text: "\u{1F6E1} Safety Shift", callback_data: "plan_safety" }]);
    b.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } });
  }

  async function handleApproval(b: TelegramBot, chatId: number, wallet: string, approved: boolean) {
    const pending = getPendingApproval(wallet);
    if (!pending) { b.sendMessage(chatId, `No pending trade to ${approved ? "approve" : "reject"}.`); return; }

    if (approved) {
      b.sendMessage(chatId, "Submitting to Mantle...");
      const success = await approveDecision(wallet);
      if (success) {
        const stats = getAgentStats(wallet);
        b.sendMessage(chatId, `*Trade executed.* \u2705\n\nDecision #${stats.totalDecisions} is now on-chain.`, { parse_mode: "Markdown" });
      } else {
        b.sendMessage(chatId, "Trade failed. Check agent logs.");
      }
    } else {
      rejectDecision(wallet);
      b.sendMessage(chatId, "*Trade rejected.* I'll reassess next cycle.", { parse_mode: "Markdown" });
    }
  }

  return bot;
}

// --- Notification System ---
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

export function notifyUserByWallet(wallet: string, decision: {
  action: string;
  confidence: number;
  reasoning: string;
  riskLevel: string;
  newAllocations: { symbol: string; allocationBps: number }[];
}, txHash: string | null) {
  if (!botInstance) return;
  const chatId = getLinkedChat(wallet);
  if (!chatId) return;

  const allocText = decision.newAllocations
    .map((a) => `${a.symbol}: ${(a.allocationBps / 100).toFixed(1)}%`)
    .join(" | ");

  let text = `*Portfolio updated* \u{1F4E2}\n\n${decision.reasoning}\n\n*Allocation:* ${allocText}\n${decision.confidence}% confidence | ${decision.riskLevel} risk`;
  if (txHash) text += `\n\n[View on Explorer](https://mantlescan.xyz/tx/${txHash})`;

  botInstance.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch(() => {});
}

export function notifyDecision(decision: {
  action: string;
  confidence: number;
  reasoning: string;
  riskLevel: string;
  newAllocations: { symbol: string; allocationBps: number }[];
}, txHash: string | null) {
  // Broadcast to all linked users for this wallet
  const allocText = decision.newAllocations
    .map((a) => `${a.symbol}: ${(a.allocationBps / 100).toFixed(1)}%`)
    .join(" | ");

  let text = `*Portfolio updated* \u{1F4E2}\n\n${decision.reasoning}\n\n*Allocation:* ${allocText}\n${decision.confidence}% confidence | ${decision.riskLevel} risk`;
  if (txHash) text += `\n\n[View on Explorer](https://mantlescan.xyz/tx/${txHash})`;

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

  let text = `*Trade needs your approval* \u26A0\uFE0F\n\n${decision.reasoning}\n\n*Proposed:* ${allocText}\nConfidence: ${decision.confidence}%`;

  if (!botInstance) return;
  const linked = getAllLinkedWallets();
  const chatIds = new Set(Object.values(linked));
  chatIds.forEach((chatId) => {
    botInstance!.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "\u2705 Approve", callback_data: "approve_trade" },
          { text: "\u274C Reject", callback_data: "reject_trade" },
        ]],
      },
    }).catch(() => {});
  });
}

// --- HTTP API for dashboard linking (Vercel -> Railway) ---

function startLinkApiServer() {
  const port = parseInt(process.env.PORT || "3001");
  if (port === 0) return; // Skip when running alongside Next.js
  const allowedOrigins = (process.env.CORS_ORIGINS || "*").split(",");

  const server = http.createServer(async (req, res) => {
    // CORS headers
    const origin = req.headers.origin || "*";
    const allowOrigin = allowedOrigins.includes("*") ? "*" : (allowedOrigins.includes(origin) ? origin : "");
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const sendJson = (data: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return sendJson({ status: "ok", service: "sentinel-agent" });
    }

    // GET /api/telegram-link?wallet=0x...
    if (req.method === "GET" && url.pathname === "/api/telegram-link") {
      const wallet = url.searchParams.get("wallet");
      if (!wallet) return sendJson({ error: "wallet param required" }, 400);
      const linked = isWalletLinked(wallet);
      const chatId = getLinkedChat(wallet);
      return sendJson({ linked, chatId });
    }

    // POST /api/telegram-link  { walletAddress: "0x..." }
    if (req.method === "POST" && url.pathname === "/api/telegram-link") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const { walletAddress } = JSON.parse(body);
        if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
          return sendJson({ error: "Invalid wallet address" }, 400);
        }
        if (isWalletLinked(walletAddress)) {
          return sendJson({ linked: true });
        }
        const token = createLinkToken(walletAddress);
        return sendJson({ token, expiresIn: 600 });
      } catch {
        return sendJson({ error: "Invalid request body" }, 400);
      }
    }

    // DELETE /api/telegram-link  { walletAddress: "0x..." }
    if (req.method === "DELETE" && url.pathname === "/api/telegram-link") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const { walletAddress } = JSON.parse(body);
        if (!walletAddress) return sendJson({ error: "walletAddress required" }, 400);
        const unlinked = unlinkWallet(walletAddress);
        return sendJson({ unlinked });
      } catch {
        return sendJson({ error: "Invalid request body" }, 400);
      }
    }

    sendJson({ error: "Not found" }, 404);
  });

  server.listen(port, () => {
    console.log(`[API] Link API server running on port ${port}`);
  });
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

  // Start HTTP API server for dashboard communication (Vercel -> Railway)
  startLinkApiServer();
}
