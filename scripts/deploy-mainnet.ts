import { ethers } from "hardhat";

/**
 * Mainnet Deployment Script for Mantle Treasury AI
 *
 * Deploys: SentinelVault, DecisionLogger, AgentIdentity, AgentConsensus
 * Uses REAL tokens: USDY, mETH, USDC on Mantle Mainnet
 * Integrates with Agni Finance (Uniswap V3) for real DEX swaps
 */

// Real Mantle Mainnet token addresses
const TOKENS = {
  USDY: "0x5bE26527e817998A7206475496fDE1E68957c5A6",  // Ondo USDY
  mETH: "0xcDA86A272531e8640cD7F1a92c01839911B90bb0",  // Mantle Staked ETH
  USDC: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",  // Bridged USDC
  WETH: "0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111",  // Wrapped ETH
};

// Agni Finance V3 (for real swaps)
const AGNI_ROUTER = "0x319B69888b0d11cEC22caA5034e25FfFBDc88421";
const AGNI_QUOTER = "0x9488C05a7b75a6FefdcAE4f11a33467bcBA60177";

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
    console.error("\n  WARNING: Low MNT balance. Need at least 0.5 MNT for deployment.");
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

  // 2. Deploy DecisionLogger (with commit-reveal)
  console.log("\n--- Deploying DecisionLogger (commit-reveal enabled) ---");
  const Logger = await ethers.getContractFactory("DecisionLogger");
  const logger = await Logger.deploy(deployer.address);
  await logger.waitForDeployment();
  const loggerAddr = await logger.getAddress();
  console.log(`DecisionLogger: ${loggerAddr}`);
  console.log(`  ${EXPLORER}/address/${loggerAddr}`);

  // 3. Deploy AgentIdentity (ERC-8004 Trustless Agent Standard)
  console.log("\n--- Deploying AgentIdentity (ERC-8004 compliant) ---");
  const Identity = await ethers.getContractFactory("AgentIdentity");
  const identity = await Identity.deploy();
  await identity.waitForDeployment();
  const identityAddr = await identity.getAddress();
  console.log(`AgentIdentity (ERC-8004): ${identityAddr}`);
  console.log(`  ${EXPLORER}/address/${identityAddr}`);

  // 4. Deploy AgentConsensus (multi-agent voting)
  console.log("\n--- Deploying AgentConsensus (multi-agent voting) ---");
  const ASSET_COUNT = 3; // USDY, mETH, USDC
  const Consensus = await ethers.getContractFactory("AgentConsensus");
  const consensus = await Consensus.deploy(ASSET_COUNT);
  await consensus.waitForDeployment();
  const consensusAddr = await consensus.getAddress();
  console.log(`AgentConsensus: ${consensusAddr}`);
  console.log(`  ${EXPLORER}/address/${consensusAddr}`);

  // 5. Deploy VaultFactory (multi-user vault creation)
  console.log("\n--- Deploying VaultFactory (multi-user support) ---");
  const Factory = await ethers.getContractFactory("VaultFactory");
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log(`VaultFactory: ${factoryAddr}`);
  console.log(`  ${EXPLORER}/address/${factoryAddr}`);

  // Configure factory with default assets
  await (await factory.setDefaultAssets(
    [TOKENS.USDY, TOKENS.mETH, TOKENS.USDC],
    ["USDY", "mETH", "USDC"]
  )).wait();
  console.log("Factory configured with default assets (USDY, mETH, USDC)");

  // 6. Configure Vault with real tokens
  console.log("\n--- Configuring Vault with real Mantle tokens ---");

  await (await vault.addSupportedAsset(TOKENS.USDY, "USDY")).wait();
  console.log("Added USDY (Ondo US Dollar Yield)");

  await (await vault.addSupportedAsset(TOKENS.mETH, "mETH")).wait();
  console.log("Added mETH (Mantle Staked ETH)");

  await (await vault.addSupportedAsset(TOKENS.USDC, "USDC")).wait();
  console.log("Added USDC (Bridged USDC)");

  // 6. Deploy AgniAdapter and set as swap router
  console.log("\n--- Deploying Agni Finance Adapter ---");
  const Adapter = await ethers.getContractFactory("AgniAdapter");
  const adapter = await Adapter.deploy(AGNI_ROUTER, AGNI_QUOTER);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log(`AgniAdapter: ${adapterAddr}`);
  console.log(`  Wraps Agni V3 Router: ${AGNI_ROUTER}`);

  // Configure fee tiers for token pairs (matching real Agni pools with liquidity)
  await (await adapter.setFeeTier(TOKENS.USDY, TOKENS.USDC, 100)).wait();   // 0.01%
  await (await adapter.setFeeTier(TOKENS.mETH, TOKENS.USDC, 10000)).wait(); // 1%
  await (await adapter.setFeeTier(TOKENS.mETH, TOKENS.USDY, 2500)).wait();  // 0.25%
  console.log("Fee tiers configured for token pairs");

  // Set adapter as vault's swap router
  await (await vault.setSwapRouter(adapterAddr)).wait();
  console.log("Vault swap router set to AgniAdapter");

  // 7. Configure DecisionLogger + AgentIdentity
  console.log("\n--- Configuring contracts ---");
  await (await logger.setAgentIdentityContract(identityAddr)).wait();
  console.log("Logger linked to AgentIdentity");

  await (await identity.setUpdater(deployer.address)).wait();
  console.log("Identity updater set");

  // 8. Register sub-agent wallets in AgentConsensus
  console.log("\n--- Registering sub-agents for consensus voting ---");
  // Derive sub-agent addresses using the PRIVATE KEY (must match executor.ts logic)
  const privateKey = process.env.PRIVATE_KEY || "";
  const roles = ["market", "yield", "risk", "portfolio"];
  const roleEnums = [0, 1, 2, 3]; // Market, Yield, Risk, Portfolio
  for (let i = 0; i < roles.length; i++) {
    const derivedKey = ethers.keccak256(
      ethers.solidityPacked(["bytes32", "string"], [privateKey, roles[i]])
    );
    const subWallet = new ethers.Wallet(derivedKey);
    await (await consensus.registerAgent(subWallet.address, roleEnums[i])).wait();
    console.log(`  Registered ${roles[i]} agent: ${subWallet.address}`);
  }
  // Also register the deployer as a registered agent (for startRound)
  await (await consensus.registerAgent(deployer.address, 3)).wait();
  console.log(`  Registered deployer as Portfolio agent: ${deployer.address}`);

  // 9. Mint Agent Identity NFT
  console.log("\n--- Minting Agent Identity NFT ---");
  const tx = await identity.registerAgent(
    deployer.address,
    "Sentinel Alpha",
    "Yield-Optimized RWA",
    vaultAddr,
    loggerAddr
  );
  await tx.wait();
  console.log("Agent identity NFT minted (Agent Identity)");

  // Summary
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║    DEPLOYMENT COMPLETE — Mantle Mainnet (chainId 5000)   ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log("Contracts:");
  console.log(`  VAULT_ADDRESS=${vaultAddr}`);
  console.log(`  LOGGER_ADDRESS=${loggerAddr}`);
  console.log(`  IDENTITY_ADDRESS=${identityAddr}`);
  console.log(`  CONSENSUS_ADDRESS=${consensusAddr}`);
  console.log(`  FACTORY_ADDRESS=${factoryAddr}`);
  console.log(`  SWAP_ROUTER_ADDRESS=${adapterAddr}`);
  console.log(`  AGNI_ADAPTER=${adapterAddr}`);
  console.log("\nReal Tokens (Mantle Mainnet):");
  console.log(`  USDY_ADDRESS=${TOKENS.USDY}`);
  console.log(`  METH_ADDRESS=${TOKENS.mETH}`);
  console.log(`  USDC_ADDRESS=${TOKENS.USDC}`);
  console.log("\nExplorer Links:");
  console.log(`  Vault:     ${EXPLORER}/address/${vaultAddr}`);
  console.log(`  Logger:    ${EXPLORER}/address/${loggerAddr}`);
  console.log(`  Identity:  ${EXPLORER}/address/${identityAddr} (ERC-8004)`);
  console.log(`  Consensus: ${EXPLORER}/address/${consensusAddr}`);
  console.log(`  Factory:   ${EXPLORER}/address/${factoryAddr}`);
  console.log(`  Adapter:   ${EXPLORER}/address/${adapterAddr}`);
  console.log(`  Agent:     ${EXPLORER}/address/${deployer.address}`);
  console.log("\n  Update your .env file with the addresses above.");
  console.log("  To deposit, you need real USDY/mETH/USDC on Mantle.");
  console.log("    Bridge from Ethereum via https://bridge.mantle.xyz");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
