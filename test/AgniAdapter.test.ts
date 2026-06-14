import { expect } from "chai";
import { ethers, network } from "hardhat";

/**
 * AgniAdapter tests — unit tests always run, fork tests run against Mantle mainnet.
 *
 * Unit tests: npx hardhat test test/AgniAdapter.test.ts
 * Fork tests: FORK_MANTLE=1 npx hardhat test test/AgniAdapter.test.ts
 */

// Real Agni Finance V3 contracts on Mantle
const AGNI_ROUTER = "0x319B69888b0d11cEC22caA5034e25FfFBDc88421";
const AGNI_QUOTER = "0x9488C05a7b75a6FefdcAE4f11a33467bcBA60177";

// Real token addresses on Mantle
const USDY = "0x5bE26527e817998A7206475496fDE1E68957c5A6";
const METH = "0xcDA86A272531e8640cD7F1a92c01839911B90bb0";
const USDC = "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9";

// Fee tiers matching real Agni pools with liquidity
const FEE_USDY_USDC = 100;   // USDY/USDC 0.01% pool has deepest liquidity
const FEE_METH_USDC = 10000; // mETH/USDC only has liquidity at 1%
const FEE_METH_USDY = 2500;  // mETH/USDY 0.25%

// USDC balance storage slot (verified on Mantle mainnet)
const USDC_BALANCE_SLOT = 9;

const isFork = process.env.FORK_MANTLE === "1";

// Set ERC20 balance directly via storage manipulation (works when balance slot is known)
async function setERC20Balance(tokenAddr: string, account: string, slot: number, amount: bigint) {
  const storageSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [account, slot])
  );
  await network.provider.send("hardhat_setStorageAt", [
    tokenAddr,
    storageSlot,
    ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [amount]),
  ]);
}

