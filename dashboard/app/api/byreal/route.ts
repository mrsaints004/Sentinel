import { NextResponse } from "next/server";
import { execSync } from "child_process";

// Fetch real data from Byreal CLI
function fetchByrealPools(): any {
  try {
    const result = execSync(
      "npx @byreal-io/byreal-cli pools -o json --non-interactive",
      { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }
    );
    const jsonStart = result.indexOf("{");
    if (jsonStart >= 0) return JSON.parse(result.slice(jsonStart));
  } catch (e: any) {
    const stdout = e.stdout || "";
    const jsonStart = stdout.indexOf("{");
    if (jsonStart >= 0) {
      try { return JSON.parse(stdout.slice(jsonStart)); } catch {}
    }
  }
  return null;
}

export async function GET() {
  const result = fetchByrealPools();

  if (result?.success && result.data?.pools) {
    const pools = result.data.pools.slice(0, 10);
    const topYield = Math.max(...pools.map((p: any) => (p.total_apr || 0) * 100));

    const stablePools = pools.filter(
      (p: any) => p.token_a?.symbol === "USDC" || p.token_b?.symbol === "USDC" ||
                   p.token_a?.symbol === "USDT" || p.token_b?.symbol === "USDT"
    );
    const stableApy = stablePools.length > 0
      ? Math.max(...stablePools.map((p: any) => (p.total_apr || 0) * 100))
      : 0;

    const mantleAvg = 4.85; // USDY baseline
    const yieldGap = stableApy - mantleAvg;
    const signal = yieldGap > 1 ? "solana_outperforming" : "mantle_competitive";

    // Compute the allocation adjustment the agent would make
    let stableAdjustmentBps = 0;
    if (yieldGap > 3) {
      stableAdjustmentBps = Math.min(500, Math.round(yieldGap * 80));
    } else if (yieldGap > 1) {
      stableAdjustmentBps = Math.round(yieldGap * 50);
    }

    const comparison = signal === "solana_outperforming"
      ? `Solana CLMM stable yields (${stableApy.toFixed(1)}%) exceed Mantle RWA (${mantleAvg}%) by ${yieldGap.toFixed(1)}pp. Agent shifting +${(stableAdjustmentBps/100).toFixed(1)}% to stablecoins.`
      : `Mantle RWA yields (${mantleAvg}%) competitive with Solana stables (${stableApy.toFixed(1)}%). No cross-chain adjustment needed.`;

    return NextResponse.json({
      solanaTopYield: topYield,
      mantleComparison: comparison,
      opportunities: pools.slice(0, 5).map((p: any) => ({
        pool: p.pair,
        apy: +((p.total_apr || 0) * 100).toFixed(1),
        risk: (p.total_apr || 0) * 100 > 50 ? "high" : (p.total_apr || 0) * 100 > 15 ? "medium" : "low",
        tvl: Math.round(p.tvl_usd || 0),
      })),
      // Cross-chain yield signal (used by agent for allocation decisions)
      yieldSignal: {
        signal,
        yieldGapPct: +yieldGap.toFixed(2),
        stableAdjustmentBps,
        solanaStableApy: +stableApy.toFixed(2),
        mantleRwaApy: mantleAvg,
        agentAction: stableAdjustmentBps > 0
          ? `Reducing mETH by ${(stableAdjustmentBps/100).toFixed(1)}%, increasing USDY/USDC proportionally`
          : "No adjustment — Mantle yields optimal",
      },
      source: "byreal-cli-live",
      lastUpdated: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    solanaTopYield: 0,
    mantleComparison: "Byreal CLI data unavailable",
    opportunities: [],
    yieldSignal: {
      signal: "no_data",
      yieldGapPct: 0,
      stableAdjustmentBps: 0,
      solanaStableApy: 0,
      mantleRwaApy: 4.85,
      agentAction: "No cross-chain data available",
    },
    source: "offline",
    lastUpdated: new Date().toISOString(),
  });
}
