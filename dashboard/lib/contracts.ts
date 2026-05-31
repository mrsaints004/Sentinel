export const VAULT_ABI = [
  {
    inputs: [],
    name: "getPortfolio",
    outputs: [
      { name: "assets", type: "address[]" },
      { name: "names", type: "string[]" },
      { name: "balances", type: "uint256[]" },
      { name: "allocations", type: "uint256[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "rebalanceCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "lastRebalanceTimestamp",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const LOGGER_ABI = [
  {
    inputs: [{ name: "count", type: "uint256" }],
    name: "getRecentDecisions",
    outputs: [
      {
        components: [
          { name: "id", type: "uint256" },
          { name: "agent", type: "address" },
          { name: "reasoning", type: "string" },
          { name: "action", type: "string" },
          { name: "oldAllocations", type: "uint256[]" },
          { name: "newAllocations", type: "uint256[]" },
          { name: "assetNames", type: "string[]" },
          { name: "timestamp", type: "uint256" },
          { name: "portfolioValueUSD", type: "uint256" },
          { name: "riskLevel", type: "string" },
        ],
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decisionCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const IDENTITY_ABI = [
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "getAgentMetadata",
    outputs: [
      {
        components: [
          { name: "agentName", type: "string" },
          { name: "strategyType", type: "string" },
          { name: "totalDecisions", type: "uint256" },
          { name: "cumulativeROIBps", type: "int256" },
          { name: "createdAt", type: "uint256" },
          { name: "lastActiveAt", type: "uint256" },
          { name: "vaultAddress", type: "address" },
          { name: "loggerAddress", type: "address" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;
