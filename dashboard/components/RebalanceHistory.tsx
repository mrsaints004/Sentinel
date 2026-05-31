"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface DataPoint {
  timestamp: number;
  value: number;
}

export default function RebalanceHistory({ history }: { history: DataPoint[] }) {
  const data = history.map((h) => ({
    date: new Date(h.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value: h.value,
  }));

  const minValue = Math.min(...history.map((h) => h.value)) * 0.995;
  const maxValue = Math.max(...history.map((h) => h.value)) * 1.005;

  const startVal = history[0]?.value || 0;
  const endVal = history[history.length - 1]?.value || 0;
  const change = startVal > 0 ? ((endVal - startVal) / startVal) * 100 : 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-s-text">Portfolio Performance</h2>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${change >= 0 ? "text-s-green" : "text-s-red"}`}>
            {change >= 0 ? "+" : ""}{change.toFixed(2)}%
          </span>
          <span className="text-xs text-s-text-muted px-2 py-0.5 rounded bg-gray-100">7D</span>
        </div>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="date"
              stroke="transparent"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[minValue, maxValue]}
              stroke="transparent"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              tickLine={false}
              axisLine={false}
              width={50}
            />
            <Tooltip
              contentStyle={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                fontSize: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, "Value"]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#4f46e5"
              strokeWidth={2}
              fill="url(#colorValue)"
              dot={{ r: 3.5, fill: "#4f46e5", stroke: "#fff", strokeWidth: 2 }}
              activeDot={{ r: 5, fill: "#4f46e5", stroke: "#fff", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
