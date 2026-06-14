import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getWalletFromQuery } from "../../../lib/auth";
import { getLoggerContract, getUserVaultAddress, getProvider } from "../../../lib/provider";

const LOGGER_ABI = [
  "function getRecentDecisions(uint256 count) external view returns (tuple(uint256 id, address agent, string reasoning, string action, uint256[] oldAllocations, uint256[] newAllocations, string[] assetNames, uint256 timestamp, uint256 portfolioValueUSD, string riskLevel, bytes32 commitHash, bool verified)[])",
];

export async function GET(request: Request) {
  const wallet = getWalletFromQuery(request);

  let logger: ethers.Contract | null = null;

  if (wallet) {
    const info = await getUserVaultAddress(wallet);
    if (info) {
      logger = new ethers.Contract(info.logger, LOGGER_ABI, getProvider());
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
    return NextResponse.json(formatted);
  } catch (error) {
    console.error("[API/decisions] On-chain fetch failed:", error);
    return NextResponse.json([]);
  }
}
