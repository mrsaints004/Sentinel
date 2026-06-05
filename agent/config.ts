import * as dotenv from "dotenv";
dotenv.config();

export const config = {
  // RPC - Mantle Mainnet
  mantleRpc: process.env.MANTLE_MAINNET_RPC || "https://rpc.mantle.xyz",
  privateKey: process.env.PRIVATE_KEY || "",
  chainId: 5000,

  // Contracts (deployed on Mantle Mainnet)
  factoryAddress: process.env.FACTORY_ADDRESS || "",
  vaultAddress: process.env.VAULT_ADDRESS || "",
  loggerAddress: process.env.LOGGER_ADDRESS || "",
  identityAddress: process.env.IDENTITY_ADDRESS || "",
  consensusAddress: process.env.CONSENSUS_ADDRESS || "",
  swapRouterAddress: process.env.SWAP_ROUTER_ADDRESS || "",

  // Merchant Moe DEX
  merchantMoeRouter: process.env.MERCHANT_MOE_LB_ROUTER || "0x013e138EF6008ae5FDFDE29700e3f2Bc61d21E3a",
  merchantMoeFactory: process.env.MERCHANT_MOE_LB_FACTORY || "0xa6630671775c4EA2743840F9A5016dCf2A104054",

  // Gemini AI (via OpenAI-compatible endpoint)
  openaiApiKey: process.env.OPENAI_API_KEY || "",

  // Agent settings
  intervalMs: parseInt(process.env.AGENT_INTERVAL_MS || "300000"), // 5 minutes
  rebalanceThresholdBps: parseInt(process.env.REBALANCE_THRESHOLD || "500"), // 5%

  // Real token addresses on Mantle Mainnet
  assets: {
    USDY: process.env.USDY_ADDRESS || "0x5bE26527e817998A7206475496fDE1E68957c5A6",
    mETH: process.env.METH_ADDRESS || "0xcDA86A272531e8640cD7F1a92c01839911B90bB0",
    USDC: process.env.USDC_ADDRESS || "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
  },

  // Token decimals (real mainnet tokens)
  decimals: {
    USDY: 18,
    mETH: 18,
    USDC: 6, // USDC uses 6 decimals on Mantle
  },

  // Risk thresholds
  risk: {
    maxSingleAssetBps: 6000, // max 60% in one asset
    minStableBps: 2000, // keep min 20% in stables
    depegThresholdBps: 200, // 2% depeg triggers alert
    minLiquidityUSD: 100000,
  },
};
