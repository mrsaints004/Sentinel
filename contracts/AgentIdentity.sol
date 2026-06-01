// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/**
 * @title AgentIdentity — Agent Identity NFT with Verifiable Reputation
 * @notice On-chain identity for autonomous AI agents built on ERC-721.
 *         Each agent gets a unique NFT that tracks its performance, decisions,
 *         and reputation immutably via on-chain JSON tokenURI.
 *
 *         REPUTATION METRICS (computed on-chain from DecisionLogger data):
 *         - winRate: % of decisions where portfolio value increased
 *         - avgConfidence: running average confidence score
 *         - maxDrawdownBps: worst single-decision loss in basis points
 *         - streakLength: current winning/losing streak (positive = winning)
 *         - accuracyScore: compound reputation metric (0-1000)
 */
contract AgentIdentity is ERC721, Ownable {
    using Strings for uint256;
    using Strings for int256;

    struct AgentMetadata {
        string agentName;
        string strategyType;
        uint256 totalDecisions;
        int256 cumulativeROIBps;
        uint256 createdAt;
        uint256 lastActiveAt;
        address vaultAddress;
        address loggerAddress;
    }

    struct ReputationData {
        uint256 wins;
        uint256 losses;
        uint256 totalConfidence;
        uint256 confidenceCount;
        uint256 maxDrawdownBps;
        int256 streakLength;       // positive = win streak, negative = loss streak
        uint256 lastPortfolioValue;
        uint256 computedAt;
    }

    uint256 public nextTokenId;
    mapping(uint256 => AgentMetadata) public agentData;
    mapping(uint256 => ReputationData) public reputationData;
    mapping(address => uint256) public agentToToken;

    address public authorizedUpdater;

    event AgentRegistered(uint256 indexed tokenId, address indexed agent, string name);
    event MetadataUpdated(uint256 indexed tokenId, uint256 totalDecisions, int256 roiBps);
    event ReputationUpdated(
        uint256 indexed tokenId,
        uint256 winRate,
        uint256 avgConfidence,
        uint256 maxDrawdownBps,
        int256 streakLength,
        uint256 accuracyScore
    );
    event UpdaterChanged(address indexed oldUpdater, address indexed newUpdater);

    modifier onlyUpdater() {
        require(
            msg.sender == authorizedUpdater || msg.sender == owner(),
            "AgentIdentity: not authorized"
        );
        _;
    }

    constructor() ERC721("Sentinel Agent Identity", "SENTINEL-ID") Ownable(msg.sender) {
        nextTokenId = 1;
    }

    function setUpdater(address _updater) external onlyOwner {
        require(_updater != address(0), "AgentIdentity: zero address");
        address old = authorizedUpdater;
        authorizedUpdater = _updater;
        emit UpdaterChanged(old, _updater);
    }

    function registerAgent(
        address agent,
        string calldata agentName,
        string calldata strategyType,
        address vaultAddress,
        address loggerAddress
    ) external onlyOwner returns (uint256 tokenId) {
        require(agent != address(0), "AgentIdentity: zero address");
        require(agentToToken[agent] == 0, "AgentIdentity: already registered");

        tokenId = nextTokenId++;
        _mint(agent, tokenId);

        agentData[tokenId] = AgentMetadata({
            agentName: agentName,
            strategyType: strategyType,
            totalDecisions: 0,
            cumulativeROIBps: 0,
            createdAt: block.timestamp,
            lastActiveAt: block.timestamp,
            vaultAddress: vaultAddress,
            loggerAddress: loggerAddress
        });

        agentToToken[agent] = tokenId;
        emit AgentRegistered(tokenId, agent, agentName);
    }

    function updateMetadata(
        uint256 tokenId,
        uint256 totalDecisions,
        int256 cumulativeROIBps
    ) external onlyUpdater {
        require(tokenId > 0 && tokenId < nextTokenId, "AgentIdentity: invalid token");
        AgentMetadata storage meta = agentData[tokenId];
        meta.totalDecisions = totalDecisions;
        meta.cumulativeROIBps = cumulativeROIBps;
        meta.lastActiveAt = block.timestamp;
        emit MetadataUpdated(tokenId, totalDecisions, cumulativeROIBps);
    }

    /// @notice Record a decision outcome and update reputation metrics on-chain
    function recordDecisionOutcome(
        uint256 tokenId,
        uint256 portfolioValueUSD,
        uint256 confidence
    ) external onlyUpdater {
        require(tokenId > 0 && tokenId < nextTokenId, "AgentIdentity: invalid token");
        require(confidence <= 100, "AgentIdentity: confidence > 100");

        ReputationData storage rep = reputationData[tokenId];

        // Update confidence tracking
        rep.totalConfidence += confidence;
        rep.confidenceCount++;

        // Compare with last portfolio value to determine win/loss
        if (rep.lastPortfolioValue > 0) {
            if (portfolioValueUSD >= rep.lastPortfolioValue) {
                // Win
                rep.wins++;
                if (rep.streakLength >= 0) {
                    rep.streakLength++;
                } else {
                    rep.streakLength = 1;
                }
            } else {
                // Loss
                rep.losses++;
                if (rep.streakLength <= 0) {
                    rep.streakLength--;
                } else {
                    rep.streakLength = -1;
                }

                // Track max drawdown
                uint256 drawdownBps = ((rep.lastPortfolioValue - portfolioValueUSD) * 10000) / rep.lastPortfolioValue;
                if (drawdownBps > rep.maxDrawdownBps) {
                    rep.maxDrawdownBps = drawdownBps;
                }
            }
        }

        rep.lastPortfolioValue = portfolioValueUSD;
        rep.computedAt = block.timestamp;

        emit ReputationUpdated(
            tokenId,
            getWinRate(tokenId),
            getAvgConfidence(tokenId),
            rep.maxDrawdownBps,
            rep.streakLength,
            getAccuracyScore(tokenId)
        );
    }

    /// @notice Compute reputation metrics — fully on-chain, anyone can call
    function computeReputation(uint256 tokenId)
        external view
        returns (
            uint256 winRate,
            uint256 avgConfidence,
            uint256 maxDrawdownBps,
            int256 streakLength,
            uint256 accuracyScore,
            uint256 totalGames,
            uint256 computedAt
        )
    {
        return (
            getWinRate(tokenId),
            getAvgConfidence(tokenId),
            reputationData[tokenId].maxDrawdownBps,
            reputationData[tokenId].streakLength,
            getAccuracyScore(tokenId),
            reputationData[tokenId].wins + reputationData[tokenId].losses,
            reputationData[tokenId].computedAt
        );
    }

    /// @notice Win rate in basis points (0-10000 = 0-100%)
    function getWinRate(uint256 tokenId) public view returns (uint256) {
        ReputationData storage rep = reputationData[tokenId];
        uint256 total = rep.wins + rep.losses;
        if (total == 0) return 0;
        return (rep.wins * 10000) / total;
    }

    /// @notice Average confidence (0-100)
    function getAvgConfidence(uint256 tokenId) public view returns (uint256) {
        ReputationData storage rep = reputationData[tokenId];
        if (rep.confidenceCount == 0) return 0;
        return rep.totalConfidence / rep.confidenceCount;
    }

    /// @notice Compound accuracy score (0-1000)
    /// @dev Formula: (winRate/10000 * 400) + (avgConfidence/100 * 300) + (streakBonus * 200) + (drawdownPenalty * 100)
    function getAccuracyScore(uint256 tokenId) public view returns (uint256) {
        ReputationData storage rep = reputationData[tokenId];
        uint256 total = rep.wins + rep.losses;
        if (total == 0) return 500; // neutral starting score

        // Win rate component (0-400)
        uint256 winComponent = (getWinRate(tokenId) * 400) / 10000;

        // Confidence component (0-300)
        uint256 confComponent = (getAvgConfidence(tokenId) * 300) / 100;

        // Streak bonus (0-200): positive streaks add, negative streaks subtract
        uint256 streakComponent;
        if (rep.streakLength > 0) {
            uint256 absStreak = uint256(rep.streakLength);
            streakComponent = absStreak > 10 ? 200 : (absStreak * 20);
        } else {
            // Negative streak reduces this component
            streakComponent = 0;
        }

        // Drawdown penalty (0-100): lower drawdown = higher score
        uint256 drawdownComponent;
        if (rep.maxDrawdownBps == 0) {
            drawdownComponent = 100;
        } else if (rep.maxDrawdownBps >= 5000) {
            drawdownComponent = 0;
        } else {
            drawdownComponent = ((5000 - rep.maxDrawdownBps) * 100) / 5000;
        }

        return winComponent + confComponent + streakComponent + drawdownComponent;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        AgentMetadata storage meta = agentData[tokenId];

        // Safe ROI string encoding
        string memory roiStr;
        if (meta.cumulativeROIBps >= 0) {
            roiStr = string(abi.encodePacked("+", uint256(meta.cumulativeROIBps).toString()));
        } else if (meta.cumulativeROIBps == type(int256).min) {
            roiStr = "-overflow";
        } else {
            roiStr = string(abi.encodePacked("-", uint256(-meta.cumulativeROIBps).toString()));
        }

        // Reputation data
        uint256 winRate = getWinRate(tokenId);
        uint256 accuracy = getAccuracyScore(tokenId);

        string memory json = string(
            abi.encodePacked(
                '{"name":"', meta.agentName,
                '","description":"Sentinel AI Agent Identity on Mantle - on-chain performance tracking with verifiable reputation",',
                '"attributes":[',
                '{"trait_type":"Strategy","value":"', meta.strategyType, '"},',
                '{"trait_type":"Total Decisions","value":', meta.totalDecisions.toString(), '},',
                '{"trait_type":"ROI (bps)","value":"', roiStr, '"},',
                '{"trait_type":"Win Rate (bps)","value":', winRate.toString(), '},',
                '{"trait_type":"Accuracy Score","value":', accuracy.toString(), '},',
                '{"trait_type":"Created","value":', meta.createdAt.toString(), '},',
                '{"trait_type":"Standard","value":"Agent Identity NFT"}',
                ']}'
            )
        );

        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64.encode(bytes(json))
            )
        );
    }

    function getAgentMetadata(uint256 tokenId)
        external view
        returns (AgentMetadata memory)
    {
        return agentData[tokenId];
    }

    function getReputationData(uint256 tokenId)
        external view
        returns (ReputationData memory)
    {
        return reputationData[tokenId];
    }

    function isRegistered(address agent) external view returns (bool) {
        return agentToToken[agent] != 0;
    }

    function totalAgents() external view returns (uint256) {
        return nextTokenId - 1;
    }
}
