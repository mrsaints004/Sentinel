# Sentinel - Technical Documentation

## Table of Contents

1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [Smart Contracts](#smart-contracts)
4. [Multi-Agent System](#multi-agent-system)
5. [Commit-Reveal Verification](#commit-reveal-verification)
6. [On-Chain Consensus Voting](#on-chain-consensus-voting)
7. [Verifiable Reputation System](#verifiable-reputation-system)
8. [Agent Decision Cycle](#agent-decision-cycle)
9. [Dashboard](#dashboard)
10. [Deployment Guide](#deployment-guide)
11. [Security Considerations](#security-considerations)
12. [Testing](#testing)

---

## Overview

Sentinel is an autonomous AI treasury manager deployed on Mantle Mainnet. It manages a portfolio of three real-world assets (USDY, mETH, USDC) using four specialized AI agents that collaborate through on-chain consensus to make investment decisions.

The core innovation is that Sentinel doesn't just use the blockchain as a database. It uses three cryptographic/consensus mechanisms that make the AI's behavior verifiable and trustless:

1. **Commit-Reveal** - Proves the AI decided before acting
2. **Consensus Voting** - Proves each sub-agent contributed independently
3. **On-Chain Reputation** - Proves performance metrics are real, not self-reported

---

## How It Works

Here is the step-by-step flow of a single decision cycle:

```
1. COLLECT DATA
   The agent fetches live market prices, yield rates, and risk indicators
   from external APIs (CoinGecko, protocol endpoints).

2. AGENT ANALYSIS
   Four sub-agents analyze the data independently:
   - Market Intelligence: Is the market bullish, bearish, or neutral?
   - Yield Optimization: Which assets have the best risk-adjusted yield?
   - Risk Management: What is the portfolio's risk score? Any warnings?
   - Portfolio Manager: Given all inputs, what should the new allocation be?

3. CONSENSUS VOTING (on-chain)
   Each sub-agent submits a vote to the AgentConsensus contract:
   - Proposed allocation (e.g., USDY: 40%, mETH: 35%, USDC: 25%)
   - Confidence score (0-100)
   - Brief reasoning string
   The contract aggregates votes using confidence-weighted averaging.
   A decision only proceeds if >= 3 of 4 agents vote AND combined
   confidence exceeds the threshold (default: 50).

4. COMMIT (on-chain)
   The agent hashes the final decision data:
   hash = keccak256(reasoning, action, allocations, portfolioValue, nonce)
   This hash is submitted to DecisionLogger.commitDecision() BEFORE
   any trade is executed. The hash is recorded with a timestamp.

5. EXECUTE (on-chain)
   The agent calls SentinelVault.rebalance() or rebalanceWithSwap()
   to update the portfolio allocation on-chain. If a DEX swap is needed,
   it routes through Merchant Moe's Liquidity Book.

6. REVEAL (on-chain)
   The agent calls DecisionLogger.logDecision() with the original data
   plus the commitId and nonce. The contract recomputes the hash and
   checks if it matches the committed hash.
   - Match: decision is marked "verified = true"
   - Mismatch: decision is marked "verified = false" (flagged)

7. REPUTATION UPDATE (on-chain)
   The agent calls AgentIdentity.recordDecisionOutcome() with the
   current portfolio value and confidence. The contract compares this
   to the previous value to determine if it was a win or loss, and
   updates win rate, drawdown, streak, and accuracy score.
```

---

## Smart Contracts

### SentinelVault.sol

The vault holds user deposits and manages portfolio allocations.

**Key functions:**
- `deposit(token, amount)` - Deposit an ERC-20 token into the vault
- `withdraw(token, amount)` - Withdraw tokens (up to deposited amount)
- `rebalance(assets, newAllocBps)` - Update target allocations (agent-only)
- `rebalanceWithSwap(...)` - Rebalance with actual DEX token swaps
- `getPortfolio()` - Returns all assets, names, balances, and allocations

**Safety rules:**
- No single asset can exceed 60% allocation (6000 bps)
- All allocations must sum to exactly 10000 bps (100%)
- Only the authorized agent can call rebalance functions
- ReentrancyGuard protects against reentrancy attacks
- Owner can rescue non-supported tokens accidentally sent to the contract

### DecisionLogger.sol

Logs every AI decision on-chain with full reasoning, and implements the commit-reveal verification scheme.

**Key functions:**
- `commitDecision(hash)` - Submit a hash before executing. Returns a commitId.
- `logDecision(..., commitId, nonce)` - Log decision and verify against the committed hash
- `logDecision(...)` - Legacy version without commit-reveal (backwards compatible)
- `getDecisionVerification(id)` - Returns the commit hash and whether it was verified
- `getRecentDecisions(count)` - Returns the N most recent decisions

**Data stored per decision:**
- Agent address, reasoning text, action type
- Old and new allocations with asset names
- Portfolio value in USD, risk level
- Commit hash and verified flag
- Timestamp

### AgentIdentity.sol

ERC-721 NFT that serves as the agent's on-chain identity with verifiable reputation metrics.

**Key functions:**
- `registerAgent(agent, name, strategy, vault, logger)` - Mint an identity NFT
- `updateMetadata(tokenId, totalDecisions, cumulativeROIBps)` - Update basic stats
- `recordDecisionOutcome(tokenId, portfolioValueUSD, confidence)` - Record a win/loss
- `computeReputation(tokenId)` - Returns all reputation metrics (public view, anyone can call)
- `tokenURI(tokenId)` - Returns fully on-chain JSON metadata (Base64 data URI)

**Reputation metrics (all computed on-chain):**

| Metric | Description | How It's Computed |
|--------|-------------|-------------------|
| Win Rate | % of decisions where portfolio value increased | wins / (wins + losses) in bps |
| Avg Confidence | Average confidence score across all decisions | totalConfidence / confidenceCount |
| Max Drawdown | Worst single-decision loss | Tracked as max of all individual losses in bps |
| Streak Length | Current consecutive win/loss streak | Positive = wins, negative = losses |
| Accuracy Score | Compound metric (0-1000) | Weighted sum of win rate, confidence, streak, drawdown |

**Accuracy Score formula:**
```
accuracyScore = winComponent (0-400) + confComponent (0-300) + streakBonus (0-200) + drawdownPenalty (0-100)

winComponent   = (winRate / 10000) * 400
confComponent  = (avgConfidence / 100) * 300
streakBonus    = min(200, positiveStreak * 20)    // 0 if losing streak
drawdownPenalty = ((5000 - maxDrawdownBps) / 5000) * 100  // 100 if no drawdown
```

### AgentConsensus.sol

On-chain voting protocol for multi-agent consensus.

**Key functions:**
- `registerAgent(agent, role)` - Register a sub-agent with a role (Market/Yield/Risk/Portfolio)
- `startRound()` - Start a new voting round
- `submitVote(roundId, allocations, confidence, reasoning)` - Submit a vote
- `resolveRound(roundId)` - Compute the weighted average and check quorum
- `getRoundResult(roundId)` - View the final result of a round
- `getVote(roundId, role)` - View a specific agent's vote

**How voting works:**

1. Each sub-agent submits proposed allocations (in bps, must sum to 10000) with a confidence score (0-100) and reasoning string
2. The contract stores each vote mapped by agent role
3. When `resolveRound()` is called, the contract:
   - Checks if the number of votes >= quorum (default: 3)
   - Computes confidence-weighted average: `finalAlloc[i] = sum(alloc[i] * confidence) / sum(confidence)`
   - Checks if average confidence >= threshold (default: 50)
   - If both pass, the round is marked as successful with the final allocations
   - If either fails, the round is marked as failed

**Example:**

| Agent | USDY | mETH | USDC | Confidence |
|-------|------|------|------|------------|
| Market (bullish) | 3000 | 4500 | 2500 | 90 |
| Yield | 3500 | 3000 | 3500 | 70 |
| Risk (cautious) | 4500 | 1000 | 4500 | 60 |
| Portfolio | 3500 | 3500 | 3000 | 80 |

Weighted USDY = (3000x90 + 3500x70 + 4500x60 + 3500x80) / (90+70+60+80) = 3533 bps

The higher-confidence Market agent pulls the allocation toward its bullish position, while the lower-confidence Risk agent has less influence.

### MerchantMoeAdapter.sol

Wraps the Merchant Moe Liquidity Book Router to implement the `ISwapRouter` interface used by SentinelVault.

**Key functions:**
- `swap(tokenIn, tokenOut, amountIn, minAmountOut)` - Execute a swap
- `getAmountOut(tokenIn, tokenOut, amountIn)` - Get a price quote
- `setBinStep(tokenA, tokenB, binStep)` - Configure bin step for a token pair

---

## Multi-Agent System

### Market Intelligence Agent

Analyzes price data to determine market outlook.

**Inputs:** Live prices for ETH, BTC, USDY, USDC from CoinGecko.

**Analysis:**
- 24h price change momentum (ETH and BTC)
- Volatility estimation from price variance
- Trend signals (bullish/bearish/neutral)
- Sentiment score based on momentum and volume proxies

**Output:** `MarketOutlook` with outlook (bullish/bearish/neutral), confidence (0-100), ETH momentum score, volatility level, and signal list.

### Yield Optimization Agent

Ranks assets by risk-adjusted yield.

**Inputs:** Yield data from Mantle protocols (mETH staking APY, USDY base yield, USDC lending rates).

**Analysis:**
- Raw APY comparison across assets
- Capital efficiency scoring
- Yield spread calculation
- Protocol risk weighting

**Output:** `YieldAnalysis` with best yield asset, rankings with capital efficiency scores, and yield spread.

### Risk Management Agent

Evaluates portfolio risk and generates warnings.

**Inputs:** Current prices, risk indicators, current allocations.

**Analysis:**
- Concentration risk (any single asset > 50%?)
- Depeg detection for stablecoins (> 2% from peg)
- Drawdown estimation based on volatility
- Exposure warnings with severity levels

**Output:** `RiskAnalysis` with risk score (0-10), max drawdown estimate, exposure warnings, suggested allocation limits, and recommendation text.

### Portfolio Manager Agent

Makes the final allocation decision by blending all three agent outputs.

**Process:**
1. Compute yield-based allocation (proportional to APY)
2. Adjust for market conditions (more mETH if bullish, more stables if bearish)
3. Adjust for risk (push toward stables if risk score > 6)
4. Blend using profile weights:
   - Conservative: 20% yield, 60% safety, 20% momentum
   - Moderate: 40% yield, 35% safety, 25% momentum
   - Aggressive: 50% yield, 20% safety, 30% momentum
5. Enhance with Gemini AI - sends all data to Gemini 2.0 Flash for AI-powered allocation adjustment and natural language reasoning
6. Validate AI output (allocations must sum to 10000, each between 1000-6000)

---

## Commit-Reveal Verification

### Why It Matters

Without commit-reveal, the agent could:
- Execute a trade
- See the result
- Then log favorable "reasoning" after the fact

With commit-reveal, the agent must commit its reasoning **before** the trade executes. If the revealed data doesn't match the commit, the decision is flagged as unverified.

### Technical Flow

```
Agent                          DecisionLogger Contract
  |                                    |
  |-- 1. hash = keccak256(            |
  |       reasoning + action +         |
  |       allocations + value +        |
  |       nonce)                       |
  |                                    |
  |-- 2. commitDecision(hash) -------->|  Stores hash with timestamp
  |                                    |  Returns commitId
  |                                    |
  |-- 3. vault.rebalance() ----------->|  (SentinelVault)
  |                                    |
  |-- 4. logDecision(data,            |
  |       commitId, nonce) ----------->|  Recomputes hash from data
  |                                    |  Compares with stored hash
  |                                    |  Sets verified = true/false
  |                                    |
```

### Hash Construction

The hash is computed using `abi.encode` (not `encodePacked`, to avoid hash collisions with dynamic types):

```solidity
bytes32 revealHash = keccak256(
    abi.encode(reasoning, action, newAllocations, portfolioValueUSD, nonce)
);
```

The nonce is a random 32-byte value generated client-side, ensuring the hash is unpredictable.

---

## On-Chain Consensus Voting

### Why It Matters

Without consensus, the four "agents" are just sequential function calls in one file - there's no proof that each agent independently contributed. With on-chain voting:

- Each agent's vote is recorded with its own wallet signature
- The weighting is computed on-chain, not in TypeScript
- Anyone can verify that the final allocation came from the consensus formula
- Failed rounds (no quorum or low confidence) are recorded too

### Sub-Agent Wallet Derivation

Since the agents run in one process, we derive 4 deterministic wallets from the main private key:

```typescript
// For each role: market, yield, risk, portfolio
const derivedKey = keccak256(
  solidityPacked(["bytes32", "string"], [privateKey, roleName])
);
const subWallet = new Wallet(derivedKey, provider);
```

Each wallet is registered in the AgentConsensus contract with its role. The derivation is deterministic - the same private key always produces the same sub-agent wallets.

### Confidence Weighting

The consensus uses confidence-weighted averaging rather than simple majority:

```
finalAllocation[asset] = sum(vote[i].allocation[asset] * vote[i].confidence) / sum(vote[i].confidence)
```

This means a Market agent with 90% confidence has more influence than a Risk agent with 40% confidence on the same asset. This is intentional - agents that are more certain about their analysis should have more say.

---

## Verifiable Reputation System

### Why It Matters

The original Agent Identity NFT tracked `totalDecisions` and `cumulativeROIBps` - both written by the agent itself. There's no way for an external observer to verify those numbers.

The new reputation system computes metrics on-chain from actual decision outcomes:

- The agent calls `recordDecisionOutcome(tokenId, portfolioValue, confidence)` after each cycle
- The contract compares the new portfolio value to the previous one
- Win/loss, drawdown, streak, and confidence are all tracked in contract storage
- `computeReputation(tokenId)` is a **public view function** - anyone can call it and get the real numbers

### Verification

A judge or user can:
1. Look up the agent's token ID from `agentToToken(agentAddress)`
2. Call `computeReputation(tokenId)` - returns win rate, avg confidence, max drawdown, streak, accuracy score
3. These numbers are computed from on-chain data that the agent cannot fake without failing the commit-reveal check

---

## Agent Decision Cycle

The complete cycle runs every 5 minutes (configurable via `AGENT_INTERVAL_MS`):

```
1. Fetch market data (CoinGecko prices, protocol yields)
2. Market Intelligence Agent analyzes prices
3. Yield Optimization Agent analyzes yields
4. Risk Management Agent evaluates risk
5. Portfolio Manager Agent computes allocation
6. Gemini AI enhances reasoning and may adjust allocations
7. Start consensus round on AgentConsensus contract
8. Each sub-agent submits vote with confidence score
9. Resolve consensus round (weighted average)
10. Commit decision hash to DecisionLogger
11. Check autonomous rules (max trades/day, confidence threshold)
12. If approved: execute rebalance on SentinelVault
13. Reveal decision data to DecisionLogger (verify against commit)
14. Record decision outcome on AgentIdentity (reputation update)
15. Update identity metadata (total decisions, ROI)
16. Log activity and notify via Telegram
```

---

## Dashboard

The Next.js dashboard provides real-time visibility into the agent's operations.

### Components

| Component | What It Shows |
|-----------|--------------|
| **AgentStatus** | Agent name, strategy, wallet address, decisions count, ROI, uptime, and on-chain reputation (win rate, avg confidence, streak, max drawdown, accuracy score) |
| **PortfolioChart** | Asset allocation pie chart with live balances and USD values |
| **DecisionLog** | Recent decisions with reasoning, allocations, risk level, and verification status |
| **YieldComparison** | Current yields across assets with APY rankings |
| **AITerminal** | Live feed of agent analysis and decision-making |
| **AutonomousSettings** | Configure autonomous trading rules (max trades/day, confidence threshold) |
| **RebalanceHistory** | Historical rebalance events from on-chain data |
| **AgentLeaderboard** | Compare multiple agent strategies with on-chain verified metrics |

### API Routes

| Route | Description |
|-------|-------------|
| `/api/agent-status` | Agent metadata + reputation from AgentIdentity contract |
| `/api/portfolio` | Live portfolio balances and USD values from SentinelVault |
| `/api/decisions` | Recent decisions from DecisionLogger |
| `/api/agent-cycle` | Trigger a manual agent cycle |
| `/api/autonomous` | Get/set autonomous trading rules |

---

## Deployment Guide

### Prerequisites

- Node.js 18+
- A wallet with MNT on Mantle Mainnet (at least 0.5 MNT for gas)
- Small amounts of USDY, mETH, and USDC on Mantle for demo deposits

### Steps

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Fill in:
   ```env
   PRIVATE_KEY=your_private_key_here
   MANTLE_MAINNET_RPC=https://rpc.mantle.xyz
   OPENAI_API_KEY=your_gemini_api_key  # for AI reasoning
   ```

3. **Compile contracts:**
   ```bash
   npm run compile
   ```

4. **Run tests to verify:**
   ```bash
   npm run test
   ```

5. **Deploy to Mantle Mainnet:**
   ```bash
   npm run deploy
   ```
   This deploys: SentinelVault, DecisionLogger, AgentIdentity, AgentConsensus, MerchantMoeAdapter. Copy the output addresses into your `.env`.

6. **Start the agent:**
   ```bash
   npm run agent
   ```

7. **Start the dashboard:**
   ```bash
   npm run dev
   ```

8. **Deposit tokens:**
   Use the dashboard or interact directly with the vault contract to deposit small amounts of USDY, mETH, and USDC.

### Getting Tokens for Demo

- **MNT**: Buy on any exchange that supports Mantle, send to your deployer wallet
- **USDY**: Bridge from Ethereum or buy on Mantle DEXs
- **mETH**: Stake ETH on Mantle or buy on DEXs
- **USDC**: Bridge from Ethereum via https://bridge.mantle.xyz

For a demo video, 0.1 of each token is enough - the contracts work at any amount.

---

## Security Considerations

### Access Control
- SentinelVault: Only the authorized `agent` address can call `rebalance()` and `rebalanceWithSwap()`
- DecisionLogger: Only the authorized `agent` or `owner` can log decisions and commit hashes
- AgentIdentity: Only the authorized `updater` or `owner` can update metadata and record outcomes
- AgentConsensus: Only registered agents can start rounds, submit votes, and resolve

### Safety Limits
- **60% concentration cap**: No single asset can exceed 60% of the portfolio (enforced on-chain)
- **Allocation sum validation**: All allocations must sum to exactly 10000 bps (100%)
- **Reentrancy protection**: All state-changing functions use OpenZeppelin's ReentrancyGuard
- **Slippage protection**: DEX swaps enforce minimum output amounts (2% tolerance)
- **Autonomous rules**: Configurable limits on trades per day, minimum confidence, and maximum allocation changes

### What's Not Covered
- The commit-reveal scheme proves ordering (decided before acting) but does not prove the AI model itself ran correctly - that would require zero-knowledge ML proofs, which are beyond the scope of this project
- Sub-agent wallets are derived deterministically from the main key - in a production system, these would be separate hardware wallets or multi-sig setups
- Price data comes from CoinGecko APIs - a production system would use on-chain oracles like Chainlink or Pyth

---

## Testing

### Running Tests

```bash
npx hardhat test
```

### Test Coverage

**62 tests** across 3 test files:

**SentinelVault.test.ts** (30 tests):
- Deployment: agent, owner, supported assets, zero address rejection
- Deposits: supported assets, unsupported rejection, zero amount, events
- Withdrawals: normal, over-withdrawal, zero amount
- Rebalance: agent execution, non-agent rejection, 10000 bps sum, 60% cap, empty assets, events, count tracking
- RebalanceWithSwap: no router, mismatched arrays
- Portfolio view: data correctness
- Access control: agent change, non-owner rejection
- DecisionLogger: logging, authorization, recent decisions, unverified flag
- AgentIdentity: registration, metadata, tokenURI, reputation defaults, win/loss tracking

**CommitReveal.test.ts** (10 tests):
- Commit: acceptance, events, empty hash rejection, authorization, multiple commits
- Verified reveal: correct hash match, event emission
- Unverified reveal: tampered data detection, wrong nonce, double-reveal prevention

**AgentConsensus.test.ts** (20 tests):
- Deployment: asset count, quorum, confidence threshold, zero asset rejection
- Registration: role assignment, unregistered rejection
- Voting: round creation, valid votes, duplicate rejection, sum validation, cap enforcement, confidence limit
- Resolution: quorum + weighted average, confidence weighting, quorum failure, confidence failure, double-resolve, events
- Views: vote details, quorum adjustment
