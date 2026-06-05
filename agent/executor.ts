import { ethers } from "ethers";
import { config } from "./config";
import { PortfolioDecision as AgentDecision } from "./agents/portfolioManager";

// ABIs (minimal)
const VAULT_ABI = [
  "function rebalance(address[] assets, uint256[] newAllocBps) external",
  "function rebalanceWithSwap(address[] assets, uint256[] newAllocBps, address[] swapTokenIn, address[] swapTokenOut, uint256[] swapAmounts, uint256[] minAmountsOut) external",
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
  // Legacy (backwards compatible)
  "function logDecision(string reasoning, string action, uint256[] oldAllocations, uint256[] newAllocations, string[] assetNames, uint256 portfolioValueUSD, string riskLevel) external",
  // Commit-reveal version
  "function commitDecision(bytes32 hash) external returns (uint256 commitId)",
  "function logDecision(string reasoning, string action, uint256[] oldAllocations, uint256[] newAllocations, string[] assetNames, uint256 portfolioValueUSD, string riskLevel, uint256 commitId, bytes32 nonce) external",
  "function decisionCount() external view returns (uint256)",
  "function commitCount() external view returns (uint256)",
  "function getDecisionVerification(uint256 id) external view returns (bytes32 commitHash, bool verified)",
  "function getRecentDecisions(uint256 count) external view returns (tuple(uint256 id, address agent, string reasoning, string action, uint256[] oldAllocations, uint256[] newAllocations, string[] assetNames, uint256 timestamp, uint256 portfolioValueUSD, string riskLevel, bytes32 commitHash, bool verified)[])",
];

const IDENTITY_ABI = [
  "function updateMetadata(uint256 tokenId, uint256 totalDecisions, int256 cumulativeROIBps) external",
  "function recordDecisionOutcome(uint256 tokenId, uint256 portfolioValueUSD, uint256 confidence) external",
  "function agentToToken(address) external view returns (uint256)",
  "function getAgentMetadata(uint256 tokenId) external view returns (tuple(string agentName, string strategyType, uint256 totalDecisions, int256 cumulativeROIBps, uint256 createdAt, uint256 lastActiveAt, address vaultAddress, address loggerAddress))",
  "function computeReputation(uint256 tokenId) external view returns (uint256 winRate, uint256 avgConfidence, uint256 maxDrawdownBps, int256 streakLength, uint256 accuracyScore, uint256 totalGames, uint256 computedAt)",
];

const CONSENSUS_ABI = [
  "function startRound() external returns (uint256 roundId)",
  "function submitVote(uint256 roundId, uint256[] allocations, uint256 confidence, string reasoning) external",
  "function resolveRound(uint256 roundId) external returns (bool success)",
  "function getRoundResult(uint256 roundId) external view returns (bool resolved, bool quorumReached, uint256[] finalAllocations, uint256 combinedConfidence, uint256 voteCount, uint256 startedAt, uint256 resolvedAt)",
  "function getVote(uint256 roundId, uint8 role) external view returns (address voter, uint256[] allocations, uint256 confidence, string reasoning, uint256 timestamp)",
  "function roundCount() external view returns (uint256)",
];

export class Executor {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private vault: ethers.Contract;
  private logger: ethers.Contract;
  private identity: ethers.Contract;
  private consensus: ethers.Contract | null;

