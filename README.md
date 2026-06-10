# Sentinel - Autonomous AI Treasury Manager on Mantle

**An Autonomous On-Chain Treasury Manager Powered by Multi-Agent AI with Cryptographic Verification**

Built for Turing Test Hackathon 2026 | Tracks: **Agentic Wallets & Economy** + **AI x RWA**

## The Problem

Participating in DeFi is still difficult. Users must constantly monitor markets, compare yields, track risk, and execute transactions manually. Capital sits idle, opportunities are missed, and risk is poorly managed. Existing AI-DeFi projects run models off-chain with no proof that the AI actually made the decision before executing - the blockchain is just an expensive database.

## The Solution

An AI Treasury Agent that acts as your personal on-chain Chief Investment Officer. Four specialized AI agents collaborate through an **on-chain consensus protocol**, commit decisions **before** executing them using a **commit-reveal scheme**, and build a **verifiable reputation** that anyone can independently audit - all on Mantle Mainnet with real assets.

## What Makes Sentinel Different

| Feature | Standard DeFi AI | Sentinel |
|---------|-----------------|----------|
| AI Decision Proof | Post results after the fact | Commit hash before trade, reveal after - cryptographic proof |
| Multi-Agent | Sequential function calls | On-chain consensus voting with confidence weighting |
| Performance Tracking | Self-reported stats | On-chain computed win rate, drawdown, accuracy score |
| Network | Testnet / simulated | Mantle Mainnet with real USDY, mETH, USDC |
| DEX Integration | Mock swaps | Real swaps via Merchant Moe Liquidity Book |

## Architecture

```
User (Dashboard / Telegram)
         |
    +----+----+
    | Web UI  |  Telegram Bot
    +----+----+      |
         |           |
    +----+-----------+---------------------+
    |       Multi-Agent Intelligence       |
    |                                      |
    |  +-----------+  +----------------+   |
    |  | Market    |  | Yield          |   |
    |  | Intel     |  | Optimization   |   |
    |  +-----+-----+  +------+---------+   |
    |        |               |             |
    |  +-----+-----+  +------+---------+   |
    |  | Risk      |  | Portfolio      |   |
    |  | Mgmt      |  | Manager        |   |
    |  +-----------+  +----------------+   |
    +------------------+-------------------+
                       |
              +--------+--------+
              | AgentConsensus  |  <-- On-chain weighted voting
              +--------+--------+
                       |
    +------------------+-------------------+
    |       Mantle Smart Contracts         |
    |                                      |
    |  SentinelVault  | DecisionLogger     |
    |  (deposits,     | (commit-reveal,    |
    |   rebalance,    |  verification)     |
    |   DEX swaps)    |                    |
    |                                      |
    |  AgentIdentity  | MerchantMoe        |
    |  (NFT + on-chain|  Adapter           |
    |   reputation)   | (real DEX swaps)   |
    +--------------------------------------+
```

## Quick Start

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests (62 tests)
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

## Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile all smart contracts |
| `npm run test` | Run 62 contract tests |
| `npm run deploy` | Deploy to Mantle Mainnet |
| `npm run agent` | Start multi-agent system |
| `npm run telegram` | Start Telegram bot |
| `npm run dev` | Start dashboard (localhost:3000) |

## Smart Contracts

| Contract | Description |
|----------|-------------|
| **SentinelVault** | Multi-asset vault with deposit/withdraw, agent-directed rebalancing, 60% concentration cap, and real DEX swaps via Merchant Moe |
| **DecisionLogger** | On-chain decision log with **commit-reveal verification**. Agent commits a hash before trading, reveals data after. Contract verifies the match. |
| **AgentIdentity** | ERC-721 identity NFT with **on-chain reputation** - win rate, accuracy score, max drawdown, streaks, all computed trustlessly on-chain |
| **AgentConsensus** | **Multi-agent voting protocol** with confidence-weighted averaging, configurable quorum (3/4 default), and per-agent vote recording |
| **MerchantMoeAdapter** | Wraps Merchant Moe LB Router for real token swaps on Mantle |

## Multi-Agent System

| Agent | Role | Consensus Vote |
|-------|------|----------------|
| **Market Intelligence** | Monitors price trends, ETH momentum, volatility, sentiment signals | Votes allocation based on market outlook |
| **Yield Optimization** | Tracks yields across Mantle protocols, ranks capital efficiency | Votes allocation toward highest risk-adjusted yield |
| **Risk Management** | Concentration analysis, depeg detection, drawdown estimation | Votes allocation toward safety based on risk score |
| **Portfolio Manager** | Combines all outputs, applies risk profile, makes final call | Votes the AI-enhanced blended allocation |

Each agent submits its vote to the **AgentConsensus** contract with a confidence score. The contract computes a confidence-weighted average and only executes if quorum is reached.

## Real Tokens (Mantle Mainnet)

| Token | Address | Description |
|-------|---------|-------------|
| USDY | `0x5bE26527e817998A7206475496fDE1E68957c5A6` | Ondo US Dollar Yield |
| mETH | `0xcDA86A272531e8640cD7F1a92c01839911B90bb0` | Mantle Staked ETH |
| USDC | `0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9` | Bridged USDC |

For demo purposes, deposit small amounts (0.1 USDC, 0.1 USDY, etc.) - the full flow works at any scale.

## Deployed Contracts

After running `npm run deploy`, update your `.env`:

```env
VAULT_ADDRESS=0x...
LOGGER_ADDRESS=0x...
IDENTITY_ADDRESS=0x...
CONSENSUS_ADDRESS=0x...
SWAP_ROUTER_ADDRESS=0x...
PRIVATE_KEY=your_private_key
MANTLE_MAINNET_RPC=https://rpc.mantle.xyz
```

## Testing

```bash
npx hardhat test
```

**62 tests** covering:
- Vault: deposits, withdrawals, rebalancing, 60% cap enforcement, swap routing
- Commit-Reveal: commit, verified reveal, tampered data detection, wrong nonce, double-reveal prevention
- Consensus: voting, confidence-weighted averaging, quorum failure, confidence threshold
- Identity: registration, metadata updates, reputation computation, win/loss tracking

## Telegram Bot

Users interact via natural language:
- "How is my treasury doing?" - Portfolio status
- "Why did you buy mETH?" - AI reasoning explanation
- `/portfolio` `/yields` `/risk` `/agents` - Quick commands
- `/approve` `/reject` - Trade approval flow

## User Journey

1. Connect wallet on dashboard
2. Create treasury with deposit amount + risk profile
3. AI agent starts managing portfolio with multi-agent consensus
4. Each decision is committed on-chain before execution (commit-reveal)
5. User monitors via dashboard or Telegram
6. Agent reputation builds on-chain with every decision
7. Anyone can verify the agent's track record by calling `computeReputation()`

## Documentation

For a detailed technical writeup covering architecture, contract design, agent internals, and security - see **[documentation.md](./documentation.md)**.

## Tech Stack

- **Blockchain**: Mantle Mainnet (EVM, chainId 5000)
- **Contracts**: Solidity 0.8.26, OpenZeppelin 5.x
- **Agent**: TypeScript, ethers.js v6
- **AI**: Gemini 2.0 Flash (via OpenAI-compatible API)
- **DEX**: Merchant Moe Liquidity Book
- **Dashboard**: Next.js 14, Tailwind CSS, Recharts, RainbowKit
- **Testing**: Hardhat, Chai, 62 tests
- **Cross-chain**: Byreal CLI (Solana yield intelligence)
- **Bot**: Telegram Bot API
