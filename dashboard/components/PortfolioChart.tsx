"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface Asset {
  symbol: string;
  name: string;
  allocationBps: number;
  balanceUSD: number;
  apy: number;
}

const COLORS = ["#4f46e5", "#0d9488", "#d97706"];

export default function PortfolioChart({
  assets,
  totalValueUSD,
  blendedYield,
}: {
  assets: Asset[];
  totalValueUSD: number;
  blendedYield: number;
}) {
  const data = assets.map((a) => ({
    name: a.symbol,
    value: a.allocationBps / 100,
    balance: a.balanceUSD,
  }));

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-semibold text-s-text">Portfolio Allocation</h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-s-text-muted">Blended APY</span>
          <span className="font-bold text-s-teal">{blendedYield.toFixed(2)}%</span>
        </div>
      </div>

      <div className="flex items-center gap-8">
        <div className="relative w-48 h-48 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
                strokeWidth={0}
              >
                {data.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "12px",
                  fontSize: "12px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, "Allocation"]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xl font-bold text-s-text">${(totalValueUSD / 1000).toFixed(1)}k</span>
            <span className="text-[10px] text-s-text-muted">Total Value</span>
          </div>
        </div>

        <div className="flex-1 space-y-4">
          {assets.map((asset, i) => (
            <div key={asset.symbol}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: COLORS[i] }}
                  >
                    {asset.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-s-text">{asset.symbol}</div>
                    <div className="text-[11px] text-s-text-muted">{asset.name}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-s-text">
                    {(asset.allocationBps / 100).toFixed(1)}%
                  </div>
                  <div className="text-[11px] text-s-text-muted">
                    ${asset.balanceUSD.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${asset.allocationBps / 100}%`, backgroundColor: COLORS[i] }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
