import { PriceData } from "../dataFeeds";

export interface MarketOutlook {
  outlook: "bullish" | "neutral" | "bearish";
  confidence: number; // 0-100
  ethMomentum: number; // 0-100
  volatility: "low" | "moderate" | "high" | "extreme";
  signals: string[];
  timestamp: number;
}

export class MarketIntelligenceAgent {
  private history: { price: number; timestamp: number }[] = [];

  async analyze(prices: PriceData[]): Promise<MarketOutlook> {
    const ethPrice = prices.find((p) => p.asset === "mETH");
    const signals: string[] = [];

    // Track ETH price history for momentum
    if (ethPrice) {
      this.history.push({ price: ethPrice.priceUSD, timestamp: Date.now() });
      if (this.history.length > 50) this.history.shift();
    }

    // Calculate momentum (simple moving average comparison)
    let ethMomentum = 50;
    if (this.history.length >= 5) {
      const recent = this.history.slice(-5);
      const older = this.history.slice(-10, -5);
      if (older.length > 0) {
        const recentAvg = recent.reduce((s, h) => s + h.price, 0) / recent.length;
        const olderAvg = older.reduce((s, h) => s + h.price, 0) / older.length;
        const change = ((recentAvg - olderAvg) / olderAvg) * 100;
        ethMomentum = Math.max(0, Math.min(100, 50 + change * 10));
      }
    }

    // Simulate additional market signals
    const sentimentScore = 40 + Math.random() * 40; // 40-80
    const onChainActivity = 50 + Math.random() * 30; // 50-80

    if (ethMomentum > 65) signals.push("ETH momentum trending upward");
    if (ethMomentum < 35) signals.push("ETH momentum trending downward");
    if (sentimentScore > 65) signals.push("Market sentiment positive");
    if (sentimentScore < 40) signals.push("Market sentiment negative");
    if (onChainActivity > 70) signals.push("High on-chain activity on Mantle");

    // Determine volatility
    const priceChanges = prices.map((p) => Math.abs(p.change24h));
    const avgChange = priceChanges.reduce((s, c) => s + c, 0) / priceChanges.length;
    let volatility: MarketOutlook["volatility"] = "low";
    if (avgChange > 1) volatility = "moderate";
    if (avgChange > 3) volatility = "high";
    if (avgChange > 7) volatility = "extreme";

    if (volatility === "high" || volatility === "extreme") {
      signals.push(`Elevated volatility: avg ${avgChange.toFixed(1)}% daily moves`);
    }

    // Determine outlook
    const bullScore = ethMomentum * 0.4 + sentimentScore * 0.3 + onChainActivity * 0.3;
    let outlook: MarketOutlook["outlook"] = "neutral";
    let confidence = 50;

    if (bullScore > 65) {
      outlook = "bullish";
      confidence = Math.min(95, Math.round(bullScore));
      signals.push("Composite score indicates bullish conditions");
    } else if (bullScore < 40) {
      outlook = "bearish";
      confidence = Math.min(95, Math.round(100 - bullScore));
      signals.push("Composite score indicates bearish conditions");
    } else {
      confidence = Math.round(50 + Math.abs(bullScore - 50));
      signals.push("Mixed signals — maintaining neutral outlook");
    }

    return {
      outlook,
      confidence,
      ethMomentum: Math.round(ethMomentum),
      volatility,
      signals,
      timestamp: Date.now(),
    };
  }
}
