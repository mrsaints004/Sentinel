// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";

contract DecisionLogger is Ownable {
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
    }

    uint256 public decisionCount;
    address public authorizedAgent;
    address public agentIdentityContract;

    mapping(uint256 => Decision) public decisions;

    event DecisionLogged(
        uint256 indexed id,
        address indexed agent,
        string action,
        string reasoning,
        uint256 timestamp
    );

    modifier onlyAgent() {
        require(
            msg.sender == authorizedAgent || msg.sender == owner(),
            "DecisionLogger: not authorized"
        );
        _;
    }

    constructor(address _agent) Ownable(msg.sender) {
        authorizedAgent = _agent;
    }

    function setAgent(address _agent) external onlyOwner {
        authorizedAgent = _agent;
    }

    function setAgentIdentityContract(address _identity) external onlyOwner {
        agentIdentityContract = _identity;
    }

    function logDecision(
        string calldata reasoning,
        string calldata action,
        uint256[] calldata oldAllocations,
        uint256[] calldata newAllocations,
        string[] calldata assetNames,
        uint256 portfolioValueUSD,
        string calldata riskLevel
    ) external onlyAgent {
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

        emit DecisionLogged(id, msg.sender, action, reasoning, block.timestamp);
    }

    function getDecision(uint256 id)
        external
        view
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
            d.agent,
            d.reasoning,
            d.action,
            d.oldAllocations,
            d.newAllocations,
            d.assetNames,
            d.timestamp,
            d.portfolioValueUSD,
            d.riskLevel
        );
    }

    function getRecentDecisions(uint256 count)
        external
        view
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
