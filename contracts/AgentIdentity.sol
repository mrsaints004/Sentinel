// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/**
 * @title AgentIdentity — ERC-8004 Compliant Agent Identity with Reputation
 * @notice On-chain identity for autonomous AI agents implementing the ERC-8004
 *         Trustless Agent standard (Identity Registry + Reputation Registry).
 *
 *         ERC-8004 defines three registries:
 *         1. Identity Registry (ERC-721 + URI + metadata + agent wallet)
 *         2. Reputation Registry (client feedback with value/tags)
 *         3. Validation Registry (validator request/response)
 *
 *         This contract implements all three registries in a single contract
 *         optimized for the Sentinel AI Treasury use case on Mantle.
 *
 *         REPUTATION METRICS (computed on-chain from feedback + decision data):
 *         - winRate: % of decisions where portfolio value increased
 *         - avgConfidence: running average confidence score
 *         - maxDrawdownBps: worst single-decision loss in basis points
 *         - streakLength: current winning/losing streak
 *         - accuracyScore: compound reputation metric (0-1000)
 */
contract AgentIdentity is ERC721, Ownable {
    using Strings for uint256;
    using Strings for int256;

    // ==================== ERC-8004 Identity Registry ====================

    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

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

    uint256 public nextTokenId;
    mapping(uint256 => AgentMetadata) public agentData;
    mapping(uint256 => string) private _agentURIs;
    mapping(uint256 => mapping(bytes32 => bytes)) private _metadata;
    mapping(uint256 => address) private _agentWallets;
    mapping(address => uint256) public agentToToken;

    address public authorizedUpdater;

    // ERC-8004 Identity Events
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue);
    event AgentWalletSet(uint256 indexed agentId, address indexed newWallet);
    event AgentWalletUnset(uint256 indexed agentId);

    // Legacy events (kept for compatibility)
    event AgentRegistered(uint256 indexed tokenId, address indexed agent, string name);
    event MetadataUpdated(uint256 indexed tokenId, uint256 totalDecisions, int256 roiBps);
    event UpdaterChanged(address indexed oldUpdater, address indexed newUpdater);

    // ==================== ERC-8004 Reputation Registry ====================

    struct Feedback {
        int128 value;           // Score: -100 to +100 (win/loss magnitude)
        uint8 valueDecimals;    // Decimal precision (0-18)
        string tag1;            // Primary category (e.g., "trading", "rebalance")
        string tag2;            // Secondary tag (e.g., "mETH", "USDY")
        string endpoint;        // Service endpoint that was used
        string feedbackURI;     // Off-chain detailed feedback URI
        bytes32 feedbackHash;   // Hash of off-chain data for integrity
        bool isRevoked;
        uint256 timestamp;
    }

    struct FeedbackResponse {
        address responder;
        string responseURI;
        bytes32 responseHash;
        uint256 timestamp;
    }

    // agentId => client => feedbackIndex => Feedback
    mapping(uint256 => mapping(address => Feedback[])) private _feedbacks;
    // agentId => client => feedbackIndex => responses
    mapping(uint256 => mapping(address => mapping(uint64 => FeedbackResponse[]))) private _responses;
    // agentId => list of client addresses that gave feedback
    mapping(uint256 => address[]) private _clients;
    mapping(uint256 => mapping(address => bool)) private _isClient;

    // ERC-8004 Reputation Events
    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );
    event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex);
    event ResponseAppended(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        address indexed responder,
        string responseURI,
        bytes32 responseHash
    );

    // ==================== ERC-8004 Validation Registry ====================

    struct ValidationEntry {
        address validatorAddress;
        uint256 agentId;
        uint8 response;         // 0-100 (0=fail, 100=pass)
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool hasResponse;
    }

    mapping(bytes32 => ValidationEntry) private _validations;
    mapping(uint256 => bytes32[]) private _agentValidations;
    mapping(address => bytes32[]) private _validatorRequests;

    // ERC-8004 Validation Events
    event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash);
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    // ==================== Sentinel Reputation (backwards compatible) ====================

    struct ReputationData {
        uint256 wins;
        uint256 losses;
        uint256 totalConfidence;
        uint256 confidenceCount;
        uint256 maxDrawdownBps;
        int256 streakLength;
        uint256 lastPortfolioValue;
        uint256 computedAt;
    }

    mapping(uint256 => ReputationData) public reputationData;

    event ReputationUpdated(
        uint256 indexed tokenId,
        uint256 winRate,
        uint256 avgConfidence,
        uint256 maxDrawdownBps,
        int256 streakLength,
        uint256 accuracyScore
    );

    // ==================== Modifiers ====================

    modifier onlyUpdater() {
        require(
            msg.sender == authorizedUpdater || msg.sender == owner(),
            "AgentIdentity: not authorized"
        );
        _;
    }

    modifier onlyTokenOwnerOrUpdater(uint256 tokenId) {
        require(
            msg.sender == ownerOf(tokenId) || msg.sender == authorizedUpdater || msg.sender == owner(),
            "AgentIdentity: not authorized"
        );
        _;
    }

    // ==================== Constructor ====================

    constructor() ERC721("Sentinel Agent Identity", "SENTINEL-ID") Ownable(msg.sender) {
        nextTokenId = 1;
    }

    // ==================== ERC-8004 Identity Registry Functions ====================

    function setUpdater(address _updater) external onlyOwner {
        require(_updater != address(0), "AgentIdentity: zero address");
        address old = authorizedUpdater;
        authorizedUpdater = _updater;
        emit UpdaterChanged(old, _updater);
    }

    /**
     * @notice ERC-8004: Register a new agent with URI and metadata
     */
    function register(
        string calldata agentURI,
        MetadataEntry[] calldata metadata
    ) external returns (uint256 agentId) {
        agentId = nextTokenId++;
        _mint(msg.sender, agentId);
        _agentURIs[agentId] = agentURI;

        for (uint256 i = 0; i < metadata.length; i++) {
            bytes32 key = keccak256(bytes(metadata[i].metadataKey));
            _metadata[agentId][key] = metadata[i].metadataValue;
            emit MetadataSet(agentId, metadata[i].metadataKey, metadata[i].metadataKey, metadata[i].metadataValue);
        }

        agentToToken[msg.sender] = agentId;
        emit Registered(agentId, agentURI, msg.sender);
    }

    /**
     * @notice ERC-8004: Register with URI only
     */
    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = nextTokenId++;
        _mint(msg.sender, agentId);
        _agentURIs[agentId] = agentURI;
        agentToToken[msg.sender] = agentId;
        emit Registered(agentId, agentURI, msg.sender);
    }

    /**
     * @notice ERC-8004: Register with no URI (minimal)
     */
    function register() external returns (uint256 agentId) {
        agentId = nextTokenId++;
        _mint(msg.sender, agentId);
        agentToToken[msg.sender] = agentId;
        emit Registered(agentId, "", msg.sender);
    }

    /**
     * @notice Legacy Sentinel registration (owner-only, full metadata)
     */
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
        emit Registered(tokenId, "", agent);
    }

    /**
     * @notice ERC-8004: Update agent URI
     */
    function setAgentURI(uint256 agentId, string calldata newURI) external onlyTokenOwnerOrUpdater(agentId) {
        _agentURIs[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    /**
     * @notice ERC-8004: Get metadata by key
     */
    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory) {
        bytes32 key = keccak256(bytes(metadataKey));
        return _metadata[agentId][key];
    }

    /**
     * @notice ERC-8004: Set metadata key-value
     */
    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external onlyTokenOwnerOrUpdater(agentId) {
        bytes32 key = keccak256(bytes(metadataKey));
        _metadata[agentId][key] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    /**
     * @notice ERC-8004: Set agent wallet (operational wallet that acts on behalf of agent)
     */
    function setAgentWallet(uint256 agentId, address newWallet) external onlyTokenOwnerOrUpdater(agentId) {
        require(newWallet != address(0), "AgentIdentity: zero address");
        _agentWallets[agentId] = newWallet;
        agentToToken[newWallet] = agentId;
        emit AgentWalletSet(agentId, newWallet);
    }

    /**
     * @notice ERC-8004: Get agent wallet
     */
    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _agentWallets[agentId];
    }

    /**
     * @notice ERC-8004: Unset agent wallet
     */
    function unsetAgentWallet(uint256 agentId) external onlyTokenOwnerOrUpdater(agentId) {
        address oldWallet = _agentWallets[agentId];
        if (oldWallet != address(0)) {
            agentToToken[oldWallet] = 0;
        }
        _agentWallets[agentId] = address(0);
        emit AgentWalletUnset(agentId);
    }

    // ==================== ERC-8004 Reputation Registry Functions ====================

    /**
     * @notice ERC-8004: Submit feedback for an agent
     */
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        require(agentId > 0 && agentId < nextTokenId, "AgentIdentity: invalid agent");
        require(valueDecimals <= 18, "AgentIdentity: decimals > 18");

        Feedback[] storage clientFeedbacks = _feedbacks[agentId][msg.sender];
        uint64 feedbackIndex = uint64(clientFeedbacks.length);

        clientFeedbacks.push(Feedback({
            value: value,
            valueDecimals: valueDecimals,
            tag1: tag1,
            tag2: tag2,
            endpoint: endpoint,
            feedbackURI: feedbackURI,
            feedbackHash: feedbackHash,
            isRevoked: false,
            timestamp: block.timestamp
        }));

        // Track client
        if (!_isClient[agentId][msg.sender]) {
            _clients[agentId].push(msg.sender);
            _isClient[agentId][msg.sender] = true;
        }

        emit NewFeedback(agentId, msg.sender, feedbackIndex, value, valueDecimals, tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    /**
     * @notice ERC-8004: Revoke previously submitted feedback
     */
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        Feedback[] storage clientFeedbacks = _feedbacks[agentId][msg.sender];
        require(feedbackIndex < clientFeedbacks.length, "AgentIdentity: invalid index");
        require(!clientFeedbacks[feedbackIndex].isRevoked, "AgentIdentity: already revoked");

        clientFeedbacks[feedbackIndex].isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    /**
     * @notice ERC-8004: Append a response to feedback
     */
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseURI,
        bytes32 responseHash
    ) external {
        require(feedbackIndex < _feedbacks[agentId][clientAddress].length, "AgentIdentity: invalid index");

        _responses[agentId][clientAddress][feedbackIndex].push(FeedbackResponse({
            responder: msg.sender,
            responseURI: responseURI,
            responseHash: responseHash,
            timestamp: block.timestamp
        }));

        emit ResponseAppended(agentId, clientAddress, feedbackIndex, msg.sender, responseURI, responseHash);
    }

    /**
     * @notice ERC-8004: Read a specific feedback entry
     */
    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external view returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked)
    {
        Feedback storage f = _feedbacks[agentId][clientAddress][feedbackIndex];
        return (f.value, f.valueDecimals, f.tag1, f.tag2, f.isRevoked);
    }

    /**
     * @notice ERC-8004: Get summary of all feedback for an agent
     */
    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2)
        external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        int256 total = 0;
        uint64 matched = 0;
        bytes32 t1Hash = keccak256(bytes(tag1));
        bytes32 t2Hash = keccak256(bytes(tag2));
        bool filterTag1 = bytes(tag1).length > 0;
        bool filterTag2 = bytes(tag2).length > 0;

        for (uint256 c = 0; c < clientAddresses.length; c++) {
            Feedback[] storage fbs = _feedbacks[agentId][clientAddresses[c]];
            for (uint256 i = 0; i < fbs.length; i++) {
                if (fbs[i].isRevoked) continue;
                if (filterTag1 && keccak256(bytes(fbs[i].tag1)) != t1Hash) continue;
                if (filterTag2 && keccak256(bytes(fbs[i].tag2)) != t2Hash) continue;
                total += int256(fbs[i].value);
                matched++;
            }
        }

        return (matched, matched > 0 ? int128(int256(total / int256(uint256(matched)))) : int128(0), 0);
    }

    /**
     * @notice ERC-8004: Get all clients who gave feedback
     */
    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    /**
     * @notice ERC-8004: Get last feedback index for a client
     */
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64) {
        uint256 len = _feedbacks[agentId][clientAddress].length;
        return len > 0 ? uint64(len - 1) : 0;
    }

    // ==================== ERC-8004 Validation Registry Functions ====================

    /**
     * @notice ERC-8004: Request validation for an agent
     */
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external {
        require(agentId > 0 && agentId < nextTokenId, "AgentIdentity: invalid agent");
        require(_validations[requestHash].agentId == 0, "AgentIdentity: duplicate request");

        _validations[requestHash] = ValidationEntry({
            validatorAddress: validatorAddress,
            agentId: agentId,
            response: 0,
            responseHash: bytes32(0),
            tag: "",
            lastUpdate: block.timestamp,
            hasResponse: false
        });

        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);

        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    /**
     * @notice ERC-8004: Submit validation response
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external {
        ValidationEntry storage v = _validations[requestHash];
        require(v.agentId > 0, "AgentIdentity: no such request");
        require(msg.sender == v.validatorAddress, "AgentIdentity: not validator");
        require(response <= 100, "AgentIdentity: response > 100");

        v.response = response;
        v.responseHash = responseHash;
        v.tag = tag;
        v.lastUpdate = block.timestamp;
        v.hasResponse = true;

        emit ValidationResponse(msg.sender, v.agentId, requestHash, response, responseURI, responseHash, tag);
    }

    /**
     * @notice ERC-8004: Get validation status
     */
    function getValidationStatus(bytes32 requestHash)
        external view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string memory tag, uint256 lastUpdate)
    {
        ValidationEntry storage v = _validations[requestHash];
        return (v.validatorAddress, v.agentId, v.response, v.responseHash, v.tag, v.lastUpdate);
    }

    /**
     * @notice ERC-8004: Get all validation request hashes for an agent
     */
    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    /**
     * @notice ERC-8004: Get all validation requests for a validator
     */
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }

    // ==================== Sentinel-Specific Functions (backwards compatible) ====================

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

        rep.totalConfidence += confidence;
        rep.confidenceCount++;

        if (rep.lastPortfolioValue > 0) {
            if (portfolioValueUSD >= rep.lastPortfolioValue) {
                rep.wins++;
                if (rep.streakLength >= 0) {
                    rep.streakLength++;
                } else {
                    rep.streakLength = 1;
                }
            } else {
                rep.losses++;
                if (rep.streakLength <= 0) {
                    rep.streakLength--;
                } else {
                    rep.streakLength = -1;
                }
                uint256 drawdownBps = ((rep.lastPortfolioValue - portfolioValueUSD) * 10000) / rep.lastPortfolioValue;
                if (drawdownBps > rep.maxDrawdownBps) {
                    rep.maxDrawdownBps = drawdownBps;
                }
            }

            // Auto-submit ERC-8004 feedback from the contract itself
            int128 feedbackValue = portfolioValueUSD >= rep.lastPortfolioValue ? int128(1) : int128(-1);
            Feedback[] storage selfFeedbacks = _feedbacks[tokenId][address(this)];
            uint64 fbIndex = uint64(selfFeedbacks.length);
            selfFeedbacks.push(Feedback({
                value: feedbackValue,
                valueDecimals: 0,
                tag1: "decision",
                tag2: portfolioValueUSD >= rep.lastPortfolioValue ? "win" : "loss",
                endpoint: "",
                feedbackURI: "",
                feedbackHash: bytes32(0),
                isRevoked: false,
                timestamp: block.timestamp
            }));
            if (!_isClient[tokenId][address(this)]) {
                _clients[tokenId].push(address(this));
                _isClient[tokenId][address(this)] = true;
            }
            emit NewFeedback(tokenId, address(this), fbIndex, feedbackValue, 0, "decision", "decision",
                portfolioValueUSD >= rep.lastPortfolioValue ? "win" : "loss", "", "", bytes32(0));
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
    function getAccuracyScore(uint256 tokenId) public view returns (uint256) {
        ReputationData storage rep = reputationData[tokenId];
        uint256 total = rep.wins + rep.losses;
        if (total == 0) return 500;

        uint256 winComponent = (getWinRate(tokenId) * 400) / 10000;
        uint256 confComponent = (getAvgConfidence(tokenId) * 300) / 100;

        uint256 streakComponent;
        if (rep.streakLength > 0) {
            uint256 absStreak = uint256(rep.streakLength);
            streakComponent = absStreak > 10 ? 200 : (absStreak * 20);
        } else {
            streakComponent = 0;
        }

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

    // ==================== Token URI (ERC-8004 + NFT metadata) ====================

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        AgentMetadata storage meta = agentData[tokenId];

        // If ERC-8004 agentURI is set, return it
        if (bytes(_agentURIs[tokenId]).length > 0) {
            return _agentURIs[tokenId];
        }

        // Otherwise generate on-chain JSON (backwards compatible)
        string memory roiStr;
        if (meta.cumulativeROIBps >= 0) {
            roiStr = string(abi.encodePacked("+", uint256(meta.cumulativeROIBps).toString()));
        } else if (meta.cumulativeROIBps == type(int256).min) {
            roiStr = "-overflow";
        } else {
            roiStr = string(abi.encodePacked("-", uint256(-meta.cumulativeROIBps).toString()));
        }

        uint256 winRate = getWinRate(tokenId);
        uint256 accuracy = getAccuracyScore(tokenId);

        string memory json = string(
            abi.encodePacked(
                '{"name":"', meta.agentName,
                '","description":"Sentinel AI Agent Identity on Mantle - ERC-8004 Trustless Agent with on-chain reputation",',
                '"attributes":[',
                '{"trait_type":"Strategy","value":"', meta.strategyType, '"},',
                '{"trait_type":"Total Decisions","value":', meta.totalDecisions.toString(), '},',
                '{"trait_type":"ROI (bps)","value":"', roiStr, '"},',
                '{"trait_type":"Win Rate (bps)","value":', winRate.toString(), '},',
                '{"trait_type":"Accuracy Score","value":', accuracy.toString(), '},',
                '{"trait_type":"Created","value":', meta.createdAt.toString(), '},',
                '{"trait_type":"Standard","value":"ERC-8004"}',
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

    // ==================== Read Functions ====================

    function getAgentMetadata(uint256 tokenId) external view returns (AgentMetadata memory) {
        return agentData[tokenId];
    }

    function getReputationData(uint256 tokenId) external view returns (ReputationData memory) {
        return reputationData[tokenId];
    }

    function isRegistered(address agent) external view returns (bool) {
        return agentToToken[agent] != 0;
    }

    function totalAgents() external view returns (uint256) {
        return nextTokenId - 1;
    }

    /**
     * @notice ERC-8004: Returns the identity registry address (self, since combined)
     */
    function getIdentityRegistry() external view returns (address) {
        return address(this);
    }
}
