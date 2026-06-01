import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("DecisionLogger — Commit-Reveal", function () {
  async function deployFixture() {
    const [owner, agent] = await ethers.getSigners();

    const Logger = await ethers.getContractFactory("DecisionLogger");
    const logger = await Logger.deploy(agent.address);

    return { logger, owner, agent };
  }

  describe("Commit Phase", function () {
    it("should accept a commit from the agent", async function () {
      const { logger, agent } = await loadFixture(deployFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const tx = await logger.connect(agent).commitDecision(hash);
      await tx.wait();

      expect(await logger.commitCount()).to.equal(1);

      const [storedHash, storedAgent, , revealed] = await logger.getCommit(1);
      expect(storedHash).to.equal(hash);
      expect(storedAgent).to.equal(agent.address);
      expect(revealed).to.equal(false);
    });

    it("should emit DecisionCommitted event", async function () {
      const { logger, agent } = await loadFixture(deployFixture);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));

      await expect(logger.connect(agent).commitDecision(hash))
        .to.emit(logger, "DecisionCommitted");
    });

    it("should reject empty hash", async function () {
      const { logger, agent } = await loadFixture(deployFixture);
      await expect(
        logger.connect(agent).commitDecision(ethers.ZeroHash)
      ).to.be.revertedWith("DecisionLogger: empty hash");
    });

    it("should reject unauthorized commit", async function () {
      const { logger } = await loadFixture(deployFixture);
      const [, , unauthorized] = await ethers.getSigners();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));

      await expect(
        logger.connect(unauthorized).commitDecision(hash)
      ).to.be.revertedWith("DecisionLogger: not authorized");
    });

    it("should accept multiple commits", async function () {
      const { logger, agent } = await loadFixture(deployFixture);

      const hash1 = ethers.keccak256(ethers.toUtf8Bytes("decision1"));
      const hash2 = ethers.keccak256(ethers.toUtf8Bytes("decision2"));

      await logger.connect(agent).commitDecision(hash1);
      await logger.connect(agent).commitDecision(hash2);

      expect(await logger.commitCount()).to.equal(2);
    });
  });

  describe("Reveal Phase — Verified", function () {
    it("should verify a correct reveal", async function () {
      const { logger, agent } = await loadFixture(deployFixture);

      // Data for the decision
      const reasoning = "Market bullish, increasing mETH allocation";
      const action = "rebalance";
      const newAllocations = [4000, 3500, 2500];
      const portfolioValueUSD = 100000;
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      // Compute hash
      const hash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "string", "uint256[]", "uint256", "bytes32"],
          [reasoning, action, newAllocations, portfolioValueUSD, nonce]
        )
      );

      // Phase 1: Commit
      await logger.connect(agent).commitDecision(hash);

      // Phase 3: Reveal (log with commit verification)
      await logger.connect(agent)[
        "logDecision(string,string,uint256[],uint256[],string[],uint256,string,uint256,bytes32)"
      ](
        reasoning,
        action,
        [3333, 3334, 3333], // old allocations
        newAllocations,
        ["USDY", "mETH", "USDC"],
        portfolioValueUSD,
        "low",
        1, // commitId
        nonce
      );

      // Verify
      const [commitHash, verified] = await logger.getDecisionVerification(1);
      expect(verified).to.equal(true);
      expect(commitHash).to.equal(hash);
    });

    it("should emit DecisionRevealed event", async function () {
      const { logger, agent } = await loadFixture(deployFixture);

      const reasoning = "Test";
      const action = "hold";
      const newAllocations = [3333, 3334, 3333];
      const portfolioValueUSD = 50000;
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      const hash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "string", "uint256[]", "uint256", "bytes32"],
          [reasoning, action, newAllocations, portfolioValueUSD, nonce]
        )
      );

      await logger.connect(agent).commitDecision(hash);

      await expect(
        logger.connect(agent)[
          "logDecision(string,string,uint256[],uint256[],string[],uint256,string,uint256,bytes32)"
        ](
          reasoning, action, [3333, 3334, 3333], newAllocations,
          ["USDY", "mETH", "USDC"], portfolioValueUSD, "low", 1, nonce
        )
      ).to.emit(logger, "DecisionRevealed").withArgs(1, 1, true);
    });
  });

  describe("Reveal Phase — Unverified", function () {
    it("should flag tampered data as unverified", async function () {
      const { logger, agent } = await loadFixture(deployFixture);

      const reasoning = "Original reasoning";
      const action = "rebalance";
      const newAllocations = [4000, 3500, 2500];
      const portfolioValueUSD = 100000;
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      // Commit with correct data
      const hash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "string", "uint256[]", "uint256", "bytes32"],
          [reasoning, action, newAllocations, portfolioValueUSD, nonce]
        )
      );
      await logger.connect(agent).commitDecision(hash);

      // Reveal with DIFFERENT reasoning (tampered)
      await logger.connect(agent)[
        "logDecision(string,string,uint256[],uint256[],string[],uint256,string,uint256,bytes32)"
      ](
        "Tampered reasoning",
        action,
        [3333, 3334, 3333],
        newAllocations,
        ["USDY", "mETH", "USDC"],
        portfolioValueUSD,
        "low",
        1,
        nonce
      );

      const [, verified] = await logger.getDecisionVerification(1);
      expect(verified).to.equal(false);
    });

    it("should flag wrong nonce as unverified", async function () {
      const { logger, agent } = await loadFixture(deployFixture);

      const reasoning = "Some reasoning";
      const action = "rebalance";
      const newAllocations = [4000, 3500, 2500];
      const portfolioValueUSD = 100000;
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const wrongNonce = ethers.hexlify(ethers.randomBytes(32));

      const hash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "string", "uint256[]", "uint256", "bytes32"],
          [reasoning, action, newAllocations, portfolioValueUSD, nonce]
        )
      );
      await logger.connect(agent).commitDecision(hash);

      await logger.connect(agent)[
        "logDecision(string,string,uint256[],uint256[],string[],uint256,string,uint256,bytes32)"
      ](
        reasoning, action, [3333, 3334, 3333], newAllocations,
        ["USDY", "mETH", "USDC"], portfolioValueUSD, "low", 1, wrongNonce
      );

      const [, verified] = await logger.getDecisionVerification(1);
      expect(verified).to.equal(false);
    });

    it("should reject double-reveal of same commit", async function () {
      const { logger, agent } = await loadFixture(deployFixture);

      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const hash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "string", "uint256[]", "uint256", "bytes32"],
          ["r", "a", [3333, 3334, 3333], 100000, nonce]
        )
      );
      await logger.connect(agent).commitDecision(hash);

      // First reveal
      await logger.connect(agent)[
        "logDecision(string,string,uint256[],uint256[],string[],uint256,string,uint256,bytes32)"
      ]("r", "a", [3333, 3334, 3333], [3333, 3334, 3333], ["USDY", "mETH", "USDC"], 100000, "low", 1, nonce);

      // Second reveal should fail
      await expect(
        logger.connect(agent)[
          "logDecision(string,string,uint256[],uint256[],string[],uint256,string,uint256,bytes32)"
        ]("r", "a", [3333, 3334, 3333], [3333, 3334, 3333], ["USDY", "mETH", "USDC"], 100000, "low", 1, nonce)
      ).to.be.revertedWith("DecisionLogger: already revealed");
    });
  });
});

async function getBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp + 1;
}
