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
    const pools = result.data.pools.slice(0, 5);
    const topYield = Math.max(...pools.map((p: any) => (p.total_apr || 0) * 100));

    const stablePools = pools.filter(
      (p: any) => p.token_a?.symbol === "USDC" || p.token_b?.symbol === "USDC"
    );
    const stableApy = stablePools.length > 0
      ? Math.max(...stablePools.map((p: any) => (p.total_apr || 0) * 100))
      : 0;

    const mantleAvg = 4.5;
    const comparison = stableApy > mantleAvg
      ? `Solana CLMM stable pools yielding ${stableApy.toFixed(1)}% — cross-chain opportunity`
      : `Mantle RWA yields competitive with Solana CLMM stables`;

    return NextResponse.json({
      solanaTopYield: topYield,
      mantleComparison: comparison,
      opportunities: pools.map((p: any) => ({
        pool: p.pair,
        apy: +((p.total_apr || 0) * 100).toFixed(1),
        risk: (p.total_apr || 0) * 100 > 50 ? "high" : (p.total_apr || 0) * 100 > 15 ? "medium" : "low",
        tvl: Math.round(p.tvl_usd || 0),
      })),
      source: "byreal-cli-live",
      lastUpdated: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    solanaTopYield: 0,
    mantleComparison: "Byreal CLI data unavailable",
    opportunities: [],
    source: "offline",
    lastUpdated: new Date().toISOString(),
  });
}