describe("AgniAdapter", function () {
  // --- Unit tests: pure contract logic (no mainnet dependency) ---
  describe("Deployment & Access Control", function () {
    it("should deploy with correct router and quoter addresses", async function () {
      const [owner] = await ethers.getSigners();
      const AgniAdapter = await ethers.getContractFactory("AgniAdapter");

      const routerAddr = isFork ? AGNI_ROUTER : owner.address;
      const quoterAddr = isFork ? AGNI_QUOTER : ethers.Wallet.createRandom().address;

      const adapter = await AgniAdapter.deploy(routerAddr, quoterAddr);
      expect(await adapter.agniRouter()).to.equal(routerAddr);
      expect(await adapter.agniQuoter()).to.equal(quoterAddr);
      expect(await adapter.owner()).to.equal(owner.address);
    });

    it("should reject zero router address", async function () {
      const quoterAddr = ethers.Wallet.createRandom().address;
      const AgniAdapter = await ethers.getContractFactory("AgniAdapter");
      await expect(
        AgniAdapter.deploy(ethers.ZeroAddress, quoterAddr)
      ).to.be.revertedWith("AgniAdapter: zero router");
    });

    it("should reject zero quoter address", async function () {
      const routerAddr = ethers.Wallet.createRandom().address;
      const AgniAdapter = await ethers.getContractFactory("AgniAdapter");
      await expect(
        AgniAdapter.deploy(routerAddr, ethers.ZeroAddress)
      ).to.be.revertedWith("AgniAdapter: zero quoter");
    });

    it("should allow owner to set fee tiers", async function () {
      const [owner] = await ethers.getSigners();
      const AgniAdapter = await ethers.getContractFactory("AgniAdapter");
      const adapter = await AgniAdapter.deploy(owner.address, ethers.Wallet.createRandom().address);

      await expect(adapter.setFeeTier(USDY, USDC, 100)).to.emit(adapter, "FeeTierSet");

      const key = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address"],
          USDC.toLowerCase() < USDY.toLowerCase() ? [USDC, USDY] : [USDY, USDC]
        )
      );
      expect(await adapter.pairFeeTiers(key)).to.equal(100);
    });

    it("should reject non-owner setting fee tiers", async function () {
      const [owner, other] = await ethers.getSigners();
      const AgniAdapter = await ethers.getContractFactory("AgniAdapter");
      const adapter = await AgniAdapter.deploy(owner.address, ethers.Wallet.createRandom().address);

      await expect(
        adapter.connect(other).setFeeTier(USDY, USDC, 100)
      ).to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount");
    });

    it("should reject zero fee tier", async function () {
      const [owner] = await ethers.getSigners();
      const AgniAdapter = await ethers.getContractFactory("AgniAdapter");
      const adapter = await AgniAdapter.deploy(owner.address, ethers.Wallet.createRandom().address);

      await expect(
        adapter.setFeeTier(USDY, USDC, 0)
      ).to.be.revertedWith("AgniAdapter: zero fee");
    });

    it("should revert swap on zero amount", async function () {
      const [owner] = await ethers.getSigners();
      const AgniAdapter = await ethers.getContractFactory("AgniAdapter");
      const adapter = await AgniAdapter.deploy(owner.address, ethers.Wallet.createRandom().address);

      await expect(
        adapter.swap(USDY, USDC, 0, 0)
      ).to.be.revertedWith("Zero amount");
    });

    it("should revert swap on unconfigured pair", async function () {
      const [owner] = await ethers.getSigners();
      const AgniAdapter = await ethers.getContractFactory("AgniAdapter");
      const adapter = await AgniAdapter.deploy(owner.address, ethers.Wallet.createRandom().address);

      await expect(
        adapter.swap(USDY, USDC, 1000, 0)
      ).to.be.revertedWith("Fee tier not configured");
    });

    it("should reject non-owner rescue", async function () {
      const [owner, other] = await ethers.getSigners();
      const AgniAdapter = await ethers.getContractFactory("AgniAdapter");
      const adapter = await AgniAdapter.deploy(owner.address, ethers.Wallet.createRandom().address);

      await expect(
        adapter.connect(other).rescueTokens(USDY, 1)
      ).to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount");
    });
  });

  // --- Fork tests: real Agni swaps against Mantle mainnet state ---
  (isFork ? describe : describe.skip)("Real Agni Swaps (Mantle Fork)", function () {
    this.timeout(120000);

    let adapter: any;
    let usdy: any;
    let usdc: any;
    let user: any;

    before(async function () {
      const [owner, _user] = await ethers.getSigners();
      user = _user;

      // Deploy AgniAdapter pointing at real Agni contracts
      const AgniAdapter = await ethers.getContractFactory("AgniAdapter");
      adapter = await AgniAdapter.deploy(AGNI_ROUTER, AGNI_QUOTER);

      // Configure fee tiers matching real pools with liquidity
      await adapter.setFeeTier(USDY, USDC, FEE_USDY_USDC);
      await adapter.setFeeTier(METH, USDC, FEE_METH_USDC);
      await adapter.setFeeTier(METH, USDY, FEE_METH_USDY);

      // Get real token contracts
      usdy = await ethers.getContractAt("IERC20", USDY);
      usdc = await ethers.getContractAt("IERC20", USDC);

      // Fund user with USDC by directly setting storage (slot 9)
      await setERC20Balance(USDC, user.address, USDC_BALANCE_SLOT, 100_000_000n); // 100 USDC

      const usdcBal = await usdc.balanceOf(user.address);
      console.log(`    Funded user: ${ethers.formatUnits(usdcBal, 6)} USDC`);
    });

    it("should get a real quote from Agni Quoter for USDC→USDY", async function () {
      const amountIn = 1_000_000n; // 1 USDC (6 decimals)
      const quote = await adapter.getAmountOut.staticCall(USDC, USDY, amountIn);

      console.log(`    Quote: 1 USDC → ${ethers.formatEther(quote)} USDY`);

      // Quote should return a non-zero amount (exact price depends on pool state)
      expect(quote).to.be.gt(0);
    });

    it("should get a real quote from Agni Quoter for USDY→USDC", async function () {
      // First swap USDC→USDY to get some USDY
      const usdcIn = 5_000_000n; // 5 USDC
      await usdc.connect(user).approve(await adapter.getAddress(), usdcIn);
      await adapter.connect(user).swap(USDC, USDY, usdcIn, 0);

      const usdyBal = await usdy.balanceOf(user.address);
      console.log(`    User now has ${ethers.formatEther(usdyBal)} USDY`);

      // Now get a quote for USDY→USDC
      const amountIn = ethers.parseEther("1");
      const quote = await adapter.getAmountOut.staticCall(USDY, USDC, amountIn);

      console.log(`    Quote: 1 USDY → ${ethers.formatUnits(quote, 6)} USDC`);

      // Quote should return a non-zero amount (exact price depends on pool state)
      expect(quote).to.be.gt(0);
    });

    it("should return 0 for unconfigured pair quote", async function () {
      const randomToken = ethers.Wallet.createRandom().address;
      const quote = await adapter.getAmountOut.staticCall(randomToken, USDC, ethers.parseEther("1"));
      expect(quote).to.equal(0);
    });

    it("should execute a real USDC→USDY swap on Agni", async function () {
      const amountIn = 2_000_000n; // 2 USDC (6 decimals)

      const usdcBefore = await usdc.balanceOf(user.address);
      const usdyBefore = await usdy.balanceOf(user.address);
      console.log(`    Before: ${ethers.formatUnits(usdcBefore, 6)} USDC, ${ethers.formatEther(usdyBefore)} USDY`);

      await usdc.connect(user).approve(await adapter.getAddress(), amountIn);
      await adapter.connect(user).swap(USDC, USDY, amountIn, 0);

      const usdcAfter = await usdc.balanceOf(user.address);
      const usdyAfter = await usdy.balanceOf(user.address);
      console.log(`    After:  ${ethers.formatUnits(usdcAfter, 6)} USDC, ${ethers.formatEther(usdyAfter)} USDY`);

      expect(usdcBefore - usdcAfter).to.equal(amountIn);
      const usdyReceived = usdyAfter - usdyBefore;
      expect(usdyReceived).to.be.gt(0);
      console.log(`    Received: ${ethers.formatEther(usdyReceived)} USDY for 2 USDC`);
    });

    it("should execute a real USDY→USDC swap on Agni", async function () {
      // User should have USDY from previous tests
      const usdyBal = await usdy.balanceOf(user.address);
      expect(usdyBal).to.be.gt(0, "User needs USDY from previous swap");

      const amountIn = usdyBal / 2n; // swap half the USDY

      const usdyBefore = await usdy.balanceOf(user.address);
      const usdcBefore = await usdc.balanceOf(user.address);
      console.log(`    Before: ${ethers.formatEther(usdyBefore)} USDY, ${ethers.formatUnits(usdcBefore, 6)} USDC`);

      await usdy.connect(user).approve(await adapter.getAddress(), amountIn);
      await adapter.connect(user).swap(USDY, USDC, amountIn, 0);

      const usdyAfter = await usdy.balanceOf(user.address);
      const usdcAfter = await usdc.balanceOf(user.address);
      console.log(`    After:  ${ethers.formatEther(usdyAfter)} USDY, ${ethers.formatUnits(usdcAfter, 6)} USDC`);

      expect(usdyBefore - usdyAfter).to.equal(amountIn);
      const usdcReceived = usdcAfter - usdcBefore;
      expect(usdcReceived).to.be.gt(0);
      console.log(`    Received: ${ethers.formatUnits(usdcReceived, 6)} USDC`);
    });

    it("should revert swap when minAmountOut is too high (slippage protection)", async function () {
      const amountIn = 1_000_000n; // 1 USDC
      await usdc.connect(user).approve(await adapter.getAddress(), amountIn);

      // Demand 100 USDY for 1 USDC — impossible
      await expect(
        adapter.connect(user).swap(USDC, USDY, amountIn, ethers.parseEther("100"))
      ).to.be.reverted;
    });
  });
});
