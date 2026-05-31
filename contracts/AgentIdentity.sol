// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

contract AgentIdentity is ERC721, Ownable {
    using Strings for uint256;

    struct AgentMetadata {
        string agentName;
        string strategyType;
        uint256 totalDecisions;
        int256 cumulativeROIBps; // basis points, can be negative
        uint256 createdAt;
        uint256 lastActiveAt;
        address vaultAddress;
        address loggerAddress;
    }

    uint256 public nextTokenId;
    mapping(uint256 => AgentMetadata) public agentData;
    mapping(address => uint256) public agentToToken; // agent address => tokenId

    address public authorizedUpdater;

    event AgentRegistered(uint256 indexed tokenId, address indexed agent, string name);
    event MetadataUpdated(uint256 indexed tokenId, uint256 totalDecisions, int256 roiBps);

    modifier onlyUpdater() {
        require(
            msg.sender == authorizedUpdater || msg.sender == owner(),
            "AgentIdentity: not authorized"
        );
        _;
    }

    constructor() ERC721("Sentinel Agent Identity", "SENTINEL") Ownable(msg.sender) {
        nextTokenId = 1;
    }

    function setUpdater(address _updater) external onlyOwner {
        authorizedUpdater = _updater;
    }

    function registerAgent(
        address agent,
        string calldata agentName,
        string calldata strategyType,
        address vaultAddress,
        address loggerAddress
    ) external onlyOwner returns (uint256 tokenId) {
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
        AgentMetadata storage meta = agentData[tokenId];
        meta.totalDecisions = totalDecisions;
        meta.cumulativeROIBps = cumulativeROIBps;
        meta.lastActiveAt = block.timestamp;

        emit MetadataUpdated(tokenId, totalDecisions, cumulativeROIBps);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        AgentMetadata storage meta = agentData[tokenId];

        string memory roiStr = meta.cumulativeROIBps >= 0
            ? string(abi.encodePacked("+", uint256(meta.cumulativeROIBps).toString()))
            : string(abi.encodePacked("-", uint256(-meta.cumulativeROIBps).toString()));

        string memory json = string(
            abi.encodePacked(
                '{"name":"', meta.agentName,
                '","description":"Sentinel Autonomous RWA Agent on Mantle",',
                '"attributes":[',
                '{"trait_type":"Strategy","value":"', meta.strategyType, '"},',
                '{"trait_type":"Total Decisions","value":', meta.totalDecisions.toString(), '},',
                '{"trait_type":"ROI (bps)","value":"', roiStr, '"},',
                '{"trait_type":"Created","value":', meta.createdAt.toString(), '}',
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
        external
        view
        returns (AgentMetadata memory)
    {
        return agentData[tokenId];
    }
}
