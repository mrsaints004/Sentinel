"use client";

import { useState } from "react";

const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS || "";

const TOKENS = [
  { symbol: "USDY", name: "Ondo USDY", address: process.env.NEXT_PUBLIC_USDY_ADDRESS || "0x5bE26527e817998A7206475496fDE1E68957c5A6", decimals: 18 },
  { symbol: "mETH", name: "Mantle Staked ETH", address: process.env.NEXT_PUBLIC_METH_ADDRESS || "0xcDA86A272531e8640cD7F1a92c01839911B90bB0", decimals: 18 },
  { symbol: "USDC", name: "USD Coin", address: process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", decimals: 6 },
];

// Minimal ABIs for deposit flow
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

const VAULT_ABI = [
  "function deposit(address token, uint256 amount) external",
];

interface Props {
  isConnected: boolean;
  onConnect: () => void;
}

export default function DepositForm({ isConnected, onConnect }: Props) {
  const [selectedToken, setSelectedToken] = useState(0);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "approving" | "depositing" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");

  const deposit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;

    const eth = (window as any).ethereum;
    if (!eth) return;

    setStatus("approving");
    setError("");

    try {
      const { ethers } = await import("ethers");
      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();
      const token = TOKENS[selectedToken];

      const tokenContract = new ethers.Contract(token.address, ERC20_ABI, signer);
      const amountWei = ethers.parseUnits(amount, token.decimals);

      // Check allowance
      const currentAllowance = await tokenContract.allowance(await signer.getAddress(), VAULT_ADDRESS);
      if (currentAllowance < amountWei) {
        const approveTx = await tokenContract.approve(VAULT_ADDRESS, ethers.MaxUint256);
        await approveTx.wait();
      }

      // Deposit
      setStatus("depositing");
      const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
      const depositTx = await vault.deposit(token.address, amountWei);
      const receipt = await depositTx.wait();

      setTxHash(receipt.hash);
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
        <h2 className="text-sm font-semibold text-s-text mb-4">Deposit to Vault</h2>
        <div className="text-center py-6">
          <p className="text-sm text-s-text-muted mb-3">Connect wallet to deposit</p>
          <button onClick={onConnect} className="btn-primary">Connect Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-s-text mb-4">Deposit to Vault</h2>

      {status === "success" ? (
        <div className="text-center py-4">
          <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M5 13l4 4L19 7"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-s-green mb-1">Deposit Successful</p>
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
            Deposit More
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
            onClick={deposit}
            disabled={status === "approving" || status === "depositing" || !amount}
            className="btn-primary w-full disabled:opacity-50"
          >
            {status === "approving" ? "Approving..." :
             status === "depositing" ? "Depositing..." :
             "Deposit"}
          </button>
        </div>
      )}
    </div>
  );
}
