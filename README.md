# Sentinel - Autonomous AI Treasury Manager on Mantle

**An Autonomous On-Chain Treasury Manager Powered by Multi-Agent AI with Cryptographic Verification**

Built for Mantle Hackathon | Tracks: **Agentic Wallets & Economy** + **AI x RWA**

> **Live on Mantle Mainnet** — 6 contracts deployed, real tokens, real DEX swaps, verifiable on [Mantlescan](https://mantlescan.xyz)

---

## The Problem

DeFi portfolio management is broken:

- Users manually monitor yields, risk, and prices across multiple assets
- No way to prove an AI agent actually decided BEFORE seeing the trade outcome
- Off-chain agents self-report performance with no independent verification
- Single-model "AI" systems have no checks and balances
- Capital sits idle while users sleep

## The Solution

Sentinel is your **autonomous on-chain Chief Investment Officer**. Four specialized AI agents collaborate through **on-chain consensus voting**, commit decisions **before** executing them using a **commit-reveal scheme**, and build a **verifiable reputation** anyone can independently audit.

## What Makes Sentinel Different

| Feature | Standard DeFi AI | Sentinel |
|---------|-----------------|----------|
| Decision Proof | Logs results after the fact | Commits hash BEFORE trade, reveals after — cryptographic proof |
| Multi-Agent | Sequential function calls in one script | 4 agents with separate wallets vote on-chain with confidence weighting |
| Performance | Self-reported stats | Win rate, drawdown, accuracy computed on-chain from immutable data |
| Agent Identity | No standard | Full ERC-8004 (Trustless Agent Standard) with 3 registries |
| Network | Testnet / simulated | Mantle Mainnet with real USDY, mETH, USDC |
| DEX | Mock swaps | Real swaps via Agni Finance (Uniswap V3 on Mantle) |
| Multi-User | Single vault | VaultFactory deploys per-user vaults |

---

## Architecture

```
User (Dashboard / Telegram)
         |
    +----+----+
    | Web UI  |  Telegram Bot (natural language + commands)
    +----+----+      |
         |           |
    +----+-----------+---------------------------+
    |         Multi-Agent Intelligence           |
    |                                            |
    |  +--------------+  +------------------+    |
    |  | Market Intel  |  | Yield Optimizer  |    |
    |  | ETH momentum, |  | APY rankings,   |    |
    |  | sentiment,    |  | capital          |    |
    |  | volatility    |  | efficiency       |    |
    |  +------+-------+  +--------+---------+    |
    |         |                    |              |
    |  +------+-------+  +--------+---------+    |
    |  | Risk Mgmt    |  | Portfolio Mgr    |    |
    |  | peg detection,|  | blends inputs,  |    |
    |  | concentration,|  | Llama 3.3 70B   |    |
    |  | drawdown est  |  | AI enhancement  |    |
    |  +--------------+  +------------------+    |
    +------------------+-------------------------+
                       |
              +--------+--------+
              | AgentConsensus  |  <-- On-chain confidence-weighted voting
              +--------+--------+
                       |
    +------------------+-------------------------+
    |         Mantle Smart Contracts             |
    |                                            |
    |  SentinelVault    |  DecisionLogger        |
    |  (deposits,       |  (commit-reveal,       |
    |   rebalance,      |   hash verification)   |
    |   DEX swaps)      |                        |
    |                   |                        |
    |  AgentIdentity    |  AgniAdapter           |
    |  (ERC-8004 NFT,   |  (Agni Finance V3     |
    |   3 registries,   |   real DEX swaps)      |
    |   on-chain rep)   |                        |
    |                   |                        |
    |  VaultFactory     |  AgentConsensus        |
    |  (multi-user      |  (4-agent voting,      |
    |   vault deploy)   |   quorum + threshold)  |
    +--------------------------------------------+
                       |
         +-------------+-------------+
         |                           |
    Real Tokens                 Agni Finance
    USDY (4.5% APY)            (Uniswap V3
    mETH (~$3400)               on Mantle)
    USDC ($1.00)
```

---

## Deployed Contracts (Mantle Mainnet)

All contracts are live and verifiable on Mantlescan:

| Contract | Address | Explorer |
|----------|---------|----------|
| **SentinelVault** | `0xFc4EDCF2CA8068b2A750Ad4507297aba0807CdC5` | [View](https://mantlescan.xyz/address/0xFc4EDCF2CA8068b2A750Ad4507297aba0807CdC5) |
| **DecisionLogger** | `0x962A00d762692F8692B90914577d5191e79a514b` | [View](https://mantlescan.xyz/address/0x962A00d762692F8692B90914577d5191e79a514b) |
| **AgentIdentity** | `0x7292c3Bef25159Fb4119A8CF48AAa027596C7fFD` | [View](https://mantlescan.xyz/address/0x7292c3Bef25159Fb4119A8CF48AAa027596C7fFD) |
| **AgentConsensus** | `0x9F881e3A5F4Fc1621D3CC2fDc187E8302dc50A96` | [View](https://mantlescan.xyz/address/0x9F881e3A5F4Fc1621D3CC2fDc187E8302dc50A96) |
| **VaultFactory** | `0x4F64da35DA275fC052a01a78603500e592059Cb9` | [View](https://mantlescan.xyz/address/0x4F64da35DA275fC052a01a78603500e592059Cb9) |
| **AgniAdapter** | `0x360Ab7Be370DBD0ED30c57c08819611C1a7849C2` | [View](https://mantlescan.xyz/address/0x360Ab7Be370DBD0ED30c57c08819611C1a7849C2) |

---

## Core Innovation: Commit-Reveal Decision Verification

Every other AI-DeFi project logs decisions **after** the trade. Sentinel commits **before**.

```
Phase 1 — COMMIT (before trade):
  hash = keccak256(reasoning + action + allocations + portfolioValue + nonce)
  Agent calls: commitDecision(hash) → stored on-chain with timestamp

Phase 2 — EXECUTE:
  Agent calls: vault.rebalance() or rebalanceWithSwap()
  Real portfolio changes happen here

Phase 3 — REVEAL & VERIFY (after trade):
  Agent calls: logDecision(reasoning, action, allocations, value, commitId, nonce)
  Contract recomputes: revealHash = keccak256(same inputs)
  Contract checks: revealHash == stored commitHash
  Result: verified = true (match) or false (tampering detected)
```

**Why this matters:** The AI cannot observe the trade outcome and adjust its reasoning after the fact. Any change to reasoning, allocations, or portfolio value causes a hash mismatch — flagged as `unverified` forever on-chain.

---

## Multi-Agent Consensus Protocol

Four specialized agents vote independently on-chain, each with its own derived wallet:

| Agent | Role | What It Analyzes |
|-------|------|------------------|
| **Market Intelligence** | Outlook + momentum | ETH price trends, 24h changes, volatility, sentiment signals |
| **Yield Optimization** | Best risk-adjusted yield | APYs from DeFiLlama, capital efficiency rankings, yield spread |
| **Risk Management** | Portfolio safety | Peg deviations, concentration risk, drawdown estimation |
| **Portfolio Manager** | Final blended decision | Combines all inputs, applies user risk profile, Llama 3.3 70B AI enhancement |

### Confidence-Weighted Voting

Votes are not equally weighted. Each agent submits a confidence score (0-100), and the final allocation is computed on-chain:

```
finalAllocation[asset] = sum(vote[i].allocation[asset] * vote[i].confidence)
                         / sum(vote[i].confidence)
```

A 90% confident bullish market agent has more influence than a 50% confident risk agent. This produces nuanced allocations that reflect signal strength.

**Quorum:** Minimum 3 of 4 agents must vote (configurable).
**Confidence Threshold:** Average confidence must exceed 50 (configurable).

---

## ERC-8004: Trustless Agent Standard

Sentinel implements the full [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) standard with three on-chain registries:

### Identity Registry
- ERC-721 NFT representing agent identity
- Metadata: agent name, strategy type, vault address, logger address
- Wallet management and URI for off-chain data

### Reputation Registry
- Client feedback with value scores (-100 to +100)
- Tagged by category and asset (e.g., "trading" + "mETH")
- Feedback revocation and agent response mechanisms
- Fully on-chain, auditable by anyone

### Validation Registry
- Third-party validators submit scores (0-100)
- Validation requests and responses stored on-chain
- Enables external auditing of agent performance

### On-Chain Reputation Metrics

These metrics are **computed entirely on-chain** from immutable decision data — not self-reported:

| Metric | Definition | Range |
|--------|-----------|-------|
| **Win Rate** | % of decisions where portfolio value increased | 0-10000 bps |
| **Avg Confidence** | Average confidence across all decisions | 0-100 |
| **Max Drawdown** | Worst single-decision loss | 0-10000 bps |
| **Streak** | Current consecutive win/loss streak | +/- integer |
| **Accuracy Score** | Composite metric | 0-1000 |

**Accuracy Score Formula:**
```
winComponent    = (winRate / 10000) * 400      // 0-400 points
confComponent   = (avgConfidence / 100) * 300  // 0-300 points
streakBonus     = min(200, streak * 20)        // 0-200 points (0 if losing)
drawdownPenalty = ((5000 - maxDrawdown) / 5000) * 100  // 0-100 points

accuracyScore   = winComponent + confComponent + streakBonus + drawdownPenalty
```

**Anyone can call `computeReputation(tokenId)` to independently verify these metrics.**

---

## Real Tokens (Mantle Mainnet)

| Token | Address | Why It's Interesting |
|-------|---------|---------------------|
| **USDY** | `0x5bE26527e817998A7206475496fDE1E68957c5A6` | Ondo's RWA yield-bearing stablecoin — earns ~4.5% APY from US Treasuries |
| **mETH** | `0xcDA86A272531e8640cD7F1a92c01839911B90bb0` | Mantle's liquid staking ETH — crypto upside with staking yield |
| **USDC** | `0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9` | Standard stablecoin — the safe haven allocation |

These three assets create a balanced portfolio: **RWA yield** (USDY), **crypto exposure** (mETH), and **stability** (USDC).

---

## Smart Contracts

### SentinelVault
Multi-asset vault with deposit/withdraw, agent-directed rebalancing, and real DEX swaps. Enforces a **60% concentration cap** per asset on-chain — the AI cannot overallocate even if it tries. All allocations must sum to exactly 10000 bps (100%). Protected by OpenZeppelin's ReentrancyGuard.

### DecisionLogger
On-chain decision log with **commit-reveal verification**. Stores reasoning, action, old/new allocations, portfolio value, risk level, and verification status for every decision. Prevents post-hoc reasoning manipulation.

### AgentIdentity
ERC-721 identity NFT implementing **ERC-8004 Trustless Agent Standard**. Three registries (Identity, Reputation, Validation). On-chain reputation computed from immutable decision data with 5 metrics.

### AgentConsensus
Multi-agent voting protocol with **confidence-weighted averaging**. Registers 4 sub-agents with distinct roles and wallets. Configurable quorum (3/4 default) and confidence threshold. Every vote is recorded on-chain with reasoning.

### AgniAdapter
Wraps Agni Finance V3 Router for real token swaps on Mantle. Configurable fee tiers per pair: USDY/USDC at 0.01%, mETH/USDC at 1%, mETH/USDY at 0.25%. Includes slippage protection and Quoter integration for price estimates.

### VaultFactory
Enables **multi-user support**. Each user calls `createVault()` to get their own SentinelVault + DecisionLogger deployed. Ownership transfers to the user while the platform agent retains execution rights. Configurable default assets and swap router.

---

## Autonomous Mode & User Controls

Users configure guardrails for autonomous trading:

| Setting | Description | Default |
|---------|-------------|---------|
| **Max Daily Trades** | Maximum rebalances per day | 3 |
| **Min Confidence** | Only trade if AI confidence exceeds threshold | 60% |
| **Max Risk Score** | Don't trade if risk score is too high | 7/10 |
| **Risk Profile** | Conservative / Moderate / Aggressive | Moderate |

If any rule is violated, the trade is sent to **Telegram for manual approval** with a 60-second window. Users see the full reasoning, allocations, and confidence before approving.

### DCA Plans (Dollar-Cost Averaging)
Users set recurring buys: source asset, target asset, amount per execution, interval (1h/4h/12h/24h).

### Conditional Triggers
- **Safety Shift:** "If mETH drops below $2000, shift 20% to stables"
- **Yield Chase:** "If mETH rises above $3500, increase allocation to 50%"
- **Scheduled Rebalance:** "Force rebalance every Sunday at 00:00 UTC"

---

## Telegram Bot

Natural language interface — users chat normally or use slash commands:

| Command | Description |
|---------|-------------|
| `/portfolio` | Asset allocations, balances, USD values |
| `/yields` | Current APY for each asset |
| `/risk` | Risk score, warnings, exposure analysis |
| `/lastdecision` | Last AI decision with full reasoning |
| `/agents` | Status of all 4 sub-agents and their votes |
| `/setrisk` | Change risk profile (conservative/moderate/aggressive) |
| `/autonomous` | View/toggle autonomous mode and guardrails |
| `/approve` / `/reject` | Approve or reject pending trades |
| `/dca` | View and manage DCA plans |
| `/plans` | View and manage scheduled/conditional tasks |
| `/vault` | Vault info (address, decisions, ROI) |
| `/runnow` | Manually trigger an agent decision cycle |
| `/help` | Show all commands |

Natural language examples:
- "How is my treasury doing?" → Portfolio status
- "Why did you buy mETH?" → AI reasoning explanation
- "Set up a DCA to buy mETH with USDC every 4 hours" → Creates DCA plan

---

## Decision Cycle Flow

```
1. FETCH DATA
   ├── Yield data from DeFiLlama
   ├── Prices from CoinGecko
   └── Risk metrics (peg deviation, volatility)

2. MULTI-AGENT ANALYSIS
   ├── Market: "Bullish, ETH momentum +75, confidence 90%"
   ├── Yield:  "USDY best at 4.5% APY, spread 2.0%"
   ├── Risk:   "Score 3.5/10, no critical warnings"
   └── Portfolio: Llama 3.3 70B enhanced → "35% USDY, 35% mETH, 30% USDC"

3. ON-CHAIN CONSENSUS VOTING
   ├── startRound() on AgentConsensus
   ├── 4 sub-agents submit votes with confidence scores
   ├── resolveRound() computes confidence-weighted average
   └── Quorum check (3/4 required)

4. COMMIT HASH (before trade)
   └── commitDecision(keccak256(reasoning + allocations + value + nonce))

5. EXECUTE REBALANCE
   ├── vault.rebalance() or vault.rebalanceWithSwap()
   └── Real token swaps via Agni Finance V3

6. REVEAL & VERIFY (after trade)
   ├── logDecision(...data, commitId, nonce)
   └── Contract verifies hash match → verified = true/false

7. UPDATE REPUTATION
   ├── recordDecisionOutcome(portfolioValue, confidence)
   └── Win rate, drawdown, streak, accuracy updated on-chain

8. NOTIFY USER
   └── Telegram message with outcome, tx link, reasoning
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests (71 tests)
npm run test

# Start dashboard
npm run dev

# Deploy to Mantle Mainnet
npm run deploy

# Run AI agent
npm run agent

# Start Telegram bot
npm run telegram
```

## Testing

```bash
npx hardhat test                              # Unit tests (71 tests)
FORK_MANTLE=1 npx hardhat test                # + fork tests against Mantle mainnet
```

**71 tests** covering:
- **SentinelVault:** deposits, withdrawals, rebalancing, 60% cap, swap routing, portfolio view
- **DecisionLogger:** commit-reveal, verified reveal, tampered data detection, wrong nonce, double-reveal prevention
- **AgentConsensus:** voting, confidence-weighted averaging, quorum failure, confidence threshold, duplicate vote rejection
- **AgentIdentity:** registration, metadata updates, reputation computation, win/loss tracking, tokenURI generation
- **AgniAdapter:** deployment, fee tier configuration, access control, real Agni V3 swaps on fork

---

## Security

- **ReentrancyGuard** on all state-changing vault functions
- **SafeERC20** for all token operations
- **60% concentration cap** enforced on-chain (not in AI logic)
- **Allocation sum validation** — must equal exactly 10000 bps
- **Zero-address checks** on all contract deployments
- **Access control** — `onlyOwner` and `onlyAgent` modifiers
- **Slippage protection** on all DEX swaps
- **Commit-reveal** prevents post-hoc reasoning manipulation

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Mantle Mainnet (EVM, chainId 5000) |
| Smart Contracts | Solidity 0.8.26, OpenZeppelin 5.x, Hardhat |
| AI Model | Llama 3.3 70B via Groq API |
| Agent Runtime | TypeScript, ethers.js v6 |
| DEX | Agni Finance (Uniswap V3 fork on Mantle) |
| Frontend | Next.js 14, Tailwind CSS, Recharts, RainbowKit |
| Bot | Telegram Bot API |
| Data Feeds | CoinGecko (prices), DeFiLlama (yields) |
| Standards | ERC-721, ERC-8004 (Trustless Agent Standard) |

---

## Documentation

For detailed technical writeup covering contract internals, agent algorithms, and security analysis — see **[documentation.md](./documentation.md)**.
