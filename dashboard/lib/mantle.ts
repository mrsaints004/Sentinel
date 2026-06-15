export const MANTLE = {
  id: 5000,
  name: "Mantle",
  rpcUrl: "https://rpc.mantle.xyz",
  blockExplorer: "https://mantlescan.xyz",
  nativeCurrency: {
    name: "MNT",
    symbol: "MNT",
    decimals: 18,
  },
};

export const CONTRACT_ADDRESSES = {
  vault: process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xFc4EDCF2CA8068b2A750Ad4507297aba0807CdC5",
  logger: process.env.NEXT_PUBLIC_LOGGER_ADDRESS || "0x962A00d762692F8692B90914577d5191e79a514b",
  identity: process.env.NEXT_PUBLIC_IDENTITY_ADDRESS || "0x7292c3Bef25159Fb4119A8CF48AAa027596C7fFD",
};

export const TOKEN_ADDRESSES = {
  USDY: process.env.NEXT_PUBLIC_USDY_ADDRESS || "0x5bE26527e817998A7206475496fDE1E68957c5A6",
  mETH: process.env.NEXT_PUBLIC_METH_ADDRESS || "0xcDA86A272531e8640cD7F1a92c01839911B90bb0",
  USDC: process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
};
