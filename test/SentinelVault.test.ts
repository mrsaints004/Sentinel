import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("SentinelVault", function () {
  async function deployFixture() {
    const [owner, agent, user] = await ethers.getSigners();

    const Vault = await ethers.getContractFactory("SentinelVault");
    const vault = await Vault.deploy(agent.address);

    // Deploy a mock ERC20 for testing
    const MockToken = await ethers.getContractFactory("MockERC20");
    const tokenA = await MockToken.deploy("USDY", "USDY");
    const tokenB = await MockToken.deploy("mETH", "mETH");
    const tokenC = await MockToken.deploy("USDC", "USDC");

    // Add supported assets
    await vault.addSupportedAsset(await tokenA.getAddress(), "USDY");
    await vault.addSupportedAsset(await tokenB.getAddress(), "mETH");
    await vault.addSupportedAsset(await tokenC.getAddress(), "USDC");

    // Mint tokens to user
    const amount = ethers.parseEther("10000");
    await tokenA.mint(user.address, amount);
    await tokenB.mint(user.address, amount);
    await tokenC.mint(user.address, amount);

    return { vault, tokenA, tokenB, tokenC, owner, agent, user };
  }

  describe("Deployment", function () {
    it("should set the correct agent", async function () {
      const { vault, agent } = await loadFixture(deployFixture);
      expect(await vault.agent()).to.equal(agent.address);
    });

    it("should set the correct owner", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("should have 3 supported assets", async function () {
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.getAssetCount()).to.equal(3);
    });

    it("should reject zero address agent", async function () {
      const Vault = await ethers.getContractFactory("SentinelVault");
      await expect(Vault.deploy(ethers.ZeroAddress)).to.be.revertedWith("SentinelVault: zero address");
    });
  });

  describe("Deposits", function () {
    it("should accept deposits for supported assets", async function () {
      const { vault, tokenA, user } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1000");

      await tokenA.connect(user).approve(await vault.getAddress(), amount);
      await vault.connect(user).deposit(await tokenA.getAddress(), amount);

      expect(await vault.userDeposits(user.address, await tokenA.getAddress())).to.equal(amount);
      expect(await vault.assetBalances(await tokenA.getAddress())).to.equal(amount);
    });

    it("should reject deposits for unsupported assets", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      const fakeToken = ethers.Wallet.createRandom().address;

      await expect(
        vault.connect(user).deposit(fakeToken, 1000)
      ).to.be.revertedWith("Asset not supported");
    });

    it("should reject zero amount deposits", async function () {
      const { vault, tokenA, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).deposit(await tokenA.getAddress(), 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("should emit Deposit event", async function () {
      const { vault, tokenA, user } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("500");

      await tokenA.connect(user).approve(await vault.getAddress(), amount);

      await expect(vault.connect(user).deposit(await tokenA.getAddress(), amount))
        .to.emit(vault, "Deposit")
        .withArgs(user.address, await tokenA.getAddress(), amount);
    });
  });

  describe("Withdrawals", function () {
    it("should allow withdrawals up to deposited amount", async function () {
      const { vault, tokenA, user } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1000");

      await tokenA.connect(user).approve(await vault.getAddress(), amount);
      await vault.connect(user).deposit(await tokenA.getAddress(), amount);
      await vault.connect(user).withdraw(await tokenA.getAddress(), amount);

      expect(await vault.userDeposits(user.address, await tokenA.getAddress())).to.equal(0);
    });

    it("should reject over-withdrawal", async function () {
      const { vault, tokenA, user } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1000");

      await tokenA.connect(user).approve(await vault.getAddress(), amount);
      await vault.connect(user).deposit(await tokenA.getAddress(), amount);

      await expect(
        vault.connect(user).withdraw(await tokenA.getAddress(), amount + 1n)
      ).to.be.revertedWith("Insufficient balance");
    });

    it("should reject zero amount withdrawal", async function () {
      const { vault, tokenA, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).withdraw(await tokenA.getAddress(), 0)
      ).to.be.revertedWith("Amount must be > 0");
    });
  });

  describe("Rebalance", function () {
    it("should allow agent to rebalance", async function () {
      const { vault, tokenA, tokenB, tokenC, agent } = await loadFixture(deployFixture);

      const assets = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];
      const allocations = [4000, 3500, 2500];

      await vault.connect(agent).rebalance(assets, allocations);

      expect(await vault.targetAllocations(assets[0])).to.equal(4000);
      expect(await vault.targetAllocations(assets[1])).to.equal(3500);
      expect(await vault.targetAllocations(assets[2])).to.equal(2500);
      expect(await vault.rebalanceCount()).to.equal(1);
    });

    it("should reject non-agent rebalance", async function () {
      const { vault, tokenA, tokenB, tokenC, user } = await loadFixture(deployFixture);

      const assets = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];

      await expect(
        vault.connect(user).rebalance(assets, [3333, 3334, 3333])
      ).to.be.revertedWith("SentinelVault: not agent");
    });

    it("should require allocations to sum to 10000", async function () {
      const { vault, tokenA, tokenB, tokenC, agent } = await loadFixture(deployFixture);

      const assets = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];

      await expect(
        vault.connect(agent).rebalance(assets, [5000, 3000, 1000])
      ).to.be.revertedWith("Must sum to 100%");
    });

    it("should enforce 60% cap per asset", async function () {
      const { vault, tokenA, tokenB, tokenC, agent } = await loadFixture(deployFixture);

      const assets = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];

      await expect(
        vault.connect(agent).rebalance(assets, [7000, 2000, 1000])
      ).to.be.revertedWith("Exceeds 60% limit");
    });

    it("should reject empty assets", async function () {
      const { vault, agent } = await loadFixture(deployFixture);

      await expect(
        vault.connect(agent).rebalance([], [])
      ).to.be.revertedWith("Empty assets");
    });

    it("should emit Rebalance event", async function () {
      const { vault, tokenA, tokenB, tokenC, agent } = await loadFixture(deployFixture);

      const assets = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];

      await expect(vault.connect(agent).rebalance(assets, [4000, 3500, 2500]))
        .to.emit(vault, "Rebalance");
    });

    it("should track rebalance count", async function () {
      const { vault, tokenA, tokenB, tokenC, agent } = await loadFixture(deployFixture);

      const assets = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];

      await vault.connect(agent).rebalance(assets, [4000, 3500, 2500]);
      await vault.connect(agent).rebalance(assets, [3000, 4000, 3000]);
      expect(await vault.rebalanceCount()).to.equal(2);
    });
  });

  describe("RebalanceWithSwap", function () {
    it("should reject when no swap router set", async function () {
      const { vault, tokenA, tokenB, tokenC, agent } = await loadFixture(deployFixture);
      const assets = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];

      await expect(
        vault.connect(agent).rebalanceWithSwap(
          assets, [4000, 3500, 2500], [], [], [], []
        )
      ).to.be.revertedWith("No swap router");
    });

    it("should reject mismatched swap arrays", async function () {
      const { vault, tokenA, tokenB, tokenC, agent, owner } = await loadFixture(deployFixture);

      // Set a dummy swap router
      const MockToken = await ethers.getContractFactory("MockERC20");
      const fakeRouter = await MockToken.deploy("Router", "RTR");
      await vault.connect(owner).setSwapRouter(await fakeRouter.getAddress());

      const assets = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];

      await expect(
        vault.connect(agent).rebalanceWithSwap(
          assets,
          [4000, 3500, 2500],
          [await tokenA.getAddress()],
          [],
          [],
          []
        )
      ).to.be.revertedWith("Swap arrays mismatch");
    });
  });

  describe("Portfolio view", function () {
    it("should return portfolio data", async function () {
      const { vault, tokenA, tokenB, tokenC, agent } = await loadFixture(deployFixture);

      const assets = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];
      await vault.connect(agent).rebalance(assets, [4000, 3500, 2500]);

      const [retAssets, names, balances, allocations] = await vault.getPortfolio();

      expect(retAssets.length).to.equal(3);
      expect(names[0]).to.equal("USDY");
      expect(allocations[0]).to.equal(4000);
    });
  });

  describe("Access control", function () {
    it("should allow owner to change agent", async function () {
      const { vault, owner, user } = await loadFixture(deployFixture);
      await vault.connect(owner).setAgent(user.address);
      expect(await vault.agent()).to.equal(user.address);
    });

    it("should reject non-owner changing agent", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).setAgent(user.address)
      ).to.be.reverted;
    });
  });
});

