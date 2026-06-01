import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("AgentConsensus", function () {
  async function deployFixture() {
    const [owner, market, yieldAgent, risk, portfolio] = await ethers.getSigners();

    const Consensus = await ethers.getContractFactory("AgentConsensus");
    const consensus = await Consensus.deploy(3); // 3 assets

    // Register all 4 agents with roles
    await consensus.registerAgent(market.address, 0);   // Market
    await consensus.registerAgent(yieldAgent.address, 1); // Yield
    await consensus.registerAgent(risk.address, 2);      // Risk
    await consensus.registerAgent(portfolio.address, 3); // Portfolio

    return { consensus, owner, market, yieldAgent, risk, portfolio };
  }

  describe("Deployment", function () {
    it("should set correct asset count", async function () {
      const { consensus } = await loadFixture(deployFixture);
      expect(await consensus.assetCount()).to.equal(3);
    });

    it("should set default quorum to 3", async function () {
      const { consensus } = await loadFixture(deployFixture);
      expect(await consensus.quorumRequired()).to.equal(3);
    });

    it("should set default confidence threshold to 50", async function () {
      const { consensus } = await loadFixture(deployFixture);
      expect(await consensus.confidenceThreshold()).to.equal(50);
    });

    it("should reject zero asset count", async function () {
      const Consensus = await ethers.getContractFactory("AgentConsensus");
      await expect(Consensus.deploy(0)).to.be.revertedWith("AgentConsensus: zero assets");
    });
  });

  describe("Agent Registration", function () {
    it("should register agents with roles", async function () {
      const { consensus, market } = await loadFixture(deployFixture);
      expect(await consensus.registeredAgents(market.address)).to.equal(true);
      expect(await consensus.agentRoles(market.address)).to.equal(0); // Market
    });

    it("should reject unregistered agent actions", async function () {
      const { consensus } = await loadFixture(deployFixture);
      const [, , , , , unregistered] = await ethers.getSigners();

      await expect(
        consensus.connect(unregistered).startRound()
      ).to.be.revertedWith("AgentConsensus: not registered");
    });
  });

  describe("Voting Rounds", function () {
    it("should start a new round", async function () {
      const { consensus, market } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();
      expect(await consensus.roundCount()).to.equal(1);
    });

    it("should accept votes with valid allocations", async function () {
      const { consensus, market, yieldAgent } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();

      await consensus.connect(market).submitVote(
        1, [4000, 3500, 2500], 80, "Bullish market conditions"
      );
      await consensus.connect(yieldAgent).submitVote(
        1, [3500, 3000, 3500], 70, "USDY yields attractive"
      );

      expect(await consensus.hasVoted(1, 0)).to.equal(true); // Market
      expect(await consensus.hasVoted(1, 1)).to.equal(true); // Yield
      expect(await consensus.hasVoted(1, 2)).to.equal(false); // Risk (not voted)
    });

    it("should reject duplicate votes from same role", async function () {
      const { consensus, market } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();
      await consensus.connect(market).submitVote(1, [4000, 3500, 2500], 80, "First vote");

      await expect(
        consensus.connect(market).submitVote(1, [3000, 4000, 3000], 70, "Second vote")
      ).to.be.revertedWith("AgentConsensus: already voted");
    });

    it("should reject allocations not summing to 10000", async function () {
      const { consensus, market } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();

      await expect(
        consensus.connect(market).submitVote(1, [5000, 3000, 1000], 80, "Bad sum")
      ).to.be.revertedWith("AgentConsensus: must sum to 10000");
    });

    it("should reject allocations exceeding 60% cap", async function () {
      const { consensus, market } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();

      await expect(
        consensus.connect(market).submitVote(1, [7000, 2000, 1000], 80, "Over cap")
      ).to.be.revertedWith("AgentConsensus: exceeds 60% cap");
    });

    it("should reject confidence > 100", async function () {
      const { consensus, market } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();

      await expect(
        consensus.connect(market).submitVote(1, [4000, 3500, 2500], 101, "Too confident")
      ).to.be.revertedWith("AgentConsensus: confidence > 100");
    });
  });

  describe("Consensus Resolution", function () {
    it("should resolve with quorum reached and correct weighted average", async function () {
      const { consensus, market, yieldAgent, risk, portfolio } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();

      // All 4 agents vote with equal confidence (80)
      await consensus.connect(market).submitVote(1, [4000, 3000, 3000], 80, "Market");
      await consensus.connect(yieldAgent).submitVote(1, [3000, 4000, 3000], 80, "Yield");
      await consensus.connect(risk).submitVote(1, [3000, 3000, 4000], 80, "Risk");
      await consensus.connect(portfolio).submitVote(1, [4000, 3000, 3000], 80, "Portfolio");

      const tx = await consensus.connect(market).resolveRound(1);
      await tx.wait();

      const [resolved, quorumReached, finalAllocations, combinedConfidence, voteCount] =
        await consensus.getRoundResult(1);

      expect(resolved).to.equal(true);
      expect(quorumReached).to.equal(true);
      expect(voteCount).to.equal(4);
      expect(combinedConfidence).to.equal(80);

      // Equal confidence => simple average: (4000+3000+3000+4000)/4 = 3500
      expect(finalAllocations[0]).to.equal(3500);
    });

    it("should weight by confidence", async function () {
      const { consensus, market, yieldAgent, risk } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();

      // Market: high confidence, wants more USDY
      await consensus.connect(market).submitVote(1, [5000, 3000, 2000], 90, "Strong signal");
      // Yield: low confidence
      await consensus.connect(yieldAgent).submitVote(1, [2000, 5000, 3000], 60, "Uncertain");
      // Risk: medium confidence
      await consensus.connect(risk).submitVote(1, [3000, 2000, 5000], 75, "Moderate risk");

      await consensus.connect(market).resolveRound(1);

      const [, quorumReached, finalAllocations, combinedConfidence] =
        await consensus.getRoundResult(1);

      expect(quorumReached).to.equal(true);
      expect(combinedConfidence).to.equal(75); // (90+60+75)/3

      // Weighted: USDY = (5000*90 + 2000*60 + 3000*75) / (90+60+75) = 795000/225 = 3533
      // Market's high confidence should pull allocation toward USDY
      expect(Number(finalAllocations[0])).to.be.greaterThan(3000);
    });

    it("should fail without quorum", async function () {
      const { consensus, market, yieldAgent } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();

      // Only 2 votes, need 3
      await consensus.connect(market).submitVote(1, [4000, 3500, 2500], 80, "Market");
      await consensus.connect(yieldAgent).submitVote(1, [3500, 3000, 3500], 70, "Yield");

      await consensus.connect(market).resolveRound(1);

      const [resolved, quorumReached] = await consensus.getRoundResult(1);
      expect(resolved).to.equal(true);
      expect(quorumReached).to.equal(false);
    });

    it("should fail if confidence below threshold", async function () {
      const { consensus, market, yieldAgent, risk, owner } = await loadFixture(deployFixture);

      // Set high confidence threshold
      await consensus.connect(owner).setConfidenceThreshold(80);

      await consensus.connect(market).startRound();

      // All agents vote with low confidence
      await consensus.connect(market).submitVote(1, [4000, 3000, 3000], 50, "Unsure");
      await consensus.connect(yieldAgent).submitVote(1, [3000, 4000, 3000], 40, "Very unsure");
      await consensus.connect(risk).submitVote(1, [3000, 3000, 4000], 60, "Somewhat unsure");

      await consensus.connect(market).resolveRound(1);

      const [resolved, quorumReached] = await consensus.getRoundResult(1);
      expect(resolved).to.equal(true);
      expect(quorumReached).to.equal(false);
    });

    it("should reject resolving an already-resolved round", async function () {
      const { consensus, market, yieldAgent, risk } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();
      await consensus.connect(market).submitVote(1, [4000, 3000, 3000], 80, "Market");
      await consensus.connect(yieldAgent).submitVote(1, [3000, 4000, 3000], 80, "Yield");
      await consensus.connect(risk).submitVote(1, [3000, 3000, 4000], 80, "Risk");

      await consensus.connect(market).resolveRound(1);

      await expect(
        consensus.connect(market).resolveRound(1)
      ).to.be.revertedWith("AgentConsensus: already resolved");
    });

    it("should emit ConsensusReached event", async function () {
      const { consensus, market, yieldAgent, risk } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();
      await consensus.connect(market).submitVote(1, [4000, 3000, 3000], 80, "Market");
      await consensus.connect(yieldAgent).submitVote(1, [3000, 4000, 3000], 80, "Yield");
      await consensus.connect(risk).submitVote(1, [3000, 3000, 4000], 80, "Risk");

      await expect(consensus.connect(market).resolveRound(1))
        .to.emit(consensus, "ConsensusReached");
    });
  });

  describe("View Functions", function () {
    it("should return vote details", async function () {
      const { consensus, market } = await loadFixture(deployFixture);

      await consensus.connect(market).startRound();
      await consensus.connect(market).submitVote(1, [4000, 3500, 2500], 85, "Bullish outlook");

      const [voter, allocations, confidence, reasoning] = await consensus.getVote(1, 0);
      expect(voter).to.equal(market.address);
      expect(allocations[0]).to.equal(4000);
      expect(confidence).to.equal(85);
      expect(reasoning).to.equal("Bullish outlook");
    });

    it("should allow owner to adjust quorum", async function () {
      const { consensus, owner } = await loadFixture(deployFixture);
      await consensus.connect(owner).setQuorum(2);
      expect(await consensus.quorumRequired()).to.equal(2);
    });
  });
});
