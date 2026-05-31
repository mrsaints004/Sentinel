# Mantle Treasury AI

**An Autonomous On-Chain Treasury Manager Powered by AI Agents**

Built for Turing Test Hackathon 2026 | Tracks: **Agentic Wallets & Economy** + **AI x RWA**

## The Problem

Participating in DeFi is still difficult. Users must constantly monitor markets, compare yields, track risk, and execute transactions manually. Capital sits idle, opportunities are missed, and risk is poorly managed.

## The Solution

An AI Treasury Agent that acts as your personal on-chain Chief Investment Officer. It continuously analyzes markets, monitors yields, evaluates risk, rebalances portfolios, executes transactions, and explains every decision — all transparently on Mantle.

## Architecture

```
User (Dashboard / Telegram)
         │
    ┌────┴────┐
    │  Web UI  │  Telegram Bot
    └────┬────┘      │
         │           │
    ┌────┴───────────┴────────────────┐
    │     Multi-Agent Intelligence     │
    │                                  │
    │  ┌─────────┐  ┌──────────────┐  │
    │  │ Market   │  │ Yield        │  │
    │  │ Intel    │  │ Optimization │  │
    │  └────┬────┘  └──────┬───────┘  │
    │       │              │          │
    │  ┌────┴────┐  ┌──────┴───────┐  │
    │  │ Risk     │  │ Portfolio    │  │
    │  │ Mgmt     │  │ Manager     │  │
    │  └─────────┘  └──────────────┘  │
    └──────────────┬──────────────────┘
                   │
    ┌──────────────┴──────────────────┐
    │      Mantle Smart Contracts      │
    │  SentinelVault │ DecisionLogger  │
    │  AgentIdentity (ERC-8004)        │
    └─────────────────────────────────┘
```

## Features

- **Multi-Agent System** — 4 specialized AI agents (Market Intelligence, Yield Optimization, Risk Management, Portfolio Manager)
- **Telegram Bot** — Natural language interaction, portfolio queries, trade approvals
- **Treasury Creation** — Users choose risk profile (Conservative/Moderate/Aggressive)
- **Approval Flow** — Agent recommends, user approves or auto-executes
- **Agent Leaderboard** — Compare competing AI strategies with on-chain verified performance
- **ERC-8004 Identity** — Each agent gets an NFT tracking decisions, ROI, win rate
- **On-Chain Transparency** — Every decision logged with reasoning on Mantle
- **Live AI Terminal** — Watch the agent think, analyze, and execute in real-time

## Quick Start

```bash
npm install
npx hardhat compile
npx hardhat test          # 19 tests passing

# Deploy to Mantle Testnet
cp .env.example .env      # fill in keys
npx hardhat run scripts/deploy.ts --network mantleTestnet

# Run AI agent
npm run agent

# Start Telegram bot
npm run telegram

# Start dashboard
npm run dev
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile smart contracts |
| `npm run test` | Run 19 contract tests |
| `npm run deploy:testnet` | Deploy to Mantle Sepolia |
| `npm run agent` | Start multi-agent system |
| `npm run telegram` | Start Telegram bot |
| `npm run dev` | Start dashboard (localhost:3000) |

## Smart Contracts

| Contract | Description |
|----------|-------------|
| **SentinelVault** | Holds funds, executes agent-directed rebalances. Deposit/withdraw/rebalance with agent-only access control |
| **DecisionLogger** | On-chain decision log with reasoning, allocations, risk level. Queryable history |
| **AgentIdentity** | ERC-721 (ERC-8004) NFT with on-chain JSON metadata — name, strategy, decisions, ROI |

## Multi-Agent System

| Agent | Role |
|-------|------|
| **Market Intelligence** | Monitors price trends, ETH momentum, volatility, sentiment signals |
| **Yield Optimization** | Tracks yields across Mantle protocols, ranks capital efficiency |
| **Risk Management** | Concentration analysis, depeg detection, drawdown estimation, exposure limits |
| **Portfolio Manager** | Combines all agent outputs, applies risk profile, makes final allocation decision |

## Telegram Bot

Users interact via natural language:

- "How is my treasury doing?" — Portfolio status
- "Why did you buy mETH?" — AI reasoning explanation
- "What are my risks?" — Risk assessment
- `/portfolio` `/yields` `/risk` `/agents` — Quick commands
- `/setrisk` — Change risk profile
- `/approve` `/reject` — Trade approval flow

## User Journey

1. Connect wallet on dashboard
2. Create treasury with deposit amount + risk profile
3. AI agent starts managing portfolio
4. User monitors via dashboard or Telegram
5. Agent recommends trades, user approves (or auto-approves)
6. Every decision recorded on-chain with full reasoning

## Tech Stack

- Solidity 0.8.26 + OpenZeppelin v5
- Hardhat + ethers v6
- Next.js 14 + Tailwind CSS + Recharts
- Telegram Bot API (node-telegram-bot-api)
- OpenAI GPT-4 (with rule-based fallback)
- Mantle Sepolia Testnet (chainId 5003)
- ERC-8004 Agent Identity Standard