describe("DecisionLogger", function () {
  async function deployLoggerFixture() {
    const [owner, agent] = await ethers.getSigners();

    const Logger = await ethers.getContractFactory("DecisionLogger");
    const logger = await Logger.deploy(agent.address);

    return { logger, owner, agent };
  }

  it("should log decisions from agent", async function () {
    const { logger, agent } = await loadFixture(deployLoggerFixture);

    await logger.connect(agent)[
      "logDecision(string,string,uint256[],uint256[],string[],uint256,string)"
    ](
      "Test reasoning",
      "rebalance",
      [3333, 3334, 3333],
      [4000, 3500, 2500],
      ["USDY", "mETH", "USDC"],
      100000,
      "low"
    );

    expect(await logger.decisionCount()).to.equal(1);

    const [, reasoning, action] = await logger.getDecision(1);
    expect(reasoning).to.equal("Test reasoning");
    expect(action).to.equal("rebalance");
  });

  it("should reject unauthorized logging", async function () {
    const { logger } = await loadFixture(deployLoggerFixture);
    const [, , unauthorized] = await ethers.getSigners();

    await expect(
      logger.connect(unauthorized)[
        "logDecision(string,string,uint256[],uint256[],string[],uint256,string)"
      ](
        "Hack",
        "steal",
        [0],
        [10000],
        ["ETH"],
        0,
        "critical"
      )
    ).to.be.revertedWith("DecisionLogger: not authorized");
  });

  it("should return recent decisions", async function () {
    const { logger, agent } = await loadFixture(deployLoggerFixture);

    for (let i = 0; i < 3; i++) {
      await logger.connect(agent)[
        "logDecision(string,string,uint256[],uint256[],string[],uint256,string)"
      ](
        `Decision ${i}`,
        "rebalance",
        [3333, 3334, 3333],
        [4000, 3500, 2500],
        ["USDY", "mETH", "USDC"],
        100000 + i * 100,
        "low"
      );
    }

    const recent = await logger.getRecentDecisions(2);
    expect(recent.length).to.equal(2);
  });

  it("should mark unverified decisions logged without commit", async function () {
    const { logger, agent } = await loadFixture(deployLoggerFixture);

    await logger.connect(agent)[
      "logDecision(string,string,uint256[],uint256[],string[],uint256,string)"
    ](
      "No commit reasoning",
      "rebalance",
      [3333, 3334, 3333],
      [4000, 3500, 2500],
      ["USDY", "mETH", "USDC"],
      100000,
      "low"
    );

    const [commitHash, verified] = await logger.getDecisionVerification(1);
    expect(commitHash).to.equal(ethers.ZeroHash);
    expect(verified).to.equal(false);
  });
});

