// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract DecisionLogger is Ownable, ReentrancyGuard {
    struct Decision {
        uint256 id;
        address agent;
        string reasoning;
        string action;
        uint256[] oldAllocations;
        uint256[] newAllocations;
        string[] assetNames;
        uint256 timestamp;
        uint256 portfolioValueUSD;
        string riskLevel;
        bytes32 commitHash;
        bool verified;
    }

    struct Commit {
        bytes32 hash;
        address agent;
        uint256 timestamp;
        bool revealed;
    }

    uint256 public decisionCount;
    uint256 public commitCount;
    address public authorizedAgent;
    address public agentIdentityContract;

    mapping(uint256 => Decision) public decisions;
    mapping(uint256 => Commit) public commits;

    event DecisionLogged(
        uint256 indexed id,
        address indexed agent,
        string action,
        string reasoning,
        uint256 timestamp
    );
    event DecisionCommitted(
        uint256 indexed commitId,
        address indexed agent,
        bytes32 hash,
        uint256 timestamp
    );
    event DecisionRevealed(
        uint256 indexed decisionId,
        uint256 indexed commitId,
        bool verified
    );
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event IdentityContractUpdated(address indexed oldIdentity, address indexed newIdentity);

    modifier onlyAgent() {
        require(
            msg.sender == authorizedAgent || msg.sender == owner(),
            "DecisionLogger: not authorized"
        );
        _;
    }

    constructor(address _agent) Ownable(msg.sender) {
        require(_agent != address(0), "DecisionLogger: zero address");
        authorizedAgent = _agent;
    }

    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "DecisionLogger: zero address");
        address old = authorizedAgent;
        authorizedAgent = _agent;
        emit AgentUpdated(old, _agent);
    }

    function setAgentIdentityContract(address _identity) external onlyOwner {
        require(_identity != address(0), "DecisionLogger: zero address");
        address old = agentIdentityContract;
        agentIdentityContract = _identity;
        emit IdentityContractUpdated(old, _identity);
    }

    /// @notice Phase 1: Commit a hash of the decision BEFORE executing the trade
    function commitDecision(bytes32 hash) external onlyAgent returns (uint256 commitId) {
        require(hash != bytes32(0), "DecisionLogger: empty hash");
        commitCount++;
        commitId = commitCount;

        commits[commitId] = Commit({
            hash: hash,
            agent: msg.sender,
            timestamp: block.timestamp,
            revealed: false
        });

        emit DecisionCommitted(commitId, msg.sender, hash, block.timestamp);
    }

    /// @notice Phase 3: Log decision with reveal — verifies against prior commit
    function logDecision(
        string calldata reasoning,
        string calldata action,
        uint256[] calldata oldAllocations,
        uint256[] calldata newAllocations,
        string[] calldata assetNames,
        uint256 portfolioValueUSD,
        string calldata riskLevel,
        uint256 commitId,
        bytes32 nonce
    ) external onlyAgent nonReentrant {
        require(oldAllocations.length == newAllocations.length, "Allocation length mismatch");
        require(oldAllocations.length == assetNames.length, "Asset names length mismatch");

        decisionCount++;
        uint256 id = decisionCount;

        // Verify commit-reveal if commitId provided
        bool verified = false;
        bytes32 commitHash = bytes32(0);

        if (commitId > 0 && commitId <= commitCount) {
            Commit storage c = commits[commitId];
            require(!c.revealed, "DecisionLogger: already revealed");

            // Reconstruct hash from revealed data
            bytes32 revealHash = keccak256(
                abi.encode(reasoning, action, newAllocations, portfolioValueUSD, nonce)
            );

            verified = (revealHash == c.hash);
            commitHash = c.hash;
            c.revealed = true;

            emit DecisionRevealed(id, commitId, verified);
        }

        Decision storage d = decisions[id];
        d.id = id;
        d.agent = msg.sender;
        d.reasoning = reasoning;
        d.action = action;
        d.oldAllocations = oldAllocations;
        d.newAllocations = newAllocations;
        d.assetNames = assetNames;
        d.timestamp = block.timestamp;
        d.portfolioValueUSD = portfolioValueUSD;
        d.riskLevel = riskLevel;
        d.commitHash = commitHash;
        d.verified = verified;

        emit DecisionLogged(id, msg.sender, action, reasoning, block.timestamp);
    }

    /// @notice Legacy logDecision without commit-reveal (backwards compatible)
    function logDecision(
        string calldata reasoning,
        string calldata action,
        uint256[] calldata oldAllocations,
        uint256[] calldata newAllocations,
        string[] calldata assetNames,
        uint256 portfolioValueUSD,
        string calldata riskLevel
    ) external onlyAgent nonReentrant {
        require(oldAllocations.length == newAllocations.length, "Allocation length mismatch");
        require(oldAllocations.length == assetNames.length, "Asset names length mismatch");

        decisionCount++;
        uint256 id = decisionCount;

        Decision storage d = decisions[id];
        d.id = id;
        d.agent = msg.sender;
        d.reasoning = reasoning;
        d.action = action;
        d.oldAllocations = oldAllocations;
        d.newAllocations = newAllocations;
        d.assetNames = assetNames;
        d.timestamp = block.timestamp;
        d.portfolioValueUSD = portfolioValueUSD;
        d.riskLevel = riskLevel;
        d.commitHash = bytes32(0);
        d.verified = false;

        emit DecisionLogged(id, msg.sender, action, reasoning, block.timestamp);
    }

    function getDecision(uint256 id)
        external view
        returns (
            address agent,
            string memory reasoning,
            string memory action,
            uint256[] memory oldAllocations,
            uint256[] memory newAllocations,
            string[] memory assetNames,
            uint256 timestamp,
            uint256 portfolioValueUSD,
            string memory riskLevel
        )
    {
        Decision storage d = decisions[id];
        return (
            d.agent, d.reasoning, d.action,
            d.oldAllocations, d.newAllocations, d.assetNames,
            d.timestamp, d.portfolioValueUSD, d.riskLevel
        );
    }

    function getDecisionVerification(uint256 id)
        external view
        returns (bytes32 commitHash, bool verified)
    {
        Decision storage d = decisions[id];
        return (d.commitHash, d.verified);
    }

    function getCommit(uint256 commitId)
        external view
        returns (bytes32 hash, address agent, uint256 timestamp, bool revealed)
    {
        Commit storage c = commits[commitId];
        return (c.hash, c.agent, c.timestamp, c.revealed);
    }

    function getRecentDecisions(uint256 count)
        external view
        returns (Decision[] memory)
    {
        uint256 start = decisionCount > count ? decisionCount - count + 1 : 1;
        uint256 len = decisionCount >= count ? count : decisionCount;

        Decision[] memory result = new Decision[](len);
        for (uint256 i = 0; i < len; i++) {
            result[i] = decisions[start + i];
        }
        return result;
    }
}
