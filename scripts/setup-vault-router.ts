import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Setting up vault router with account:", deployer.address);

  const vaultAddress = process.env.VAULT_ADDRESS;
  const routerAddress = process.env.SWAP_ROUTER_ADDRESS;
  const factoryAddress = process.env.FACTORY_ADDRESS;

  if (!routerAddress) {
    throw new Error("SWAP_ROUTER_ADDRESS not set in .env — deploy AgniAdapter first");
  }

  // Set router on existing vault (if VAULT_ADDRESS is set and deployer is owner)
  if (vaultAddress) {
    console.log(`\nSetting swap router on vault ${vaultAddress}...`);
    const vault = await ethers.getContractAt("SentinelVault", vaultAddress);

    const currentRouter = await vault.swapRouter();
    console.log("  Current router:", currentRouter);

    const tx = await vault.setSwapRouter(routerAddress);
    await tx.wait();
    console.log("  New router set:", routerAddress);
  }

  // Set default router on factory (if FACTORY_ADDRESS is set and deployer is owner)
  if (factoryAddress) {
    console.log(`\nSetting default swap router on factory ${factoryAddress}...`);
    const factory = await ethers.getContractAt("VaultFactory", factoryAddress);

    const tx = await factory.setDefaultSwapRouter(routerAddress);
    await tx.wait();
    console.log("  Default router set:", routerAddress);
  }

  if (!vaultAddress && !factoryAddress) {
    console.log("\nNo VAULT_ADDRESS or FACTORY_ADDRESS set in .env.");
    console.log("Set one or both and re-run this script.");
  }

  console.log("\nDone!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
