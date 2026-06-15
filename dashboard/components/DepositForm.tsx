"use client";

import { useState } from "react";
import { ethers } from "ethers";

const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "0x4F64da35DA275fC052a01a78603500e592059Cb9";
const FALLBACK_VAULT = process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xFc4EDCF2CA8068b2A750Ad4507297aba0807CdC5";

const TOKENS = [
  { symbol: "USDC", name: "USD Coin", address: process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", decimals: 6 },
  { symbol: "USDY", name: "Ondo USDY", address: process.env.NEXT_PUBLIC_USDY_ADDRESS || "0x5bE26527e817998A7206475496fDE1E68957c5A6", decimals: 18 },
  { symbol: "mETH", name: "Mantle Staked ETH", address: process.env.NEXT_PUBLIC_METH_ADDRESS || "0xcDA86A272531e8640cD7F1a92c01839911B90bb0", decimals: 18 },
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

const VAULT_ABI = [
  "function deposit(address token, uint256 amount) external",
  "function withdraw(address token, uint256 amount) external",
  "function userDeposits(address user, address token) view returns (uint256)",
];

const FACTORY_ABI = [
  "function getVault(address owner) external view returns (address vault, address logger, uint256 createdAt)",
];

interface Props {
  isConnected: boolean;
  onConnect: () => void;
  walletAddress?: string;
}

async function resolveVault(provider: ethers.BrowserProvider, signerAddress: string): Promise<string | null> {
  if (FACTORY_ADDRESS) {
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
      const [vault, , createdAt] = await factory.getVault(signerAddress);
      if (vault !== ethers.ZeroAddress && Number(createdAt) > 0) {
        return vault;
      }
    } catch { /* Factory contract call failed — fall back to FALLBACK_VAULT */ }
  }
  return FALLBACK_VAULT || null;
}

export default function DepositForm({ isConnected, onConnect, walletAddress }: Props) {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [selectedToken, setSelectedToken] = useState(0);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "resolving" | "approving" | "depositing" | "withdrawing" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [successAction, setSuccessAction] = useState<"deposit" | "withdraw">("deposit");

  const deposit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    const eth = (window as any).ethereum;
    if (!eth) return;

    setStatus("resolving");
    setError("");

    try {
      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      const token = TOKENS[selectedToken];

      const vaultAddress = await resolveVault(provider, signerAddress);
      if (!vaultAddress) {
        setError("No vault found. Create a treasury first.");
        setStatus("error");
        return;
      }

      setStatus("approving");
      const tokenContract = new ethers.Contract(token.address, ERC20_ABI, signer);
      const amountWei = ethers.parseUnits(amount, token.decimals);

      const currentAllowance = await tokenContract.allowance(signerAddress, vaultAddress);
      if (currentAllowance < amountWei) {
        const approveTx = await tokenContract.approve(vaultAddress, ethers.MaxUint256);
        await approveTx.wait();
      }

      setStatus("depositing");
      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer);
      const depositTx = await vault.deposit(token.address, amountWei);
      const receipt = await depositTx.wait();

      setTxHash(receipt.hash);
      setSuccessAction("deposit");
      setStatus("success");
      setAmount("");
    } catch (e: any) {
      setError(e.message?.slice(0, 100) || "Transaction failed");
      setStatus("error");
    }
  };

  const withdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    const eth = (window as any).ethereum;
    if (!eth) return;

    setStatus("resolving");
    setError("");

    try {
      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      const token = TOKENS[selectedToken];

      const vaultAddress = await resolveVault(provider, signerAddress);
      if (!vaultAddress) {
        setError("No vault found.");
        setStatus("error");
        return;
      }

      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer);
      const amountWei = ethers.parseUnits(amount, token.decimals);

      // Check user's deposited balance
      const deposited = await vault.userDeposits(signerAddress, token.address);
      if (deposited < amountWei) {
        const depositedFloat = parseFloat(ethers.formatUnits(deposited, token.decimals));
        setError(`Insufficient vault balance. You have ${depositedFloat.toFixed(token.decimals === 6 ? 2 : 6)} ${token.symbol} deposited.`);
        setStatus("error");
        return;
      }

      setStatus("withdrawing");
      const withdrawTx = await vault.withdraw(token.address, amountWei);
      const receipt = await withdrawTx.wait();

      setTxHash(receipt.hash);
      setSuccessAction("withdraw");
      setStatus("success");
      setAmount("");
    } catch (e: any) {
      setError(e.message?.slice(0, 100) || "Transaction failed");
      setStatus("error");
    }
  };

  if (!isConnected) {
    return (
      <div className="card">
        <h2 className="text-sm font-semibold text-s-text mb-4">Deposit & Withdraw</h2>
        <div className="text-center py-6">
          <p className="text-sm text-s-text-muted mb-3">Connect wallet to manage funds</p>
          <button onClick={onConnect} className="btn-primary">Connect Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {/* Tab Switcher */}
      <div className="flex items-center gap-1 mb-4 p-1 rounded-lg bg-gray-100">
        <button
          onClick={() => { setTab("deposit"); setStatus("idle"); setError(""); }}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
            tab === "deposit" ? "bg-white text-s-text shadow-sm" : "text-s-text-muted hover:text-s-text"
          }`}
        >
          Deposit
        </button>
        <button
          onClick={() => { setTab("withdraw"); setStatus("idle"); setError(""); }}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
            tab === "withdraw" ? "bg-white text-s-text shadow-sm" : "text-s-text-muted hover:text-s-text"
          }`}
        >
          Withdraw
        </button>
      </div>

      {status === "success" ? (
        <div className="text-center py-4">
          <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M5 13l4 4L19 7"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-s-green mb-1">
            {successAction === "deposit" ? "Deposit" : "Withdrawal"} Successful
          </p>
          {txHash && (
            <a
              href={`https://mantlescan.xyz/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-500 hover:underline"
            >
              View on Explorer
            </a>
          )}
          <button onClick={() => setStatus("idle")} className="btn-secondary mt-3 text-xs">
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-s-text-muted block mb-1.5">Asset</label>
            <select
              value={selectedToken}
              onChange={(e) => setSelectedToken(Number(e.target.value))}
              className="w-full border border-s-border rounded-xl px-3 py-2.5 text-sm text-s-text bg-white focus:outline-none focus:ring-2 focus:ring-s-accent/20 focus:border-s-accent transition-all"
            >
              {TOKENS.map((t, i) => (
                <option key={t.symbol} value={i}>{t.symbol} - {t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-s-text-muted block mb-1.5">Amount</label>
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-s-border rounded-xl px-3 py-2.5 text-sm text-s-text bg-white focus:outline-none focus:ring-2 focus:ring-s-accent/20 focus:border-s-accent transition-all"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          <button
            onClick={tab === "deposit" ? deposit : withdraw}
            disabled={(status !== "idle" && status !== "error") || !amount}
            className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
              tab === "withdraw"
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "btn-primary"
            }`}
          >
            {status === "resolving" ? "Finding vault..." :
             status === "approving" ? "Approving..." :
             status === "depositing" ? "Depositing..." :
             status === "withdrawing" ? "Withdrawing..." :
             tab === "deposit" ? "Deposit" : "Withdraw"}
          </button>

          {tab === "withdraw" && (
            <p className="text-[10px] text-s-text-muted text-center">
              Withdraws tokens from your vault back to your wallet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
