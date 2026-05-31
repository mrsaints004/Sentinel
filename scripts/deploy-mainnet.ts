import { ethers } from "hardhat";

/**
 * Mainnet Deployment Script for Mantle Treasury AI
 *
 * Deploys: SentinelVault, DecisionLogger, AgentIdentity
 * Uses REAL tokens: USDY, mETH, USDC on Mantle Mainnet
 * Integrates with Merchant Moe LB Router for real DEX swaps
 */

// Real Mantle Mainnet token addresses
const TOKENS = {
  USDY: "0x5bE26527e817998A7206475496fDE1E68957c5A6",  // Ondo USDY
  mETH: "0xcDA86A272531e8640cD7F1a92c01839911B90bB0",  // Mantle Staked ETH
  USDC: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",  // Bridged USDC
  WETH: "0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111",  // Wrapped ETH
};

// Merchant Moe DEX (for real swaps)
const MERCHANT_MOE_LB_ROUTER = "0x013e138EF6008ae5FDFDE29700e3f2Bc61d21E3a";
const MERCHANT_MOE_LB_FACTORY = "0xa6630671775c4EA2743840F9A5016dCf2A104054";

const EXPLORER = "https://mantlescan.xyz";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║    Sentinel AI — Mantle MAINNET Deployment               ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "MNT");

  if (balance < ethers.parseEther("0.5")) {
    console.error("\n⚠️  WARNING: Low MNT balance. Need at least 0.5 MNT for deployment.");
    console.error("Get MNT from an exchange and send to:", deployer.address);
    process.exit(1);
  }

  // 1. Deploy SentinelVault
  console.log("\n--- Deploying SentinelVault ---");
  const Vault = await ethers.getContractFactory("SentinelVault");
  const vault = await Vault.deploy(deployer.address);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`SentinelVault: ${vaultAddr}`);
  console.log(`  ${EXPLORER}/address/${vaultAddr}`);

  // 2. Deploy DecisionLogger
  console.log("\n--- Deploying DecisionLogger ---");
  const Logger = await ethers.getContractFactory("DecisionLogger");
  const logger = await Logger.deploy(deployer.address);
  await logger.waitForDeployment();
  const loggerAddr = await logger.getAddress();
  console.log(`DecisionLogger: ${loggerAddr}`);
  console.log(`  ${EXPLORER}/address/${loggerAddr}`);

  // 3. Deploy AgentIdentity
  console.log("\n--- Deploying AgentIdentity ---");
  const Identity = await ethers.getContractFactory("AgentIdentity");
  const identity = await Identity.deploy();
  await identity.waitForDeployment();
  const identityAddr = await identity.getAddress();
  console.log(`AgentIdentity: ${identityAddr}`);
  console.log(`  ${EXPLORER}/address/${identityAddr}`);

  // 4. Configure Vault with real tokens
  console.log("\n--- Configuring Vault with real Mantle tokens ---");

  await (await vault.addSupportedAsset(TOKENS.USDY, "USDY")).wait();
  console.log("Added USDY (Ondo US Dollar Yield)");

  await (await vault.addSupportedAsset(TOKENS.mETH, "mETH")).wait();
  console.log("Added mETH (Mantle Staked ETH)");

  await (await vault.addSupportedAsset(TOKENS.USDC, "USDC")).wait();
  console.log("Added USDC (Bridged USDC)");

  // 5. Deploy MerchantMoeAdapter and set as swap router
  console.log("\n--- Deploying Merchant Moe Adapter ---");
  const Adapter = await ethers.getContractFactory("MerchantMoeAdapter");
  const adapter = await Adapter.deploy(MERCHANT_MOE_LB_ROUTER, MERCHANT_MOE_LB_FACTORY);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log(`MerchantMoeAdapter: ${adapterAddr}`);
  console.log(`  Wraps LB Router: ${MERCHANT_MOE_LB_ROUTER}`);

  // Configure bin steps for common pairs (typical bin step for stablecoin pairs: 1-5, volatile: 15-25)
  await (await adapter.setBinStep(TOKENS.USDY, TOKENS.USDC, 1)).wait();  // Stable-stable pair
  await (await adapter.setBinStep(TOKENS.mETH, TOKENS.USDC, 20)).wait(); // Volatile pair
  await (await adapter.setBinStep(TOKENS.mETH, TOKENS.USDY, 20)).wait(); // Volatile pair
  console.log("Bin steps configured for token pairs");

  // Set adapter as vault's swap router
  await (await vault.setSwapRouter(adapterAddr)).wait();
  console.log("Vault swap router set to MerchantMoeAdapter");

  // 6. Configure DecisionLogger + AgentIdentity
  console.log("\n--- Configuring contracts ---");
  await (await logger.setAgentIdentityContract(identityAddr)).wait();
  console.log("Logger linked to AgentIdentity");

  await (await identity.setUpdater(deployer.address)).wait();
  console.log("Identity updater set");

  // 7. Register agent identity NFT (ERC-8004)
  console.log("\n--- Minting Agent Identity NFT ---");
  const tx = await identity.registerAgent(
    deployer.address,
    "Sentinel Alpha",
    "Yield-Optimized RWA",
    vaultAddr,
    loggerAddr
  );
  await tx.wait();
  console.log("Agent identity NFT minted (ERC-8004)");

  // Summary
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║    DEPLOYMENT COMPLETE — Mantle Mainnet (chainId 5000)   ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log("Contracts:");
  console.log(`  VAULT_ADDRESS=${vaultAddr}`);
  console.log(`  LOGGER_ADDRESS=${loggerAddr}`);
  console.log(`  IDENTITY_ADDRESS=${identityAddr}`);
  console.log(`  SWAP_ROUTER_ADDRESS=${adapterAddr}`);
  console.log(`  MERCHANT_MOE_ADAPTER=${adapterAddr}`);
  console.log("\nReal Tokens (Mantle Mainnet):");
  console.log(`  USDY_ADDRESS=${TOKENS.USDY}`);
  console.log(`  METH_ADDRESS=${TOKENS.mETH}`);
  console.log(`  USDC_ADDRESS=${TOKENS.USDC}`);
  console.log("\nExplorer Links:");
  console.log(`  Vault:    ${EXPLORER}/address/${vaultAddr}`);
  console.log(`  Logger:   ${EXPLORER}/address/${loggerAddr}`);
  console.log(`  Identity: ${EXPLORER}/address/${identityAddr}`);
  console.log(`  Adapter:  ${EXPLORER}/address/${adapterAddr}`);
  console.log(`  Agent:    ${EXPLORER}/address/${deployer.address}`);
  console.log("\n⚠️  Update your .env file with the addresses above.");
  console.log("⚠️  To deposit, you need real USDY/mETH/USDC on Mantle.");
  console.log("    Bridge from Ethereum via https://bridge.mantle.xyz");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
