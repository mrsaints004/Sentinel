// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentConsensus — Multi-Agent On-Chain Voting Protocol
 * @notice Implements confidence-weighted consensus for autonomous AI sub-agents.
 *         Each sub-agent (Market, Yield, Risk, Portfolio) submits a signed vote
 *         with proposed allocations and a confidence score. The contract aggregates
 *         votes using confidence-weighted averaging and enforces quorum rules.
 */
contract AgentConsensus is Ownable, ReentrancyGuard {
    enum AgentRole { Market, Yield, Risk, Portfolio }

    struct Vote {
        address voter;
        AgentRole role;
        uint256[] allocations;  // bps per asset
        uint256 confidence;     // 0-100
        string reasoning;
        uint256 timestamp;
    }

    struct Round {
        uint256 id;
        uint256 startedAt;
        uint256 resolvedAt;
        uint256 voteCount;
        bool resolved;
        uint256[] finalAllocations;
        uint256 combinedConfidence;
        bool quorumReached;
        mapping(AgentRole => Vote) votes;
        mapping(AgentRole => bool) hasVoted;
    }

    uint256 public roundCount;
    uint256 public assetCount;
    uint256 public quorumRequired;       // minimum votes needed (default 3 of 4)
    uint256 public confidenceThreshold;  // minimum combined confidence (default 50)

    mapping(address => AgentRole) public agentRoles;
    mapping(address => bool) public registeredAgents;
    mapping(uint256 => Round) public rounds;

    event RoundStarted(uint256 indexed roundId, uint256 timestamp);
    event VoteSubmitted(
        uint256 indexed roundId,
        address indexed voter,
        AgentRole role,
        uint256 confidence
    );
    event ConsensusReached(
        uint256 indexed roundId,
        uint256[] finalAllocations,
        uint256 combinedConfidence,
        uint256 timestamp
    );
    event ConsensusFailed(uint256 indexed roundId, string reason);
    event AgentRegistered(address indexed agent, AgentRole role);

    modifier onlyRegistered() {
        require(registeredAgents[msg.sender], "AgentConsensus: not registered");
        _;
    }

    constructor(uint256 _assetCount) Ownable(msg.sender) {
        require(_assetCount > 0, "AgentConsensus: zero assets");
        assetCount = _assetCount;
        quorumRequired = 3;
        confidenceThreshold = 50;
    }

    function registerAgent(address agent, AgentRole role) external onlyOwner {
        require(agent != address(0), "AgentConsensus: zero address");
        agentRoles[agent] = role;
        registeredAgents[agent] = true;
        emit AgentRegistered(agent, role);
    }

    function setQuorum(uint256 _quorum) external onlyOwner {
        require(_quorum > 0 && _quorum <= 4, "AgentConsensus: invalid quorum");
        quorumRequired = _quorum;
    }

    function setConfidenceThreshold(uint256 _threshold) external onlyOwner {
        require(_threshold <= 100, "AgentConsensus: invalid threshold");
        confidenceThreshold = _threshold;
    }

    /// @notice Start a new voting round
    function startRound() external onlyRegistered returns (uint256 roundId) {
        roundCount++;
        roundId = roundCount;

        Round storage r = rounds[roundId];
        r.id = roundId;
        r.startedAt = block.timestamp;

        emit RoundStarted(roundId, block.timestamp);
    }

    /// @notice Submit a vote for the current round
    function submitVote(
        uint256 roundId,
        uint256[] calldata allocations,
        uint256 confidence,
        string calldata reasoning
    ) external onlyRegistered nonReentrant {
        require(roundId > 0 && roundId <= roundCount, "AgentConsensus: invalid round");
        Round storage r = rounds[roundId];
        require(!r.resolved, "AgentConsensus: round resolved");
        require(allocations.length == assetCount, "AgentConsensus: wrong asset count");
        require(confidence <= 100, "AgentConsensus: confidence > 100");

        // Validate allocations sum to 10000
        uint256 total;
        for (uint256 i = 0; i < allocations.length; i++) {
            require(allocations[i] <= 6000, "AgentConsensus: exceeds 60% cap");
            total += allocations[i];
        }
        require(total == 10000, "AgentConsensus: must sum to 10000");

        AgentRole role = agentRoles[msg.sender];
        require(!r.hasVoted[role], "AgentConsensus: already voted");

        r.votes[role] = Vote({
            voter: msg.sender,
            role: role,
            allocations: allocations,
            confidence: confidence,
            reasoning: reasoning,
            timestamp: block.timestamp
        });
        r.hasVoted[role] = true;
        r.voteCount++;

        emit VoteSubmitted(roundId, msg.sender, role, confidence);
    }

    /// @notice Resolve a round — compute confidence-weighted average allocation
    function resolveRound(uint256 roundId) external onlyRegistered nonReentrant returns (bool success) {
        require(roundId > 0 && roundId <= roundCount, "AgentConsensus: invalid round");
        Round storage r = rounds[roundId];
        require(!r.resolved, "AgentConsensus: already resolved");

        // Check quorum
        if (r.voteCount < quorumRequired) {
            r.resolved = true;
            r.quorumReached = false;
            emit ConsensusFailed(roundId, "Quorum not reached");
            return false;
        }

        // Confidence-weighted average
        uint256[] memory weightedAlloc = new uint256[](assetCount);
        uint256 totalConfidence;

        for (uint256 role = 0; role < 4; role++) {
            AgentRole ar = AgentRole(role);
            if (!r.hasVoted[ar]) continue;

            Vote storage v = r.votes[ar];
            totalConfidence += v.confidence;
            for (uint256 i = 0; i < assetCount; i++) {
                weightedAlloc[i] += v.allocations[i] * v.confidence;
            }
        }

        // Check confidence threshold
        uint256 avgConfidence = totalConfidence / r.voteCount;
        if (avgConfidence < confidenceThreshold) {
            r.resolved = true;
            r.quorumReached = false;
            r.combinedConfidence = avgConfidence;
            emit ConsensusFailed(roundId, "Confidence below threshold");
            return false;
        }

        // Normalize allocations
        uint256[] memory finalAlloc = new uint256[](assetCount);
        uint256 sum;
        for (uint256 i = 0; i < assetCount; i++) {
            finalAlloc[i] = weightedAlloc[i] / totalConfidence;
            sum += finalAlloc[i];
        }

        // Fix rounding to ensure sum = 10000
        if (sum != 10000 && assetCount > 0) {
            int256 diff = int256(10000) - int256(sum);
            // Add/subtract difference from largest allocation
            uint256 maxIdx;
            uint256 maxVal;
            for (uint256 i = 0; i < assetCount; i++) {
                if (finalAlloc[i] > maxVal) {
                    maxVal = finalAlloc[i];
                    maxIdx = i;
                }
            }
            finalAlloc[maxIdx] = uint256(int256(finalAlloc[maxIdx]) + diff);
        }

        r.resolved = true;
        r.resolvedAt = block.timestamp;
        r.finalAllocations = finalAlloc;
        r.combinedConfidence = avgConfidence;
        r.quorumReached = true;

        emit ConsensusReached(roundId, finalAlloc, avgConfidence, block.timestamp);
        return true;
    }

    // --- View functions ---

    function getRoundResult(uint256 roundId)
        external view
        returns (
            bool resolved,
            bool quorumReached,
            uint256[] memory finalAllocations,
            uint256 combinedConfidence,
            uint256 voteCount,
            uint256 startedAt,
            uint256 resolvedAt
        )
    {
        Round storage r = rounds[roundId];
        return (
            r.resolved,
            r.quorumReached,
            r.finalAllocations,
            r.combinedConfidence,
            r.voteCount,
            r.startedAt,
            r.resolvedAt
        );
    }

    function getVote(uint256 roundId, AgentRole role)
        external view
        returns (
            address voter,
            uint256[] memory allocations,
            uint256 confidence,
            string memory reasoning,
            uint256 timestamp
        )
    {
        Vote storage v = rounds[roundId].votes[role];
        return (v.voter, v.allocations, v.confidence, v.reasoning, v.timestamp);
    }

    function hasVoted(uint256 roundId, AgentRole role) external view returns (bool) {
        return rounds[roundId].hasVoted[role];
    }
}
