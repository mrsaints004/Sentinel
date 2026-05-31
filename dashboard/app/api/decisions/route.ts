import { NextResponse } from "next/server";
import { getLoggerContract } from "../../../lib/provider";

export async function GET() {
  const logger = getLoggerContract();

  if (!logger) {
    return NextResponse.json([]);
  }

  try {
    const decisions = await logger.getRecentDecisions(12);

    const formatted = decisions.map((d: any) => ({
      id: Number(d.id),
      action: d.action,
      reasoning: d.reasoning,
      oldAllocations: d.oldAllocations.map((a: bigint) => Number(a)),
      newAllocations: d.newAllocations.map((a: bigint) => Number(a)),
      assetNames: d.assetNames,
      timestamp: Number(d.timestamp) * 1000,
      portfolioValueUSD: Number(d.portfolioValueUSD),
      riskLevel: d.riskLevel,
    }));

    // Sort by ID descending (most recent first)
    formatted.sort((a: any, b: any) => b.id - a.id);

    return NextResponse.json(formatted);
  } catch (error) {
    console.error("[API/decisions] On-chain fetch failed:", error);
    return NextResponse.json([]);
  }
}