describe("AgentIdentity", function () {
  async function deployIdentityFixture() {
    const [owner, agent] = await ethers.getSigners();

    const Identity = await ethers.getContractFactory("AgentIdentity");
    const identity = await Identity.deploy();

    return { identity, owner, agent };
  }

  it("should register an agent and mint NFT", async function () {
    const { identity, agent } = await loadFixture(deployIdentityFixture);

    await identity.registerAgent(
      agent.address,
      "Sentinel Alpha",
      "Yield-Optimized",
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );

    expect(await identity.ownerOf(1)).to.equal(agent.address);
    expect(await identity.agentToToken(agent.address)).to.equal(1);
  });

  it("should update metadata", async function () {
    const { identity, owner, agent } = await loadFixture(deployIdentityFixture);

    await identity.registerAgent(
      agent.address,
      "Sentinel Alpha",
      "Yield-Optimized",
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );

    await identity.setUpdater(owner.address);
    await identity.updateMetadata(1, 10, 250);

    const meta = await identity.getAgentMetadata(1);
    expect(meta.totalDecisions).to.equal(10);
    expect(meta.cumulativeROIBps).to.equal(250);
  });

  it("should generate on-chain tokenURI with reputation", async function () {
    const { identity, agent } = await loadFixture(deployIdentityFixture);

    await identity.registerAgent(
      agent.address,
      "Sentinel Alpha",
      "Yield-Optimized",
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );

    const uri = await identity.tokenURI(1);
    expect(uri).to.contain("data:application/json;base64,");
  });

  it("should compute reputation with default values", async function () {
    const { identity, agent } = await loadFixture(deployIdentityFixture);

    await identity.registerAgent(
      agent.address,
      "Sentinel Alpha",
      "Yield-Optimized",
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );

    const [winRate, avgConfidence, maxDrawdownBps, streakLength, accuracyScore, totalGames] =
      await identity.computeReputation(1);

    expect(winRate).to.equal(0);
    expect(avgConfidence).to.equal(0);
    expect(maxDrawdownBps).to.equal(0);
    expect(streakLength).to.equal(0);
    expect(accuracyScore).to.equal(500); // neutral starting score
    expect(totalGames).to.equal(0);
  });

  it("should track wins and losses via recordDecisionOutcome", async function () {
    const { identity, owner, agent } = await loadFixture(deployIdentityFixture);

    await identity.registerAgent(
      agent.address,
      "Sentinel Alpha",
      "Yield-Optimized",
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );
    await identity.setUpdater(owner.address);

    // Record outcomes: first sets baseline, then wins/losses
    await identity.recordDecisionOutcome(1, 10000, 80); // baseline
    await identity.recordDecisionOutcome(1, 10500, 75); // win
    await identity.recordDecisionOutcome(1, 10200, 70); // loss

    const [winRate, avgConfidence, , , , totalGames] = await identity.computeReputation(1);
    expect(totalGames).to.equal(2); // 1 win + 1 loss
    expect(winRate).to.equal(5000); // 50% = 5000 bps
    expect(avgConfidence).to.equal(75); // (80+75+70)/3 = 75
  });
});