  // Sub-agent wallets derived from main key for consensus voting
  private subAgentWallets: ethers.Wallet[];

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.mantleRpc);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.vault = new ethers.Contract(config.vaultAddress, VAULT_ABI, this.wallet);
    this.logger = new ethers.Contract(config.loggerAddress, LOGGER_ABI, this.wallet);
    this.identity = new ethers.Contract(config.identityAddress, IDENTITY_ABI, this.wallet);

    // Initialize consensus contract if address configured
    const consensusAddr = config.consensusAddress;
    this.consensus = consensusAddr
      ? new ethers.Contract(consensusAddr, CONSENSUS_ABI, this.wallet)
      : null;

    // Derive 4 sub-agent wallets using HD paths for consensus voting
    this.subAgentWallets = this.deriveSubAgentWallets();
  }

  private deriveSubAgentWallets(): ethers.Wallet[] {
    const wallets: ethers.Wallet[] = [];
    const roles = ["market", "yield", "risk", "portfolio"];
    for (let i = 0; i < roles.length; i++) {
      // Deterministic derivation: hash(privateKey + role) as new key
      const derivedKey = ethers.keccak256(
        ethers.solidityPacked(["bytes32", "string"], [config.privateKey, roles[i]])
      );
      wallets.push(new ethers.Wallet(derivedKey, this.provider));
    }
    return wallets;
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

  // --- Commit-Reveal ---

  async commitDecision(
    decision: AgentDecision,
    portfolioValueUSD: number
  ): Promise<{ commitId: number; nonce: string } | null> {
    try {
      // Generate random nonce
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      // Build the hash: keccak256(reasoning + action + allocations + portfolioValue + nonce)
      const allocBps = decision.newAllocations.map((a) => a.allocationBps);
      const hash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "string", "uint256[]", "uint256", "bytes32"],
          [decision.reasoning, decision.action, allocBps, Math.floor(portfolioValueUSD), nonce]
        )
      );

      console.log(`[Commit-Reveal] Committing decision hash on-chain...`);
      const tx = await this.logger.commitDecision(hash);
      const receipt = await tx.wait();

      // Parse commitId from event
      const event = receipt.logs.find(
        (log: any) => log.fragment?.name === "DecisionCommitted"
      );
      const commitId = event ? Number(event.args[0]) : await this.logger.commitCount();

      console.log(`[Commit-Reveal] Committed: hash=${hash.slice(0, 18)}... commitId=${commitId}`);
      return { commitId: Number(commitId), nonce };
    } catch (error) {
      console.error("[Commit-Reveal] Commit failed:", error);
      return null;
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
      const { balances, allocations } = await this.getCurrentAllocations();
      if (balances.length === 0) {
        const tx = await this.vault.rebalance(assets, allocBps);
        const receipt = await tx.wait();
        return receipt.hash;
      }

      const totalValue = balances.reduce((sum, b) => sum + b, 0n);
      if (totalValue === 0n) {
        const tx = await this.vault.rebalance(assets, allocBps);
        const receipt = await tx.wait();
        return receipt.hash;
      }

      const sells: { asset: string; index: number; amount: bigint }[] = [];
      const buys: { asset: string; index: number; bpsDelta: number }[] = [];

      for (let i = 0; i < assets.length; i++) {
        const currentBps = Number(allocations[i] || 0n);
        const targetBps = allocBps[i];
        const diff = targetBps - currentBps;

        if (diff < -100) {
          const sellFraction = BigInt(Math.abs(diff));
          const sellAmount = (balances[i] * sellFraction) / 10000n;
          if (sellAmount > 0n) {
            sells.push({ asset: assets[i], index: i, amount: sellAmount });
          }
        } else if (diff > 100) {
          buys.push({ asset: assets[i], index: i, bpsDelta: diff });
        }
      }

      const swapTokenIn: string[] = [];
      const swapTokenOut: string[] = [];
      const swapAmounts: bigint[] = [];
      const minAmountsOut: bigint[] = [];

      const totalBuyBps = buys.reduce((sum, b) => sum + b.bpsDelta, 0);

      for (const sell of sells) {
        for (const buy of buys) {
          const proportion = buy.bpsDelta / totalBuyBps;
          const swapAmount = BigInt(Math.floor(Number(sell.amount) * proportion));
          if (swapAmount > 0n) {
            swapTokenIn.push(sell.asset);
            swapTokenOut.push(buy.asset);
            swapAmounts.push(swapAmount);
            const minOut = (swapAmount * 98n) / 100n;
            minAmountsOut.push(minOut);
          }
        }
      }

      if (swapTokenIn.length > 0) {
        console.log(`Executing rebalance with ${swapTokenIn.length} DEX swap(s)...`);
        const swapRouter = new ethers.Contract(routerAddr, SWAP_ROUTER_ABI, this.provider);
        for (let i = 0; i < swapTokenIn.length; i++) {
          try {
            const quote = await swapRouter.getAmountOut(swapTokenIn[i], swapTokenOut[i], swapAmounts[i]);
            minAmountsOut[i] = (quote * 98n) / 100n;
          } catch {
            // Keep the existing estimate
          }
        }

        const tx = await this.vault.rebalanceWithSwap(
          assets, allocBps, swapTokenIn, swapTokenOut, swapAmounts, minAmountsOut
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

  // --- Commit-Reveal Log Decision ---

  async logDecisionOnChain(
    decision: AgentDecision,
    oldAllocations: number[],
    portfolioValueUSD: number,
    commitData?: { commitId: number; nonce: string } | null
  ): Promise<string | null> {
    try {
      const newAlloc = decision.newAllocations.map((a) => a.allocationBps);
      const assetNames = decision.newAllocations.map((a) => a.symbol);

      let tx;
      if (commitData && commitData.commitId > 0) {
        // Reveal phase: log with commit verification
        console.log(`[Commit-Reveal] Revealing decision (commitId=${commitData.commitId})...`);
        tx = await this.logger[
          "logDecision(string,string,uint256[],uint256[],string[],uint256,string,uint256,bytes32)"
        ](
          decision.reasoning,
          decision.action,
          oldAllocations,
          newAlloc,
          assetNames,
          Math.floor(portfolioValueUSD),
          decision.riskLevel,
          commitData.commitId,
          commitData.nonce
        );
      } else {
        // Legacy: log without commit-reveal
        tx = await this.logger[
          "logDecision(string,string,uint256[],uint256[],string[],uint256,string)"
        ](
          decision.reasoning,
          decision.action,
          oldAllocations,
          newAlloc,
          assetNames,
          Math.floor(portfolioValueUSD),
          decision.riskLevel
        );
      }

      const receipt = await tx.wait();
      console.log(`Decision logged on-chain: ${receipt.hash}`);

      // Check verification status
      if (commitData) {
        try {
          const count = await this.logger.decisionCount();
          const [, verified] = await this.logger.getDecisionVerification(count);
          console.log(`[Commit-Reveal] Verification: ${verified ? "VERIFIED" : "UNVERIFIED"}`);
        } catch {}
      }

      return receipt.hash;
    } catch (error) {
      console.error("Failed to log decision:", error);
      return null;
    }
  }

  // --- Multi-Agent Consensus ---

  async startConsensusRound(): Promise<number | null> {
    if (!this.consensus) return null;
    try {
      const tx = await this.consensus.startRound();
      const receipt = await tx.wait();
      const roundId = Number(await this.consensus.roundCount());
      console.log(`[Consensus] Round ${roundId} started`);
      return roundId;
    } catch (error) {
      console.error("[Consensus] Failed to start round:", error);
      return null;
    }
  }

  async submitVote(
    roundId: number,
    role: number, // 0=Market, 1=Yield, 2=Risk, 3=Portfolio
    allocations: number[],
    confidence: number,
    reasoning: string
  ): Promise<boolean> {
    if (!this.consensus || roundId <= 0) return false;
    try {
      const wallet = this.subAgentWallets[role];
      const consensusWithWallet = this.consensus.connect(wallet) as ethers.Contract;
      const tx = await consensusWithWallet.submitVote(roundId, allocations, confidence, reasoning);
      await tx.wait();
      const roleNames = ["Market", "Yield", "Risk", "Portfolio"];
      console.log(`[Consensus] ${roleNames[role]} agent voted (confidence: ${confidence}%)`);
      return true;
    } catch (error) {
      console.error(`[Consensus] Vote failed for role ${role}:`, error);
      return false;
    }
  }

  async resolveConsensus(roundId: number): Promise<{
    success: boolean;
    allocations: number[];
    confidence: number;
  } | null> {
    if (!this.consensus || roundId <= 0) return null;
    try {
      const tx = await this.consensus.resolveRound(roundId);
      await tx.wait();

      const result = await this.consensus.getRoundResult(roundId);
      const [resolved, quorumReached, finalAllocations, combinedConfidence, voteCount] = result;

      console.log(`[Consensus] Round ${roundId} resolved: quorum=${quorumReached}, votes=${voteCount}, confidence=${combinedConfidence}`);

      return {
        success: quorumReached,
        allocations: finalAllocations.map((a: bigint) => Number(a)),
        confidence: Number(combinedConfidence),
      };
    } catch (error) {
      console.error("[Consensus] Resolution failed:", error);
      return null;
    }
  }

  // --- Reputation ---

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

  async recordDecisionOutcome(
    portfolioValueUSD: number,
    confidence: number
  ): Promise<void> {
    try {
      const tokenId = await this.identity.agentToToken(this.wallet.address);
      if (tokenId === 0n) return;

      const tx = await this.identity.recordDecisionOutcome(
        tokenId,
        Math.floor(portfolioValueUSD),
        Math.min(100, Math.max(0, confidence))
      );
      await tx.wait();
      console.log("[Reputation] Decision outcome recorded on-chain");
    } catch (error) {
      console.error("[Reputation] Failed to record outcome:", error);
    }
  }

  async getReputation(): Promise<{
    winRate: number;
    avgConfidence: number;
    maxDrawdownBps: number;
    streakLength: number;
    accuracyScore: number;
    totalGames: number;
  } | null> {
    try {
      const tokenId = await this.identity.agentToToken(this.wallet.address);
      if (tokenId === 0n) return null;

      const [winRate, avgConfidence, maxDrawdownBps, streakLength, accuracyScore, totalGames] =
        await this.identity.computeReputation(tokenId);

      return {
        winRate: Number(winRate),
        avgConfidence: Number(avgConfidence),
        maxDrawdownBps: Number(maxDrawdownBps),
        streakLength: Number(streakLength),
        accuracyScore: Number(accuracyScore),
        totalGames: Number(totalGames),
      };
    } catch (error) {
      console.error("[Reputation] Failed to fetch:", error);
      return null;
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

  getSubAgentAddresses(): string[] {
    return this.subAgentWallets.map((w) => w.address);
  }

  /**
   * Execute a single DCA swap: sell `amountBps` of sourceAsset for targetAsset.
   */
  async executeDcaSwap(
    sourceAsset: string,
    targetAsset: string,
    amountBps: number
  ): Promise<string | null> {
    try {
      const { assets, balances, names } = await this.getCurrentAllocations();
      if (assets.length === 0) {
        console.error("[DCA] No portfolio assets found");
        return null;
      }

      // Find source asset index
      const sourceIdx = names.findIndex(
        (n: string) => n.toUpperCase() === sourceAsset.toUpperCase()
      );
      if (sourceIdx === -1) {
        console.error(`[DCA] Source asset ${sourceAsset} not found in portfolio`);
        return null;
      }

      const sourceBalance = balances[sourceIdx];
      const swapAmount = (sourceBalance * BigInt(amountBps)) / 10000n;
      if (swapAmount === 0n) {
        console.log("[DCA] Swap amount is 0, skipping");
        return null;
      }

      // Find target asset index
      const targetIdx = names.findIndex(
        (n: string) => n.toUpperCase() === targetAsset.toUpperCase()
      );
      if (targetIdx === -1) {
        console.error(`[DCA] Target asset ${targetAsset} not found in portfolio`);
        return null;
      }

      const routerAddr = await this.vault.swapRouter().catch(() => ethers.ZeroAddress);
      if (routerAddr === ethers.ZeroAddress) {
        console.log("[DCA] No swap router available, skipping DCA swap");
        return null;
      }

      // Get quote for slippage protection
      const swapRouter = new ethers.Contract(routerAddr, SWAP_ROUTER_ABI, this.provider);
      let minOut = (swapAmount * 98n) / 100n; // default 2% slippage
      try {
        const quote = await swapRouter.getAmountOut(
          assets[sourceIdx],
          assets[targetIdx],
          swapAmount
        );
        minOut = (quote * 98n) / 100n;
      } catch {}

      // Pass current on-chain allocations to preserve them — only the swap changes balances
      const { allocations: currentOnChainAlloc } = await this.getCurrentAllocations();
      const currentAllocBps = currentOnChainAlloc.map((a) => Number(a));
      console.log(
        `[DCA] Swapping ${amountBps / 100}% of ${sourceAsset} -> ${targetAsset}`
      );

      const tx = await this.vault.rebalanceWithSwap(
        assets,
        currentAllocBps, // preserve current allocations
        [assets[sourceIdx]],
        [assets[targetIdx]],
        [swapAmount],
        [minOut]
      );
      const receipt = await tx.wait();
      console.log(`[DCA] Swap tx confirmed: ${receipt.hash}`);
      return receipt.hash;
    } catch (error) {
      console.error("[DCA] Swap failed:", error);
      return null;
    }
  }
}
