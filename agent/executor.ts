import { ethers } from "ethers";
import { config } from "./config";
import { AgentDecision } from "./reasoning";

// ABIs (minimal)
const VAULT_ABI = [
  "function rebalance(address[] assets, uint256[] newAllocBps) external",
  "function rebalanceWithSwap(address[] assets, uint256[] newAllocBps, address[] swapTokenIn, address[] swapTokenOut, uint256[] swapAmounts) external",
  "function getPortfolio() external view returns (address[], string[], uint256[], uint256[])",
  "function rebalanceCount() external view returns (uint256)",
  "function lastRebalanceTimestamp() external view returns (uint256)",
  "function swapRouter() external view returns (address)",
  "event Rebalance(address indexed agent, address[] assets, uint256[] oldAllocations, uint256[] newAllocations, uint256 timestamp)",
];

const SWAP_ROUTER_ABI = [
  "function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256)",
];

const LOGGER_ABI = [
  "function logDecision(string reasoning, string action, uint256[] oldAllocations, uint256[] newAllocations, string[] assetNames, uint256 portfolioValueUSD, string riskLevel) external",
  "function decisionCount() external view returns (uint256)",
  "function getRecentDecisions(uint256 count) external view returns (tuple(uint256 id, address agent, string reasoning, string action, uint256[] oldAllocations, uint256[] newAllocations, string[] assetNames, uint256 timestamp, uint256 portfolioValueUSD, string riskLevel)[])",
];

const IDENTITY_ABI = [
  "function updateMetadata(uint256 tokenId, uint256 totalDecisions, int256 cumulativeROIBps) external",
  "function agentToToken(address) external view returns (uint256)",
  "function getAgentMetadata(uint256 tokenId) external view returns (tuple(string agentName, string strategyType, uint256 totalDecisions, int256 cumulativeROIBps, uint256 createdAt, uint256 lastActiveAt, address vaultAddress, address loggerAddress))",
];

