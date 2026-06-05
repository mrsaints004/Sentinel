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
} from "./index";
import { fetchYieldData, fetchPriceData } from "./dataFeeds";
import { getCrossChainOpportunities } from "./skills/byrealSkill";
import { verifyLinkToken, getAllLinkedWallets } from "./linkStore";

// --- Gemini AI for conversational responses ---
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_MODEL = "gemini-2.0-flash";

function getGeminiClient(): OpenAI | null {
  if (!config.openaiApiKey) return null;
  return new OpenAI({ apiKey: config.openaiApiKey, baseURL: GEMINI_BASE_URL });
}

function buildContext(): string {
  const stats = getAgentStats();
  const allocations = getCurrentAllocations();
  const history = getDecisionHistory();
  const lastCycle = history[history.length - 1];
  const autoStatus = getAutonomousStatus();
  const pending = getPendingApproval();

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
    if (lastCycle.risk.exposureWarnings.length > 0) {
      context += `- Warnings: ${lastCycle.risk.exposureWarnings.map((w: any) => `${w.asset}: ${w.issue}`).join("; ")}\n`;
    }
    if (lastCycle.txHash) {
      context += `- TX: https://mantlescan.xyz/tx/${lastCycle.txHash}\n`;
    }
  }

  return context;
}

async function askAI(userMessage: string): Promise<string> {
  const client = getGeminiClient();
  if (!client) return "";

  const context = buildContext();

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
      model: GEMINI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 400,
    });

    return response.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error("[Telegram AI] Gemini call failed:", error);
    return "";
  }
}

