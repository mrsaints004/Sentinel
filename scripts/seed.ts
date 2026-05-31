import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const loggerAddr = process.env.LOGGER_ADDRESS;
  const identityAddr = process.env.IDENTITY_ADDRESS;

  if (!loggerAddr || !identityAddr) {
    console.error("Set LOGGER_ADDRESS and IDENTITY_ADDRESS in .env");
    process.exit(1);
  }

  const logger = await ethers.getContractAt("DecisionLogger", loggerAddr);
  const identity = await ethers.getContractAt("AgentIdentity", identityAddr);

  console.log("Seeding decision log with sample data...\n");

  const sampleDecisions = [
    {
      reasoning: "Initial equal-weight allocation. Low risk environment, all yields stable.",
      action: "rebalance",
      oldAlloc: [0, 0, 0],
      newAlloc: [3333, 3334, 3333],
      assets: ["USDY", "mETH", "USDC"],
      value: 100000,
      risk: "low",
    },
    {
      reasoning: "mETH staking APR spiked to 4.2% — increasing allocation from 33% to 40%. USDC lending rates dropped.",
      action: "rebalance",
      oldAlloc: [3333, 3334, 3333],
      newAlloc: [3000, 4000, 3000],
      assets: ["USDY", "mETH", "USDC"],
      value: 100200,
      risk: "low",
    },
    {
      reasoning: "USDY yield increased to 5.1% APY. Shifting allocation from USDC to USDY to capture higher Treasury yield.",
      action: "rebalance",
      oldAlloc: [3000, 4000, 3000],
      newAlloc: [4000, 3500, 2500],
      assets: ["USDY", "mETH", "USDC"],
      value: 100500,
      risk: "low",
    },
    {
      reasoning: "Portfolio within optimal range. Max delta 150 bps. Holding current positions.",
      action: "hold",
      oldAlloc: [4000, 3500, 2500],
      newAlloc: [4000, 3500, 2500],
      assets: ["USDY", "mETH", "USDC"],
      value: 100800,
      risk: "low",
    },
    {
      reasoning: "Medium risk detected. mETH showing 120 bps peg deviation. Reducing exposure and increasing stablecoin buffer.",
      action: "rebalance",
      oldAlloc: [4000, 3500, 2500],
      newAlloc: [3500, 2500, 4000],
      assets: ["USDY", "mETH", "USDC"],
      value: 100600,
      risk: "medium",
    },
  ];

  for (let i = 0; i < sampleDecisions.length; i++) {
    const d = sampleDecisions[i];
    console.log(`Logging decision ${i + 1}/${sampleDecisions.length}: ${d.action}`);

    const tx = await logger.logDecision(
      d.reasoning,
      d.action,
      d.oldAlloc,
      d.newAlloc,
      d.assets,
      d.value,
      d.risk
    );
    await tx.wait();
    console.log(`  TX: ${tx.hash}`);
  }

  // Update agent identity metadata
  const tokenId = await identity.agentToToken(deployer.address);
  if (tokenId > BigInt(0)) {
    await identity.updateMetadata(tokenId, sampleDecisions.length, 245);
    console.log("\nAgent identity updated: 5 decisions, +2.45% ROI");
  }

  console.log("\nSeed complete!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
