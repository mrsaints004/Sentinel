import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getWalletFromQuery } from "../../../lib/auth";
import { getLoggerContract, getUserVaultAddress, getProvider } from "../../../lib/provider";

const LOGGER_ABI = [
  "function getRecentDecisions(uint256 count) external view returns (tuple(uint256 id, address agent, string reasoning, string action, uint256[] oldAllocations, uint256[] newAllocations, string[] assetNames, uint256 timestamp, uint256 portfolioValueUSD, string riskLevel, bytes32 commitHash, bool verified)[])",
];

// Cache to avoid rate limiting on free RPC
let cachedResponse: { data: unknown; wallet: string | null; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

export async function GET(request: Request) {
  const wallet = getWalletFromQuery(request);

  // Return cached data if fresh and same wallet
  if (cachedResponse && Date.now() - cachedResponse.timestamp < CACHE_TTL_MS && cachedResponse.wallet === wallet) {
    return NextResponse.json(cachedResponse.data);
  }

  // Try user's factory vault first, fall back to main logger
  let logger: ethers.Contract | null = null;
  if (wallet) {
    try {
      const info = await getUserVaultAddress(wallet);
      if (info) {
        logger = new ethers.Contract(info.logger, LOGGER_ABI, getProvider());
      }
    } catch {
      // Factory lookup failed — fall back to main logger
    }
  }
  if (!logger) logger = getLoggerContract();
  if (!logger) return NextResponse.json([]);

  try {
    const decisions = await logger.getRecentDecisions(12);
    const formatted = decisions.map((d: ethers.Result) => ({
      id: Number(d.id),
      action: d.action,
      reasoning: d.reasoning,
      oldAllocations: d.oldAllocations.map((a: bigint) => Number(a)),
      newAllocations: d.newAllocations.map((a: bigint) => Number(a)),
      assetNames: d.assetNames,
      timestamp: Number(d.timestamp) * 1000,
      portfolioValueUSD: Number(d.portfolioValueUSD),
      riskLevel: d.riskLevel,
      commitHash: d.commitHash,
      verified: d.verified,
    }));
    formatted.sort((a: { id: number }, b: { id: number }) => b.id - a.id);
    cachedResponse = { data: formatted, wallet, timestamp: Date.now() };
    return NextResponse.json(formatted);
  } catch (error) {
    console.error("[API/decisions] On-chain fetch failed:", error);
    return NextResponse.json([]);
  }
}