// Detect user intent to decide whether to show inline buttons alongside AI response
function detectIntent(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.match(/\b(risk profile|risk level|change risk|set risk|conservative|moderate|aggressive)\b/)) return "setrisk";
  if (lower.match(/\b(approve|reject|pending)\b/) && getPendingApproval()) return "approval";
  if (lower.match(/\b(autonomous|auto mode|auto trading|self.?trading)\b/)) return "autonomous";
  if (lower.match(/\b(portfolio|treasury|holdings|balance|how.*doing|status)\b/)) return "portfolio";
  if (lower.match(/\b(yield|apy|rates|interest|earn)\b/)) return "yields";
  if (lower.match(/\b(risk|danger|safe|exposure|drawdown)\b/)) return "risk";
  if (lower.match(/\b(last decision|why did|explain|reasoning|last trade)\b/)) return "lastdecision";
  if (lower.match(/\b(agents?|sub.?agents?|market agent|yield agent|risk agent)\b/)) return "agents";
  if (lower.match(/\b(cross.?chain|solana|byreal|other chains)\b/)) return "byreal";
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

  // --- Slash commands still work as quick shortcuts ---

  bot.onText(/\/portfolio/, (msg) => sendPortfolio(bot, msg.chat.id));
  bot.onText(/\/yields/, (msg) => sendYields(bot, msg.chat.id));
  bot.onText(/\/risk/, (msg) => sendRisk(bot, msg.chat.id));
  bot.onText(/\/lastdecision/, (msg) => sendLastDecision(bot, msg.chat.id));
  bot.onText(/\/agents/, (msg) => sendAgents(bot, msg.chat.id));
  bot.onText(/\/autonomous/, (msg) => sendAutonomous(bot, msg.chat.id));
  bot.onText(/\/byreal/, (msg) => sendByreal(bot, msg.chat.id));
  bot.onText(/\/approve/, (msg) => handleApproval(bot, msg.chat.id, true));
  bot.onText(/\/reject/, (msg) => handleApproval(bot, msg.chat.id, false));

  bot.onText(/\/setrisk/, (msg) => {
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

  bot.onText(/\/dca/, (msg) => sendDca(bot, msg.chat.id));
  bot.onText(/\/plans/, (msg) => sendPlans(bot, msg.chat.id));

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
        `/approve \u2014 Approve pending trade\n` +
        `/reject \u2014 Reject pending trade\n` +
        `/byreal \u2014 Cross-chain yields\n\n` +
        `But honestly, just ask me anything in your own words.`,
      { parse_mode: "Markdown" }
    );
  });

  // --- Callback queries (inline buttons) ---
  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId) return;
    const data = query.data || "";

    // Quick action buttons
    if (data === "quick_portfolio") { bot.answerCallbackQuery(query.id); sendPortfolio(bot, chatId); return; }
    if (data === "quick_yields") { bot.answerCallbackQuery(query.id); sendYields(bot, chatId); return; }
    if (data === "quick_risk") { bot.answerCallbackQuery(query.id); sendRisk(bot, chatId); return; }
    if (data === "quick_agents") { bot.answerCallbackQuery(query.id); sendAgents(bot, chatId); return; }
    if (data === "quick_autonomous") { bot.answerCallbackQuery(query.id); sendAutonomous(bot, chatId); return; }

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

    // Risk profile selection
    if (data.startsWith("risk_")) {
      const profile = data.replace("risk_", "") as "conservative" | "moderate" | "aggressive";
      setRiskProfile(profile);
      bot.answerCallbackQuery(query.id, { text: `Set to ${profile}` });
      bot.sendMessage(
        chatId,
        `Done \u2014 risk profile is now *${profile}*. I'll adjust your allocations in the next cycle to match.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Trade approval buttons
    if (data === "approve_trade") {
      bot.answerCallbackQuery(query.id, { text: "Approving..." });
      handleApproval(bot, chatId, true);
      return;
    }
    if (data === "reject_trade") {
      bot.answerCallbackQuery(query.id, { text: "Rejected" });
      handleApproval(bot, chatId, false);
      return;
    }

    // Autonomous mode buttons
    if (data === "auto_enable") {
      toggleAutonomous(true);
      bot.answerCallbackQuery(query.id, { text: "Enabled!" });
      bot.sendMessage(chatId, "Autonomous mode is *ON*. I'll execute trades within your limits without asking.", { parse_mode: "Markdown" });
      return;
    }
    if (data === "auto_disable") {
      toggleAutonomous(false);
      bot.answerCallbackQuery(query.id, { text: "Disabled" });
      bot.sendMessage(chatId, "Autonomous mode is *OFF*. I'll ask for your approval before every trade.", { parse_mode: "Markdown" });
      return;
    }
    if (data.startsWith("auto_maxchange_")) {
      const bps = parseInt(data.replace("auto_maxchange_", ""));
      updateAutonomousRules({ maxPortfolioChangeBps: bps });
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, `Max portfolio change per asset set to *${bps / 100}%*.`, { parse_mode: "Markdown" });
      return;
    }
    if (data.startsWith("auto_maxtrades_")) {
      const max = parseInt(data.replace("auto_maxtrades_", ""));
      updateAutonomousRules({ maxDailyTrades: max });
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, `Max daily trades set to *${max}*.`, { parse_mode: "Markdown" });
      return;
    }
    if (data.startsWith("auto_minconf_")) {
      const conf = parseInt(data.replace("auto_minconf_", ""));
      updateAutonomousRules({ minConfidence: conf });
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, `Minimum confidence threshold set to *${conf}%*.`, { parse_mode: "Markdown" });
      return;
    }

    // --- DCA callbacks ---
    if (data === "quick_dca") { bot.answerCallbackQuery(query.id); sendDca(bot, chatId); return; }
    if (data === "quick_plans") { bot.answerCallbackQuery(query.id); sendPlans(bot, chatId); return; }

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
        reply_markup: {
          inline_keyboard: [
            otherAssets.map((a) => ({ text: a, callback_data: `dca_source_${a}_${target}` })),
          ],
        },
      });
      return;
    }

    if (data.startsWith("dca_source_")) {
      const parts = data.replace("dca_source_", "").split("_");
      const source = parts[0];
      const target = parts[1];
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, `How much per execution? (% of portfolio)`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "0.5%", callback_data: `dca_amount_50_${source}_${target}` },
              { text: "1%", callback_data: `dca_amount_100_${source}_${target}` },
              { text: "2%", callback_data: `dca_amount_200_${source}_${target}` },
              { text: "5%", callback_data: `dca_amount_500_${source}_${target}` },
            ],
          ],
        },
      });
      return;
    }

    if (data.startsWith("dca_amount_")) {
      const parts = data.replace("dca_amount_", "").split("_");
      const amountBps = parseInt(parts[0]);
      const source = parts[1];
      const target = parts[2];
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, `How often?`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Every 1h", callback_data: `dca_interval_3600000_${amountBps}_${source}_${target}` },
              { text: "Every 4h", callback_data: `dca_interval_14400000_${amountBps}_${source}_${target}` },
            ],
            [
              { text: "Every 12h", callback_data: `dca_interval_43200000_${amountBps}_${source}_${target}` },
              { text: "Every 24h", callback_data: `dca_interval_86400000_${amountBps}_${source}_${target}` },
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

      const plan = createDcaPlan({ sourceAsset: source, targetAsset: target, amountBps, intervalMs });
      bot.sendMessage(
        chatId,
        `*DCA Plan Created* \u2705\n\n` +
          `${source} \u2192 ${target}\n` +
          `Amount: ${amountBps / 100}% per execution\n` +
          `Interval: every ${formatInterval(intervalMs)}\n` +
          `Next execution: ${new Date(plan.nextExecutionAt).toLocaleString()}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (data.startsWith("dca_pause_")) {
      const id = data.replace("dca_pause_", "");
      pauseDcaPlan(id);
      bot.answerCallbackQuery(query.id, { text: "Paused" });
      sendDca(bot, chatId);
      return;
    }

    if (data.startsWith("dca_resume_")) {
      const id = data.replace("dca_resume_", "");
      resumeDcaPlan(id);
      bot.answerCallbackQuery(query.id, { text: "Resumed" });
      sendDca(bot, chatId);
      return;
    }

    if (data.startsWith("dca_cancel_")) {
      const id = data.replace("dca_cancel_", "");
      removeDcaPlan(id);
      bot.answerCallbackQuery(query.id, { text: "Cancelled" });
      bot.sendMessage(chatId, "DCA plan cancelled.", { parse_mode: "Markdown" });
      return;
    }

    // --- Scheduled task callbacks ---
    if (data === "plan_weekly") {
      bot.answerCallbackQuery(query.id);
      try {
        createWeeklyRebalance();
        bot.sendMessage(
          chatId,
          `*Weekly Rebalance Created* \u2705\n\nForced rebalance every Sunday at 00:00 UTC.`,
          { parse_mode: "Markdown" }
        );
      } catch (err: any) {
        bot.sendMessage(chatId, `Could not create: ${err.message}`);
      }
      return;
    }

    if (data === "plan_safety") {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, "Set mETH price trigger (USD). If mETH drops *below* this price, 20% shifts to stablecoins.\n\nPick a threshold:", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "$2,500", callback_data: "plan_safety_2500" },
              { text: "$2,000", callback_data: "plan_safety_2000" },
              { text: "$1,500", callback_data: "plan_safety_1500" },
            ],
          ],
        },
      });
      return;
    }

    if (data.startsWith("plan_safety_")) {
      const price = parseInt(data.replace("plan_safety_", ""));
      bot.answerCallbackQuery(query.id);
      try {
        createSafetyShift(price);
        bot.sendMessage(
          chatId,
          `*Safety Shift Created* \u2705\n\nIf mETH drops below $${price.toLocaleString()}, 20% of mETH shifts to stablecoins.`,
          { parse_mode: "Markdown" }
        );
      } catch (err: any) {
        bot.sendMessage(chatId, `Could not create Safety Shift: ${err.message}`);
      }
      return;
    }

    if (data === "plan_yield") {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, "Set mETH price target (USD). If mETH goes *above* this price, mETH allocation increases to 50%.\n\nPick a threshold:", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "$3,000", callback_data: "plan_yield_3000" },
              { text: "$3,500", callback_data: "plan_yield_3500" },
              { text: "$4,000", callback_data: "plan_yield_4000" },
            ],
          ],
        },
      });
      return;
    }

    if (data.startsWith("plan_yield_")) {
      const price = parseInt(data.replace("plan_yield_", ""));
      bot.answerCallbackQuery(query.id);
      try {
        createYieldChase(price);
        bot.sendMessage(
          chatId,
          `*Yield Chase Created* \u2705\n\nIf mETH goes above $${price.toLocaleString()}, mETH allocation increases to 50%.`,
          { parse_mode: "Markdown" }
        );
      } catch (err: any) {
        bot.sendMessage(chatId, `Could not create: ${err.message}`);
      }
      return;
    }

    if (data.startsWith("plan_pause_")) {
      const id = data.replace("plan_pause_", "");
      pauseScheduledTask(id);
      bot.answerCallbackQuery(query.id, { text: "Paused" });
      sendPlans(bot, chatId);
      return;
    }

    if (data.startsWith("plan_resume_")) {
      const id = data.replace("plan_resume_", "");
      resumeScheduledTask(id);
      bot.answerCallbackQuery(query.id, { text: "Resumed" });
      sendPlans(bot, chatId);
      return;
    }

    if (data.startsWith("plan_cancel_")) {
      const id = data.replace("plan_cancel_", "");
      removeScheduledTask(id);
      bot.answerCallbackQuery(query.id, { text: "Cancelled" });
      bot.sendMessage(chatId, "Scheduled task cancelled.", { parse_mode: "Markdown" });
      return;
    }
  });

  // --- Main message handler: AI-powered natural language ---
  bot.on("message", async (msg) => {
    if (msg.text?.startsWith("/")) return;
    const chatId = msg.chat.id;
    const userText = msg.text || "";
    if (!userText.trim()) return;

    // Show typing indicator
    bot.sendChatAction(chatId, "typing");

    // Detect if user wants an action (show buttons alongside AI response)
    const intent = detectIntent(userText);

    // Get AI response
    let aiResponse = await askAI(userText);

    // If AI failed, provide a sensible fallback using intent
    if (!aiResponse) {
      if (intent === "portfolio") { sendPortfolio(bot, chatId); return; }
      if (intent === "yields") { sendYields(bot, chatId); return; }
      if (intent === "risk") { sendRisk(bot, chatId); return; }
      if (intent === "lastdecision") { sendLastDecision(bot, chatId); return; }
      if (intent === "agents") { sendAgents(bot, chatId); return; }
      if (intent === "autonomous") { sendAutonomous(bot, chatId); return; }
      if (intent === "byreal") { sendByreal(bot, chatId); return; }
      if (intent === "dca") { sendDca(bot, chatId); return; }
      if (intent === "plans") { sendPlans(bot, chatId); return; }

      // Generic fallback
      const stats = getAgentStats();
      const alloc = getCurrentAllocations();
      bot.sendMessage(
        chatId,
        `Your portfolio is at *${(stats.cumulativeROIBps / 100).toFixed(2)}% ROI* with ${alloc.map((a) => `${a.symbol} ${(a.allocationBps / 100).toFixed(0)}%`).join(", ")}.\n\n` +
          `What would you like to know?`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "\u{1F4CA} Portfolio", callback_data: "quick_portfolio" },
                { text: "\u{1F4C8} Yields", callback_data: "quick_yields" },
                { text: "\u{1F6E1} Risk", callback_data: "quick_risk" },
              ],
            ],
          },
        }
      );
      return;
    }

    // Build inline buttons based on detected intent
    let replyMarkup: TelegramBot.InlineKeyboardMarkup | undefined;

    if (intent === "setrisk") {
      replyMarkup = {
        inline_keyboard: [
          [
            { text: "\u{1F6E1} Conservative", callback_data: "risk_conservative" },
            { text: "\u2696\uFE0F Moderate", callback_data: "risk_moderate" },
            { text: "\u{1F680} Aggressive", callback_data: "risk_aggressive" },
          ],
        ],
      };
    } else if (intent === "approval") {
      replyMarkup = {
        inline_keyboard: [
          [
            { text: "\u2705 Approve Trade", callback_data: "approve_trade" },
            { text: "\u274C Reject Trade", callback_data: "reject_trade" },
          ],
        ],
      };
    } else if (intent === "autonomous") {
      const status = getAutonomousStatus();
      replyMarkup = {
        inline_keyboard: [
          [
            {
              text: status.enabled ? "\u{1F534} Disable Auto Mode" : "\u{1F7E2} Enable Auto Mode",
              callback_data: status.enabled ? "auto_disable" : "auto_enable",
            },
          ],
          [
            { text: "Max 10%/asset", callback_data: "auto_maxchange_1000" },
            { text: "Max 20%/asset", callback_data: "auto_maxchange_2000" },
            { text: "Max 30%/asset", callback_data: "auto_maxchange_3000" },
          ],
          [
            { text: "2 trades/day", callback_data: "auto_maxtrades_2" },
            { text: "3 trades/day", callback_data: "auto_maxtrades_3" },
            { text: "5 trades/day", callback_data: "auto_maxtrades_5" },
          ],
        ],
      };
    } else if (intent === "dca") {
      const plans = getDcaPlans();
      replyMarkup = {
        inline_keyboard: [
          [
            { text: `\u{1F504} DCA Plans (${plans.length})`, callback_data: "quick_dca" },
            { text: "\u2795 Create DCA", callback_data: "dca_create" },
          ],
        ],
      };
    } else if (intent === "plans") {
      replyMarkup = {
        inline_keyboard: [
          [
            { text: "\u{1F4C5} View Plans", callback_data: "quick_plans" },
            { text: "\u{1F4C6} Weekly Rebalance", callback_data: "plan_weekly" },
          ],
          [
            { text: "\u{1F6E1} Safety Shift", callback_data: "plan_safety" },
            { text: "\u{1F4B0} Yield Chase", callback_data: "plan_yield" },
          ],
        ],
      };
    } else if (intent === "portfolio" || intent === "yields" || intent === "risk") {
      // Add subtle follow-up buttons
      replyMarkup = {
        inline_keyboard: [
          [
            { text: "\u{1F4CA} Full Portfolio", callback_data: "quick_portfolio" },
            { text: "\u{1F4C8} Yields", callback_data: "quick_yields" },
            { text: "\u{1F6E1} Risk", callback_data: "quick_risk" },
          ],
        ],
      };
    }

    bot.sendMessage(chatId, aiResponse, {
      parse_mode: "Markdown",
      reply_markup: replyMarkup,
    }).catch(() => {
      // If markdown parsing fails, send without formatting
      bot.sendMessage(chatId, aiResponse, { reply_markup: replyMarkup });
    });
  });

  // --- Data display functions ---

  async function sendPortfolio(b: TelegramBot, chatId: number) {
    const stats = getAgentStats();
    const allocations = getCurrentAllocations();
    let yields: any[] = [];
    try { yields = await fetchYieldData(); } catch {}

    const roi = (stats.cumulativeROIBps / 100).toFixed(2);
    const totalValueUSD = 100000 * (1 + stats.cumulativeROIBps / 10000);

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
      ? allocations.reduce((sum, a) => {
          const y = yields.find((yd) => yd.symbol === a.symbol);
          return sum + ((y?.apy ?? 0) * a.allocationBps) / 10000;
        }, 0)
      : 3.8;

    b.sendMessage(
      chatId,
      `\u{1F4CA} *Treasury Status*\n\n` +
        `*Value:* $${Math.round(totalValueUSD).toLocaleString()}\n` +
        `*Yield:* ${blended.toFixed(2)}% APY\n` +
        `*ROI:* ${Number(roi) >= 0 ? "+" : ""}${roi}%\n` +
        `*Decisions:* ${stats.totalDecisions}\n` +
        `${allocText}\n` +
        `Mantle Mainnet | Agent Identity NFT #1`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "\u{1F4C8} Yields", callback_data: "quick_yields" },
              { text: "\u{1F6E1} Risk", callback_data: "quick_risk" },
              { text: "\u{1F9E0} Agents", callback_data: "quick_agents" },
            ],
          ],
        },
      }
    );
  }

  async function sendYields(b: TelegramBot, chatId: number) {
    try {
      const yields = await fetchYieldData();
      const sorted = [...yields].sort((a, b) => b.apy - a.apy);
      let text = "\u{1F4C8} *Live Yield Rates*\n\n";
      sorted.forEach((y, i) => {
        const medal = i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : "\u{1F949}";
        text += `${medal} *${y.symbol}:* ${y.apy.toFixed(2)}% APY\n`;
        text += `   ${y.source} | TVL: $${(y.tvl / 1_000_000).toFixed(0)}M\n`;
      });

      const allocations = getCurrentAllocations();
      const blended = allocations.reduce((sum, a) => {
        const y = yields.find((yd) => yd.symbol === a.symbol);
        return sum + ((y?.apy ?? 0) * a.allocationBps) / 10000;
      }, 0);
      text += `\n*Your blended yield:* ${blended.toFixed(2)}% APY`;

      b.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch {
      b.sendMessage(chatId, "Yield data is temporarily unavailable. Try again in a moment.");
    }
  }

  function sendRisk(b: TelegramBot, chatId: number) {
    const allocations = getCurrentAllocations();
    const history = getDecisionHistory();
    const lastCycle = history[history.length - 1];

    let riskScore = 3.0;
    if (lastCycle) riskScore = lastCycle.risk.riskScore;

    const emoji = riskScore > 7 ? "\u{1F534}" : riskScore > 4 ? "\u{1F7E1}" : "\u{1F7E2}";

    let text = `\u{1F6E1} *Risk Assessment*\n\n`;
    text += `${emoji} *Score:* ${riskScore.toFixed(1)} / 10\n`;
    text += `*Max Drawdown Est:* ${(riskScore * 1.5).toFixed(1)}%\n\n`;

    allocations.forEach((a) => {
      const pct = (a.allocationBps / 100).toFixed(0);
      const flag = a.allocationBps > 5000 ? " \u26A0\uFE0F" : " \u2705";
      text += `${a.symbol}: ${pct}%${flag}\n`;
    });

    const stableAlloc = allocations
      .filter((a) => a.symbol === "USDC" || a.symbol === "USDY")
      .reduce((s, a) => s + a.allocationBps, 0);
    text += `\nStables: ${(stableAlloc / 100).toFixed(0)}%${stableAlloc >= 2000 ? " \u2705" : " \u26A0\uFE0F low"}`;

    if (lastCycle?.risk.exposureWarnings.length > 0) {
      text += `\n\n*Warnings:*\n`;
      lastCycle.risk.exposureWarnings.forEach((w: any) => {
        text += `\u2022 [${w.severity}] ${w.asset}: ${w.issue}\n`;
      });
    }

    b.sendMessage(chatId, text, {
      parse_mode: "Markdown",
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
  }

  function sendLastDecision(b: TelegramBot, chatId: number) {
    const history = getDecisionHistory();
    if (history.length === 0) {
      b.sendMessage(chatId, "No decisions yet \u2014 the agent is still warming up.");
      return;
    }

    const last = history[history.length - 1];
    const d = last.decision;
    const ago = Math.floor((Date.now() - last.timestamp) / 60000);

    let text = `\u{1F916} *Last Decision* (${ago}m ago)\n\n`;
    text += `*${d.action.toUpperCase()}* | ${d.riskLevel} risk | ${d.confidence}% confidence\n\n`;
    text += `${d.reasoning}\n\n`;
    text += `_Market: ${d.agentContributions.market}_\n`;
    text += `_Yield: ${d.agentContributions.yield}_\n`;
    text += `_Risk: ${d.agentContributions.risk}_`;

    if (last.txHash) {
      text += `\n\n[View on Explorer](https://mantlescan.xyz/tx/${last.txHash})`;
    }

    b.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  function sendAgents(b: TelegramBot, chatId: number) {
    const stats = getAgentStats();
    const history = getDecisionHistory();
    const last = history[history.length - 1];

    let text = `\u{1F9E0} *Sub-Agent Status*\n\n`;
    text += `*Market* \u{1F7E2} ${last?.market ? `${last.market.outlook}, ${last.market.confidence}% conf` : "warming up"}\n`;
    text += `*Yield* \u{1F7E2} ${last?.yields ? `${last.yields.bestYieldAsset} at ${last.yields.bestYieldApy.toFixed(2)}%` : "warming up"}\n`;
    text += `*Risk* \u{1F7E2} ${last?.risk ? `score ${last.risk.riskScore.toFixed(1)}/10, ${last.risk.exposureWarnings.length} warnings` : "warming up"}\n`;
    text += `*Portfolio* \u{1F7E2} ${stats.totalDecisions} decisions, ${(stats.cumulativeROIBps / 100).toFixed(2)}% ROI\n\n`;
    text += `_Cycle interval: ${config.intervalMs / 1000}s_`;

    b.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  function sendAutonomous(b: TelegramBot, chatId: number) {
    const status = getAutonomousStatus();

    let text = `\u26A1 *Autonomous Trading*\n\n`;
    text += `*Status:* ${status.enabled ? "\u{1F7E2} ON" : "\u{1F534} OFF"}\n`;
    text += `*Trades today:* ${status.tradesToday}/${status.maxDailyTrades}\n`;
    text += `*Max change/asset:* ${(status.maxPortfolioChangeBps / 100).toFixed(0)}%\n`;
    text += `*Min confidence:* ${status.minConfidence}%\n`;
    text += `*Max risk score:* ${status.maxRiskScore}/10\n`;

    b.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: status.enabled ? "\u{1F534} Disable" : "\u{1F7E2} Enable",
              callback_data: status.enabled ? "auto_disable" : "auto_enable",
            },
          ],
          [
            { text: "10%/asset", callback_data: "auto_maxchange_1000" },
            { text: "20%/asset", callback_data: "auto_maxchange_2000" },
            { text: "30%/asset", callback_data: "auto_maxchange_3000" },
          ],
          [
            { text: "2/day", callback_data: "auto_maxtrades_2" },
            { text: "3/day", callback_data: "auto_maxtrades_3" },
            { text: "5/day", callback_data: "auto_maxtrades_5" },
          ],
          [
            { text: "50% conf", callback_data: "auto_minconf_50" },
            { text: "70% conf", callback_data: "auto_minconf_70" },
            { text: "80% conf", callback_data: "auto_minconf_80" },
          ],
        ],
      },
    });
  }

  function sendByreal(b: TelegramBot, chatId: number) {
    try {
      const data = getCrossChainOpportunities();
      let text = `\u{1F517} *Cross-Chain Yields*\n\n`;
      text += `*Solana top:* ${data.solanaTopYield.toFixed(1)}% APY\n`;
      text += `${data.mantleComparison}\n\n`;
      data.opportunities.forEach((o) => {
        const emoji = o.risk === "low" ? "\u{1F7E2}" : o.risk === "medium" ? "\u{1F7E1}" : "\u{1F534}";
        text += `${emoji} ${o.pool}: ${o.apy.toFixed(1)}% [${o.risk}]\n`;
      });
      b.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch {
      b.sendMessage(chatId, "Cross-chain data unavailable right now.");
    }
  }

  function sendDca(b: TelegramBot, chatId: number) {
    const plans = getDcaPlans();

    if (plans.length === 0) {
      b.sendMessage(
        chatId,
        `\u{1F504} *DCA Plans*\n\nNo active DCA plans. Create one to start dollar-cost averaging into your favorite assets.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "\u2795 Create DCA Plan", callback_data: "dca_create" }],
            ],
          },
        }
      );
      return;
    }

    let text = `\u{1F504} *DCA Plans* (${plans.length})\n\n`;
    const buttons: TelegramBot.InlineKeyboardButton[][] = [];

    plans.forEach((plan) => {
      const status = plan.enabled ? "\u{1F7E2}" : "\u23F8\uFE0F";
      const next = plan.enabled ? new Date(plan.nextExecutionAt).toLocaleString() : "paused";
      text += `${status} *${plan.sourceAsset} \u2192 ${plan.targetAsset}*\n`;
      text += `   ${plan.amountBps / 100}% every ${formatInterval(plan.intervalMs)} | #${plan.totalExecutions} fills\n`;
      text += `   Next: ${next}\n\n`;

      buttons.push([
        {
          text: plan.enabled ? `\u23F8 Pause ${plan.sourceAsset}\u2192${plan.targetAsset}` : `\u25B6 Resume ${plan.sourceAsset}\u2192${plan.targetAsset}`,
          callback_data: plan.enabled ? `dca_pause_${plan.id}` : `dca_resume_${plan.id}`,
        },
        { text: `\u274C Cancel`, callback_data: `dca_cancel_${plan.id}` },
      ]);
    });

    buttons.push([{ text: "\u2795 Create DCA Plan", callback_data: "dca_create" }]);

    b.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  }

  function sendPlans(b: TelegramBot, chatId: number) {
    const tasks = getScheduledTasks();

    if (tasks.length === 0) {
      b.sendMessage(
        chatId,
        `\u{1F4C5} *Scheduled Tasks*\n\nNo scheduled tasks. Create one from a template or set up a custom plan.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "\u{1F4C6} Weekly Rebalance", callback_data: "plan_weekly" },
                { text: "\u{1F6E1} Safety Shift", callback_data: "plan_safety" },
              ],
              [
                { text: "\u{1F4B0} Yield Chase", callback_data: "plan_yield" },
              ],
            ],
          },
        }
      );
      return;
    }

    let text = `\u{1F4C5} *Scheduled Tasks* (${tasks.length})\n\n`;
    const buttons: TelegramBot.InlineKeyboardButton[][] = [];

    tasks.forEach((task) => {
      const status = task.enabled ? "\u{1F7E2}" : "\u23F8\uFE0F";
      text += `${status} *${task.name}* (${task.type.replace("_", " ")})\n`;
      text += `   Executions: ${task.totalExecutions}`;
      if (task.lastExecutedAt) {
        const ago = Math.floor((Date.now() - task.lastExecutedAt) / 60000);
        text += ` | Last: ${ago}m ago`;
      }
      if (task.condition) {
        text += `\n   Trigger: ${task.condition.asset} ${task.condition.operator} $${task.condition.priceUSD.toLocaleString()}`;
      }
      text += "\n\n";

      buttons.push([
        {
          text: task.enabled ? `\u23F8 Pause ${task.name}` : `\u25B6 Resume ${task.name}`,
          callback_data: task.enabled ? `plan_pause_${task.id}` : `plan_resume_${task.id}`,
        },
        { text: `\u274C Cancel`, callback_data: `plan_cancel_${task.id}` },
      ]);
    });

    buttons.push([
      { text: "\u{1F4C6} Weekly Rebalance", callback_data: "plan_weekly" },
      { text: "\u{1F6E1} Safety Shift", callback_data: "plan_safety" },
    ]);

    b.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  }

  async function handleApproval(b: TelegramBot, chatId: number, approved: boolean) {
    const pending = getPendingApproval();
    if (!pending) {
      b.sendMessage(chatId, `No pending trade to ${approved ? "approve" : "reject"} right now.`);
      return;
    }

    if (approved) {
      b.sendMessage(chatId, "Submitting to Mantle...");
      const success = await approveDecision();
      if (success) {
        const stats = getAgentStats();
        b.sendMessage(
          chatId,
          `*Trade executed.* \u2705\n\nDecision #${stats.totalDecisions} is now on-chain. Use /portfolio to see the updated allocation.`,
          { parse_mode: "Markdown" }
        );
      } else {
        b.sendMessage(chatId, "Trade failed. Check agent logs for details.");
      }
    } else {
      rejectDecision();
      b.sendMessage(chatId, "*Trade rejected.* I'll reassess in the next cycle.", { parse_mode: "Markdown" });
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

  let text = `*Portfolio updated* \u{1F4E2}\n\n`;
  text += `${decision.reasoning}\n\n`;
  text += `*Allocation:* ${allocText}\n`;
  text += `${decision.confidence}% confidence | ${decision.riskLevel} risk`;

  if (txHash) {
    text += `\n\n[View on Explorer](https://mantlescan.xyz/tx/${txHash})`;
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

  let text = `*Trade needs your approval* \u26A0\uFE0F\n\n`;
  text += `${decision.reasoning}\n\n`;
  text += `*Proposed:* ${allocText}\n`;
  text += `Confidence: ${decision.confidence}%`;

  // Send with inline buttons instead of telling user to type commands
  if (!botInstance) return;
  const linked = getAllLinkedWallets();
  const chatIds = new Set(Object.values(linked));
  chatIds.forEach((chatId) => {
    botInstance!.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "\u2705 Approve", callback_data: "approve_trade" },
            { text: "\u274C Reject", callback_data: "reject_trade" },
          ],
        ],
      },
    }).catch(() => {});
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
}
