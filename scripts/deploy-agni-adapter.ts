import { ethers } from "hardhat";

// Agni Finance V3 contracts on Mantle Mainnet
const AGNI_ROUTER = "0x319B69888b0d11cEC22caA5034e25FfFBDc88421";
const AGNI_QUOTER = "0x9488C05a7b75a6FefdcAE4f11a33467bcBA60177";

// Token addresses on Mantle Mainnet
const USDY = "0x5bE26527e817998A7206475496fDE1E68957c5A6";
const METH = "0xcDA86A272531e8640cD7F1a92c01839911B90bb0";
const USDC = "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying AgniAdapter with account:", deployer.address);

  const AgniAdapter = await ethers.getContractFactory("AgniAdapter");
  const adapter = await AgniAdapter.deploy(AGNI_ROUTER, AGNI_QUOTER);
  await adapter.waitForDeployment();

  const adapterAddr = await adapter.getAddress();
  console.log("AgniAdapter deployed to:", adapterAddr);

  // Configure fee tiers for all pairs
  console.log("Setting fee tiers...");

  const tx1 = await adapter.setFeeTier(USDY, USDC, 100); // 0.01% — stablecoin pair
  await tx1.wait();
  console.log("  USDY/USDC fee tier: 100 (0.01%)");

  const tx2 = await adapter.setFeeTier(METH, USDC, 10000); // 1% — only fee tier with liquidity for mETH/USDC
  await tx2.wait();
  console.log("  mETH/USDC fee tier: 10000 (1%)");

  const tx3 = await adapter.setFeeTier(METH, USDY, 2500); // 0.25% — less common pair
  await tx3.wait();
  console.log("  mETH/USDY fee tier: 2500 (0.25%)");

  console.log("\nDone! Add to your .env:");
  console.log(`SWAP_ROUTER_ADDRESS=${adapterAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
