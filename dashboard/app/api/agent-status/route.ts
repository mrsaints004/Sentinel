import { NextResponse } from "next/server";
import { getWalletFromQuery } from "../../../lib/auth";
import { getIdentityContract, getUserVaultAddress } from "../../../lib/provider";
import { ethers } from "ethers";

export async function GET(request: Request) {
  const wallet = getWalletFromQuery(request);
  const identity = getIdentityContract();
  const agentAddress = process.env.AGENT_WALLET_ADDRESS || process.env.NEXT_PUBLIC_AGENT_ADDRESS || "";

  if (identity && agentAddress) {
    try {
      const tokenId = await identity.agentToToken(agentAddress);
      if (tokenId > BigInt(0)) {
        const metadata = await identity.getAgentMetadata(tokenId);
        const createdAt = Number(metadata.createdAt) * 1000;
        const uptimeSeconds = Math.floor((Date.now() - createdAt) / 1000);

        let reputation = null;
        try {
          const [winRate, avgConfidence, maxDrawdownBps, streakLength, accuracyScore, totalGames] =
            await identity.computeReputation(tokenId);
          reputation = {
            winRate: Number(winRate), avgConfidence: Number(avgConfidence),
            maxDrawdownBps: Number(maxDrawdownBps), streakLength: Number(streakLength),
            accuracyScore: Number(accuracyScore), totalGames: Number(totalGames),
          };
        } catch {}

        return NextResponse.json({
          agentName: metadata.agentName, strategyType: metadata.strategyType,
          totalDecisions: Number(metadata.totalDecisions),
          cumulativeROIBps: Number(metadata.cumulativeROIBps),
          isRunning: true, uptime: uptimeSeconds,
          walletAddress: agentAddress,
          lastActive: new Date(Number(metadata.lastActiveAt) * 1000).toISOString(),
          reputation, source: "on-chain-mainnet",
        });
      }
    } catch (error) {
      console.error("[API/agent-status] On-chain fetch failed:", error);
    }
  }

  return NextResponse.json({
    agentName: "Sentinel Alpha", strategyType: "Yield-Optimized RWA",
    totalDecisions: 0, cumulativeROIBps: 0, isRunning: false, uptime: 0,
    walletAddress: agentAddress || "", lastActive: new Date().toISOString(),
    source: "awaiting-deployment",
  });
}
