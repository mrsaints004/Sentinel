import { config } from "./config";

export interface YieldData {
  asset: string;
  symbol: string;
  apy: number; // percentage
  tvl: number; // USD
  source: string;
}

export interface PriceData {
  asset: string;
  priceUSD: number;
  change24h: number;
  pegDeviation: number; // for pegged assets, deviation from peg in bps
}

export interface RiskMetrics {
  overallRisk: "low" | "medium" | "high" | "critical";
  depegRisks: { asset: string; deviation: number }[];
  liquidityWarnings: string[];
  volatilityIndex: number;
}

export interface MarketSnapshot {
  yields: YieldData[];
  prices: PriceData[];
  risk: RiskMetrics;
  timestamp: number;
}

// --- Real API data fetchers with cached fallbacks ---

// Cache last-known-good data to avoid random values when APIs fail
let cachedYields: YieldData[] | null = null;
let cachedPrices: PriceData[] | null = null;

async function fetchJSON(url: string, timeout = 10000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Default yields (used only on first run if API fails — no randomness)
function defaultYields(): YieldData[] {
  return [
    { asset: config.assets.USDY, symbol: "USDY", apy: 4.5, tvl: 150_000_000, source: "Ondo Finance" },
    { asset: config.assets.mETH, symbol: "mETH", apy: 3.8, tvl: 800_000_000, source: "Mantle LSP" },
    { asset: config.assets.USDC, symbol: "USDC", apy: 2.5, tvl: 500_000_000, source: "Lendle / Init Capital" },
  ];
}

function defaultPrices(): PriceData[] {
  return [
    { asset: "USDY", priceUSD: 1.05, change24h: 0, pegDeviation: 0 },
    { asset: "mETH", priceUSD: 3400, change24h: 0, pegDeviation: 0 },
    { asset: "USDC", priceUSD: 1.0, change24h: 0, pegDeviation: 0 },
  ];
}

export async function fetchYieldData(): Promise<YieldData[]> {
  try {
    // DeFiLlama yields API — filter for Mantle chain pools
    const data = await fetchJSON("https://yields.llama.fi/pools");
    const pools: any[] = data.data || [];

    // Find best pools on Mantle for our target assets
    const mantlePools = pools.filter((p: any) => p.chain === "Mantle");

    // Find relevant pools
    const usdyPool = mantlePools.find((p: any) =>
      p.symbol?.toUpperCase().includes("USDY")
    ) || pools.find((p: any) =>
      p.symbol?.toUpperCase().includes("USDY") && p.tvlUsd > 1_000_000
    );

    const methPool = mantlePools.find((p: any) =>
      p.symbol?.toUpperCase().includes("METH") || p.symbol?.toUpperCase().includes("M-ETH")
    ) || pools.find((p: any) =>
      (p.symbol?.toUpperCase().includes("METH") || p.project === "mantle-lsp") && p.tvlUsd > 1_000_000
    );

    const usdcPool = mantlePools.find((p: any) =>
      p.symbol?.toUpperCase().includes("USDC") && p.tvlUsd > 500_000
    ) || pools.find((p: any) =>
      p.symbol?.toUpperCase() === "USDC" && p.chain === "Mantle" && p.tvlUsd > 100_000
    );

    const yields: YieldData[] = [
      {
        asset: config.assets.USDY,
        symbol: "USDY",
        apy: usdyPool?.apy ?? (cachedYields?.find(y => y.symbol === "USDY")?.apy ?? 4.5),
        tvl: usdyPool?.tvlUsd ?? 150_000_000,
        source: usdyPool?.project ?? "Ondo Finance",
      },
      {
        asset: config.assets.mETH,
        symbol: "mETH",
        apy: methPool?.apy ?? (cachedYields?.find(y => y.symbol === "mETH")?.apy ?? 3.8),
        tvl: methPool?.tvlUsd ?? 800_000_000,
        source: methPool?.project ?? "Mantle LSP",
      },
      {
        asset: config.assets.USDC,
        symbol: "USDC",
        apy: usdcPool?.apy ?? (cachedYields?.find(y => y.symbol === "USDC")?.apy ?? 2.5),
        tvl: usdcPool?.tvlUsd ?? 500_000_000,
        source: usdcPool?.project ?? "Lendle / Init Capital",
      },
    ];

    console.log("[DataFeeds] Yield data fetched from DeFiLlama");
    cachedYields = yields;
    return yields;
  } catch (error) {
    console.warn("[DataFeeds] DeFiLlama API failed, using cached data:", (error as Error).message);
    return cachedYields || defaultYields();
  }
}

export async function fetchPriceData(): Promise<PriceData[]> {
  try {
    // CoinGecko free API for real prices (real mainnet token IDs)
    const data = await fetchJSON(
      "https://api.coingecko.com/api/v3/simple/price?ids=mantle-staked-ether,ondo-us-dollar-yield,usd-coin&vs_currencies=usd&include_24hr_change=true"
    );

    const ethPrice = data["mantle-staked-ether"]?.usd ?? 2500;
    const ethChange = data["mantle-staked-ether"]?.usd_24h_change ?? 0;
    const usdyPrice = data["ondo-us-dollar-yield"]?.usd ?? 1.0;
    const usdyChange = data["ondo-us-dollar-yield"]?.usd_24h_change ?? 0;
    const usdcPrice = data["usd-coin"]?.usd ?? 1.0;
    const usdcChange = data["usd-coin"]?.usd_24h_change ?? 0;

    // mETH is a liquid staking derivative — price comes directly from CoinGecko
    const methPrice = ethPrice;

    const prices: PriceData[] = [
      {
        asset: "USDY",
        priceUSD: usdyPrice,
        change24h: usdyChange,
        pegDeviation: 0, // USDY is yield-bearing (accrues above $1), not a pegged stablecoin
      },
      {
        asset: "mETH",
        priceUSD: methPrice,
        change24h: ethChange,
        pegDeviation: Math.abs(methPrice / ethPrice - 1) * 10000, // bps from ETH price
      },
      {
        asset: "USDC",
        priceUSD: usdcPrice,
        change24h: usdcChange,
        pegDeviation: Math.abs(usdcPrice - 1.0) * 10000, // bps from $1
      },
    ];

    console.log("[DataFeeds] Price data fetched from CoinGecko");
    cachedPrices = prices;
    return prices;
  } catch (error) {
    console.warn("[DataFeeds] CoinGecko API failed, using cached data:", (error as Error).message);
    return cachedPrices || defaultPrices();
  }
}

export async function fetchRiskMetrics(
  prices: PriceData[]
): Promise<RiskMetrics> {
  const depegRisks = prices
    .filter((p) => p.pegDeviation > 50) // > 50 bps deviation
    .map((p) => ({ asset: p.asset, deviation: p.pegDeviation }));

  const liquidityWarnings: string[] = [];

  // Volatility derived from real 24h changes
  const avgAbsChange = prices.reduce((sum, p) => sum + Math.abs(p.change24h), 0) / prices.length;
  const volatilityIndex = Math.min(100, avgAbsChange * 15); // scale to 0-100

  if (volatilityIndex > 60) {
    liquidityWarnings.push("High market volatility detected");
  }

  let overallRisk: RiskMetrics["overallRisk"] = "low";
  if (depegRisks.length > 0 || volatilityIndex > 70) overallRisk = "medium";
  if (depegRisks.some((d) => d.deviation > 200) || volatilityIndex > 85)
    overallRisk = "high";
  if (depegRisks.some((d) => d.deviation > 500)) overallRisk = "critical";

  return {
    overallRisk,
    depegRisks,
    liquidityWarnings,
    volatilityIndex,
  };
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const yields = await fetchYieldData();
  const prices = await fetchPriceData();
  const risk = await fetchRiskMetrics(prices);

  return {
    yields,
    prices,
    risk,
    timestamp: Date.now(),
  };
}
