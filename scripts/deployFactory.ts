import { ethers } from "hardhat";

/**
 * Deploy VaultFactory for multi-user Sentinel
 *
 * The factory deploys SentinelVault + DecisionLogger pairs per user.
 * It sets the platform agent on both and transfers ownership to the user.
 */

// Real Mantle Mainnet token addresses
const TOKENS = {
  USDY: "0x5bE26527e817998A7206475496fDE1E68957c5A6",
  mETH: "0xcDA86A272531e8640cD7F1a92c01839911B90bb0",
  USDC: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║    Sentinel — VaultFactory Deployment                    ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log("Deployer:", deployer.address);

  // The platform agent is the deployer's wallet (runs the agent server)
  const platformAgent = deployer.address;
  console.log("Platform Agent:", platformAgent);

  // Deploy VaultFactory
  console.log("\n[1/2] Deploying VaultFactory...");
  const VaultFactory = await ethers.getContractFactory("VaultFactory");
  const factory = await VaultFactory.deploy(platformAgent);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`  VaultFactory: ${factoryAddress}`);

  // Configure default assets
  console.log("\n[2/2] Setting default assets...");
  const tx = await factory.setDefaultAssets(
    [TOKENS.USDY, TOKENS.mETH, TOKENS.USDC],
    ["USDY", "mETH", "USDC"]
  );
  await tx.wait();
  console.log("  Default assets set: USDY, mETH, USDC");

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("Deployment complete!");
  console.log(`\nAdd to .env:`);
  console.log(`  FACTORY_ADDRESS=${factoryAddress}`);
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
