"use client";

interface Asset {
  symbol: string;
  name: string;
  allocationBps: number;
  balanceUSD: number;
  apy: number;
}

const BAR_COLORS: Record<string, string> = {
  USDY: "#4f46e5",
  mETH: "#0d9488",
  USDC: "#d97706",
};

export default function YieldComparison({
  assets,
  blendedYield,
}: {
  assets: Asset[];
  blendedYield: number;
}) {
  const sorted = [...assets].sort((a, b) => b.apy - a.apy);
  const maxApy = Math.max(...assets.map((a) => a.apy));

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-s-text mb-5">Live Yield Rates</h2>
      <div className="space-y-4">
        {sorted.map((asset) => (
          <div key={asset.symbol}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: BAR_COLORS[asset.symbol] }}
                />
                <span className="text-xs font-medium text-s-text">{asset.symbol}</span>
              </div>
              <span
                className="text-sm font-bold font-mono"
                style={{ color: BAR_COLORS[asset.symbol] }}
              >
                {asset.apy.toFixed(2)}%
              </span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${(asset.apy / (maxApy * 1.3)) * 100}%`,
                  backgroundColor: BAR_COLORS[asset.symbol],
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-s-border">
        <div className="flex items-center justify-between">
          <span className="text-xs text-s-text-muted">Blended Yield</span>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold text-s-text">{blendedYield.toFixed(2)}%</span>
            <span className="text-xs text-s-text-muted">APY</span>
          </div>
        </div>
      </div>
    </div>
  );
}
