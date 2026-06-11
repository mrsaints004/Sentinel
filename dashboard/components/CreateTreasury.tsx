"use client";

import { useState, useEffect } from "react";

interface TreasuryConfig {
  depositAmount: string;
  riskProfile: "conservative" | "moderate" | "aggressive";
  autoApprove: boolean;
}

const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "";
const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9";
const USDC_DECIMALS = 6;

const FACTORY_ABI = [
  "function createVault() external returns (address vault, address logger)",
  "function getVault(address owner) external view returns (address vault, address logger, uint256 createdAt)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

const VAULT_ABI = [
  "function deposit(address token, uint256 amount) external",
];

const RISK_PROFILES = [
  {
    id: "conservative" as const,
    label: "Conservative",
    icon: "🛡",
    desc: "Prioritizes capital preservation. Heavy stablecoin allocation. Lower yields, lower risk.",
    allocation: "USDY 45% / mETH 15% / USDC 40%",
    allocBps: [4500, 1500, 4000],
  },
  {
    id: "moderate" as const,
    label: "Moderate",
    icon: "⚖️",
    desc: "Balanced approach. Optimizes yield while maintaining risk limits. Default strategy.",
    allocation: "USDY 35% / mETH 35% / USDC 30%",
    allocBps: [3500, 3500, 3000],
  },
  {
    id: "aggressive" as const,
    label: "Aggressive",
    icon: "🚀",
    desc: "Maximizes yield. Higher allocation to volatile assets. Higher risk, higher potential returns.",
    allocation: "USDY 30% / mETH 50% / USDC 20%",
    allocBps: [3000, 5000, 2000],
  },
];

export default function CreateTreasury({
  isConnected,
  onConnect,
  onClose,
  walletAddress,
}: {
  isConnected: boolean;
  onConnect: () => void;
  onClose: () => void;
  walletAddress?: string;
}) {
  const [config, setConfig] = useState<TreasuryConfig>({
    depositAmount: "",
    riskProfile: "moderate",
    autoApprove: true,
  });
  const [step, setStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [existingVault, setExistingVault] = useState<string | null>(null);
  const [newVaultAddress, setNewVaultAddress] = useState<string>("");

  // Check if user already has a vault
  useEffect(() => {
    if (!isConnected || !walletAddress || !FACTORY_ADDRESS) return;
    (async () => {
      try {
        const { ethers } = await import("ethers");
        const eth = (window as any).ethereum;
        if (!eth) return;
        const provider = new ethers.BrowserProvider(eth);
        const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
        const [vault, , createdAt] = await factory.getVault(walletAddress);
        if (vault !== ethers.ZeroAddress && Number(createdAt) > 0) {
          setExistingVault(vault);
        }
      } catch {}
    })();
  }, [isConnected, walletAddress]);

  const handleCreate = async () => {
    const eth = (window as any).ethereum;
    if (!eth) { setError("No wallet detected"); return; }

    setIsCreating(true);
    setError("");

    try {
      const { ethers } = await import("ethers");
      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();

      if (FACTORY_ADDRESS) {
        // Deploy via VaultFactory
        setStatusMsg("Creating your vault...");
        const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
        const createTx = await factory.createVault();
        const receipt = await createTx.wait();

        // Parse VaultCreated event to get addresses
        const iface = new ethers.Interface(["event VaultCreated(address indexed owner, address vault, address logger)"]);
        let vaultAddr = "";
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
            if (parsed?.name === "VaultCreated") {
              vaultAddr = parsed.args.vault;
              break;
            }
          } catch {}
        }

        if (!vaultAddr) {
          // Try getVault as fallback
          const readFactory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
          const [v] = await readFactory.getVault(await signer.getAddress());
          vaultAddr = v;
        }

        setNewVaultAddress(vaultAddr);

        // If user wants to deposit
        if (config.depositAmount && Number(config.depositAmount) > 0) {
          const amountWei = ethers.parseUnits(config.depositAmount, USDC_DECIMALS);

          setStatusMsg("Approving USDC...");
          const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
          const currentAllowance = await usdc.allowance(await signer.getAddress(), vaultAddr);
          if (currentAllowance < amountWei) {
            const approveTx = await usdc.approve(vaultAddr, ethers.MaxUint256);
            await approveTx.wait();
          }

          setStatusMsg("Depositing into vault...");
          const vault = new ethers.Contract(vaultAddr, VAULT_ABI, signer);
          const depositTx = await vault.deposit(USDC_ADDRESS, amountWei);
          await depositTx.wait();
        }

        setTxHash(receipt.hash);
      } else {
        // Legacy: direct deposit to global vault
        const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS || "";
        const amountWei = ethers.parseUnits(config.depositAmount, USDC_DECIMALS);

        setStatusMsg("Approving USDC...");
        const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
        const currentAllowance = await usdc.allowance(await signer.getAddress(), VAULT_ADDRESS);
        if (currentAllowance < amountWei) {
          const approveTx = await usdc.approve(VAULT_ADDRESS, ethers.MaxUint256);
          await approveTx.wait();
        }

        setStatusMsg("Depositing into vault...");
        const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
        const depositTx = await vault.deposit(USDC_ADDRESS, amountWei);
        const receipt = await depositTx.wait();
        setTxHash(receipt.hash);
      }

      setIsCreating(false);
      setCreated(true);
    } catch (e: any) {
      setError(e.message?.slice(0, 120) || "Transaction failed");
      setIsCreating(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="card text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-50 flex items-center justify-center">
          <svg className="w-8 h-8 text-s-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-s-text mb-2">Create Your AI Treasury</h3>
        <p className="text-sm text-s-text-muted mb-6 max-w-md mx-auto">
          Deploy an autonomous AI agent that manages your capital across Mantle yield opportunities.
        </p>
        <button onClick={onConnect} className="btn-primary">Connect Wallet to Start</button>
      </div>
    );
  }

  // Show "already have vault" state
  if (existingVault) {
    return (
      <div className="card text-center py-10">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-indigo-50 flex items-center justify-center">
          <svg className="w-7 h-7 text-s-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-s-text mb-1">You Already Have a Vault</h3>
        <p className="text-sm text-s-text-muted mb-4">
          Your vault is deployed and the AI agent is managing it.
        </p>
        <p className="text-xs font-mono text-s-accent mb-4">
          {existingVault.slice(0, 8)}...{existingVault.slice(-6)}
        </p>
        <button onClick={onClose} className="btn-primary">View Dashboard</button>
      </div>
    );
  }

  if (created) {
    return (
      <div className="card text-center py-10">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-green-50 flex items-center justify-center">
          <svg className="w-7 h-7 text-s-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-s-text mb-1">Treasury Created</h3>
        <p className="text-sm text-s-text-muted mb-4">
          Your vault is live. The AI agent will manage your allocation autonomously.
        </p>
        {newVaultAddress && (
          <p className="text-xs font-mono text-s-accent mb-2">
            Vault: {newVaultAddress.slice(0, 8)}...{newVaultAddress.slice(-6)}
          </p>
        )}
        {txHash && (
          <a href={`https://mantlescan.xyz/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            className="text-xs text-indigo-500 hover:underline block mb-4">
            View transaction on Mantle Explorer
          </a>
        )}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-s-bg border border-s-border text-sm">
          <span className="text-s-text-muted">Strategy</span>
          <span className="font-semibold text-s-accent capitalize">{config.riskProfile}</span>
          {config.depositAmount && Number(config.depositAmount) > 0 && (<>
            <span className="text-s-text-muted">|</span>
            <span className="text-s-text-muted">Deposit</span>
            <span className="font-mono font-semibold text-s-accent">${Number(config.depositAmount).toLocaleString()}</span>
          </>)}
        </div>
        <div className="mt-6">
          <button onClick={onClose} className="btn-primary">View Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-semibold text-s-text">Create AI Treasury</h2>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`w-2 h-2 rounded-full transition-colors ${s <= step ? "bg-s-accent" : "bg-gray-200"}`} />
          ))}
        </div>
      </div>

      {step === 1 && (
        <div>
          <label className="text-xs text-s-text-muted block mb-2">Deposit Amount (USDC) — optional</label>
          <div className="relative mb-4">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-s-text-muted text-sm">$</span>
            <input type="number" value={config.depositAmount}
              onChange={(e) => setConfig({ ...config, depositAmount: e.target.value })}
              placeholder="10,000"
              className="w-full border border-s-border rounded-xl pl-7 pr-3 py-3 text-lg font-semibold text-s-text bg-white focus:outline-none focus:ring-2 focus:ring-s-accent/20 focus:border-s-accent"
            />
          </div>
          <button onClick={() => setStep(2)} className="btn-primary w-full">
            Next: Choose Strategy
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <p className="text-xs text-s-text-muted mb-4">Choose how your AI agent should manage risk.</p>
          <div className="space-y-3 mb-4">
            {RISK_PROFILES.map((p) => (
              <button key={p.id} onClick={() => setConfig({ ...config, riskProfile: p.id })}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  config.riskProfile === p.id ? "border-s-accent bg-indigo-50/50 shadow-sm" : "border-s-border hover:border-s-border-hover"
                }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-s-text">{p.icon} {p.label}</span>
                </div>
                <p className="text-xs text-s-text-muted mb-1.5">{p.desc}</p>
                <p className="text-[11px] text-s-text-muted font-mono">{p.allocation}</p>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="btn-secondary flex-1">Back</button>
            <button onClick={() => setStep(3)} className="btn-primary flex-1">Next: Confirm</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="rounded-xl bg-s-bg border border-s-border p-4 mb-4 space-y-2.5">
            {config.depositAmount && Number(config.depositAmount) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-s-text-muted">Deposit</span>
                <span className="font-semibold text-s-text">${Number(config.depositAmount).toLocaleString()} USDC</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-s-text-muted">Strategy</span>
              <span className="font-medium text-s-text capitalize">{config.riskProfile}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-s-text-muted">Network</span>
              <span className="font-medium text-s-teal">Mantle</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-s-text-muted">Vault</span>
              <span className="font-medium text-s-purple">{FACTORY_ADDRESS ? "New (via Factory)" : "Shared Vault"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-s-text-muted">Auto-approve trades</span>
              <button onClick={() => setConfig({ ...config, autoApprove: !config.autoApprove })}
                className={`relative w-10 h-5 rounded-full transition-colors ${config.autoApprove ? "bg-s-accent" : "bg-gray-200"}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.autoApprove ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} disabled={isCreating} className="btn-secondary flex-1">Back</button>
            <button onClick={handleCreate} disabled={isCreating} className="btn-primary flex-1">
              {isCreating ? statusMsg : "Create Treasury"}
            </button>
          </div>

          <p className="text-[10px] text-s-text-muted text-center mt-3">
            {FACTORY_ADDRESS
              ? "This will deploy a new vault via the VaultFactory contract on Mantle."
              : "This will execute an on-chain deposit to the Sentinel Vault on Mantle."}
          </p>
        </div>
      )}
    </div>
  );
}
