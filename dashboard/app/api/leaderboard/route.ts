import { NextResponse } from "next/server";
import { getIdentityContract } from "../../../lib/provider";

const AGENT_ADDRESS = process.env.AGENT_WALLET_ADDRESS || "0x76f61EA62C5A8F0b38D820F66DAF546f7Fa6015c";

export async function GET() {
  const identity = getIdentityContract();

  if (!identity) {
    return NextResponse.json([]);
  }

  const agents: any[] = [];

  try {
    const tokenId = await identity.agentToToken(AGENT_ADDRESS);
    if (tokenId === BigInt(0)) return NextResponse.json([]);

    const metadata = await identity.getAgentMetadata(tokenId);
    agents.push({
      id: Number(tokenId),
      name: metadata.agentName,
      strategy: metadata.strategyType,
      decisions: Number(metadata.totalDecisions),
      address: AGENT_ADDRESS,
      isYou: true,
      lastActive: Number(metadata.lastActiveAt),
    });
  } catch {}

  return NextResponse.json(agents);
}