export class Executor {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private vault: ethers.Contract;
  private logger: ethers.Contract;
  private identity: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.mantleRpc);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.vault = new ethers.Contract(config.vaultAddress, VAULT_ABI, this.wallet);
    this.logger = new ethers.Contract(config.loggerAddress, LOGGER_ABI, this.wallet);
    this.identity = new ethers.Contract(config.identityAddress, IDENTITY_ABI, this.wallet);
  }

  async getCurrentAllocations(): Promise<{
    assets: string[];
    names: string[];
    balances: bigint[];
    allocations: bigint[];
  }> {
    try {
      const [assets, names, balances, allocations] = await this.vault.getPortfolio();
      return { assets, names, balances, allocations };
    } catch (error) {
      console.error("Failed to fetch portfolio:", error);
      return { assets: [], names: [], balances: [], allocations: [] };
    }
  }

  async executeRebalance(decision: AgentDecision): Promise<string | null> {
    if (decision.action === "hold") {
      console.log("Decision: HOLD — no rebalance needed");
      return null;
    }

    const assets = decision.newAllocations.map((a) => a.asset);
    const allocBps = decision.newAllocations.map((a) => a.allocationBps);

    try {
      // Check if swap router is available for real DEX swaps
      const routerAddr = await this.vault.swapRouter().catch(() => ethers.ZeroAddress);

      if (routerAddr !== ethers.ZeroAddress) {
        return await this.executeRebalanceWithSwap(decision, assets, allocBps, routerAddr);
      }

      // Fallback: allocation-only rebalance
      console.log("Executing rebalance on-chain (allocation update)...");
      const tx = await this.vault.rebalance(assets, allocBps);
      const receipt = await tx.wait();
      console.log(`Rebalance tx confirmed: ${receipt.hash}`);
      return receipt.hash;
    } catch (error) {
      console.error("Rebalance transaction failed:", error);
      return null;
    }
  }

  private async executeRebalanceWithSwap(
    decision: AgentDecision,
    assets: string[],
    allocBps: number[],
    routerAddr: string
  ): Promise<string | null> {
    try {
      // Get current portfolio state
      const { balances, allocations } = await this.getCurrentAllocations();
      if (balances.length === 0) {
        // No balances, just update allocations
        const tx = await this.vault.rebalance(assets, allocBps);
        const receipt = await tx.wait();
        return receipt.hash;
      }

      // Calculate which swaps are needed
      const totalValue = balances.reduce((sum, b) => sum + b, 0n);
      if (totalValue === 0n) {
        const tx = await this.vault.rebalance(assets, allocBps);
        const receipt = await tx.wait();
        return receipt.hash;
      }

      const swapTokenIn: string[] = [];
      const swapTokenOut: string[] = [];
      const swapAmounts: bigint[] = [];

      // Find tokens that need to decrease (sell) and increase (buy)
      const sells: { asset: string; amount: bigint }[] = [];
      const buys: { asset: string; amount: bigint }[] = [];

      for (let i = 0; i < assets.length; i++) {
        const currentBps = Number(allocations[i] || 0n);
        const targetBps = allocBps[i];
        const diff = targetBps - currentBps;

        if (diff < -100) {
          // Need to sell this token (decrease allocation by >1%)
          const sellAmount = (balances[i] * BigInt(Math.abs(diff))) / 10000n;
          if (sellAmount > 0n) {
            sells.push({ asset: assets[i], amount: sellAmount });
          }
        } else if (diff > 100) {
          // Need to buy this token (increase allocation by >1%)
          buys.push({ asset: assets[i], amount: BigInt(diff) });
        }
      }

      // Match sells to buys
      for (const sell of sells) {
        for (const buy of buys) {
          if (sell.amount > 0n) {
            swapTokenIn.push(sell.asset);
            swapTokenOut.push(buy.asset);
            swapAmounts.push(sell.amount);
          }
        }
      }

      if (swapTokenIn.length > 0) {
        console.log(`Executing rebalance with ${swapTokenIn.length} DEX swap(s)...`);
        const tx = await this.vault.rebalanceWithSwap(
          assets,
          allocBps,
          swapTokenIn,
          swapTokenOut,
          swapAmounts
        );
        const receipt = await tx.wait();
        console.log(`Rebalance + swap tx confirmed: ${receipt.hash}`);
        return receipt.hash;
      } else {
        console.log("Executing rebalance on-chain (no swaps needed)...");
        const tx = await this.vault.rebalance(assets, allocBps);
        const receipt = await tx.wait();
        console.log(`Rebalance tx confirmed: ${receipt.hash}`);
        return receipt.hash;
      }
    } catch (error) {
      console.error("Rebalance with swap failed, falling back to allocation-only:", error);
      try {
        const tx = await this.vault.rebalance(assets, allocBps);
        const receipt = await tx.wait();
        return receipt.hash;
      } catch (e) {
        console.error("Fallback rebalance also failed:", e);
        return null;
      }
    }
  }

  async logDecisionOnChain(
    decision: AgentDecision,
    oldAllocations: number[],
    portfolioValueUSD: number
  ): Promise<string | null> {
    try {
      const newAlloc = decision.newAllocations.map((a) => a.allocationBps);
      const assetNames = decision.newAllocations.map((a) => a.symbol);

      const tx = await this.logger.logDecision(
        decision.reasoning,
        decision.action,
        oldAllocations,
        newAlloc,
        assetNames,
        Math.floor(portfolioValueUSD),
        decision.riskLevel
      );
      const receipt = await tx.wait();
      console.log(`Decision logged on-chain: ${receipt.hash}`);
      return receipt.hash;
    } catch (error) {
      console.error("Failed to log decision:", error);
      return null;
    }
  }

  async updateIdentity(
    totalDecisions: number,
    roiBps: number
  ): Promise<void> {
    try {
      const tokenId = await this.identity.agentToToken(this.wallet.address);
      if (tokenId === 0n) {
        console.log("No agent identity NFT found, skipping update");
        return;
      }
      const tx = await this.identity.updateMetadata(tokenId, totalDecisions, roiBps);
      await tx.wait();
      console.log("Agent identity metadata updated");
    } catch (error) {
      console.error("Failed to update identity:", error);
    }
  }

  async getRecentDecisions(count: number = 10) {
    try {
      return await this.logger.getRecentDecisions(count);
    } catch (error) {
      console.error("Failed to fetch decisions:", error);
      return [];
    }
  }

  getWalletAddress(): string {
    return this.wallet.address;
  }
}
