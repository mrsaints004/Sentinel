// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ISwapRouter.sol";

contract SentinelVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Asset tracking
    struct AssetAllocation {
        address token;
        string name;
        uint256 balance;
        uint256 targetBps; // basis points (10000 = 100%)
    }

    address public agent;
    address public swapRouter;
    address[] public supportedAssets;
    mapping(address => string) public assetNames;
    mapping(address => uint256) public assetBalances;
    mapping(address => uint256) public targetAllocations; // in bps
    mapping(address => bool) public isSupported;

    // User deposits
    mapping(address => mapping(address => uint256)) public userDeposits; // user => token => amount
    mapping(address => uint256) public totalDeposits; // token => total

    uint256 public totalValueUSD; // cached, updated on rebalance
    uint256 public rebalanceCount;
    uint256 public lastRebalanceTimestamp;

    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event Rebalance(
        address indexed agent,
        address[] assets,
        uint256[] oldAllocations,
        uint256[] newAllocations,
        uint256 timestamp
    );
    event AssetAdded(address indexed token, string name);
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event SwapExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    modifier onlyAgent() {
        require(msg.sender == agent, "SentinelVault: caller is not the agent");
        _;
    }

    modifier onlyAgentOrOwner() {
        require(
            msg.sender == agent || msg.sender == owner(),
            "SentinelVault: caller is not agent or owner"
        );
        _;
    }

    constructor(address _agent) Ownable(msg.sender) {
        agent = _agent;
    }

    function setAgent(address _agent) external onlyOwner {
        address old = agent;
        agent = _agent;
        emit AgentUpdated(old, _agent);
    }

    function addSupportedAsset(address token, string calldata name) external onlyOwner {
        require(!isSupported[token], "Already supported");
        supportedAssets.push(token);
        assetNames[token] = name;
        isSupported[token] = true;
        emit AssetAdded(token, name);
    }

    function deposit(address token, uint256 amount) external nonReentrant {
        require(isSupported[token], "Asset not supported");
        require(amount > 0, "Amount must be > 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        userDeposits[msg.sender][token] += amount;
        assetBalances[token] += amount;
        totalDeposits[token] += amount;

        emit Deposit(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        require(userDeposits[msg.sender][token] >= amount, "Insufficient balance");

        userDeposits[msg.sender][token] -= amount;
        assetBalances[token] -= amount;
        totalDeposits[token] -= amount;

        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, token, amount);
    }

    function rebalance(
        address[] calldata assets,
        uint256[] calldata newAllocBps
    ) external onlyAgent nonReentrant {
        require(assets.length == newAllocBps.length, "Length mismatch");

        uint256 totalBps = 0;
        uint256[] memory oldAlloc = new uint256[](assets.length);

        for (uint256 i = 0; i < assets.length; i++) {
            require(isSupported[assets[i]], "Asset not supported");
            oldAlloc[i] = targetAllocations[assets[i]];
            targetAllocations[assets[i]] = newAllocBps[i];
            totalBps += newAllocBps[i];
        }

        require(totalBps == 10000, "Allocations must sum to 100%");

        rebalanceCount++;
        lastRebalanceTimestamp = block.timestamp;

        emit Rebalance(msg.sender, assets, oldAlloc, newAllocBps, block.timestamp);
    }

    function setSwapRouter(address _router) external onlyOwner {
        swapRouter = _router;
    }

    /**
     * @notice Rebalance with actual token swaps via DEX router.
     * The agent specifies which swaps to execute to reach target allocations.
     */
    function rebalanceWithSwap(
        address[] calldata assets,
        uint256[] calldata newAllocBps,
        address[] calldata swapTokenIn,
        address[] calldata swapTokenOut,
        uint256[] calldata swapAmounts
    ) external onlyAgent nonReentrant {
        require(assets.length == newAllocBps.length, "Length mismatch");
        require(swapTokenIn.length == swapTokenOut.length && swapTokenIn.length == swapAmounts.length, "Swap length mismatch");
        require(swapRouter != address(0), "No swap router set");

        // Execute swaps
        for (uint256 i = 0; i < swapTokenIn.length; i++) {
            if (swapAmounts[i] == 0) continue;

            IERC20(swapTokenIn[i]).approve(swapRouter, swapAmounts[i]);
            uint256 amountOut = ISwapRouter(swapRouter).swap(
                swapTokenIn[i],
                swapTokenOut[i],
                swapAmounts[i],
                0 // minAmountOut - agent handles slippage check off-chain
            );

            assetBalances[swapTokenIn[i]] -= swapAmounts[i];
            assetBalances[swapTokenOut[i]] += amountOut;

            emit SwapExecuted(swapTokenIn[i], swapTokenOut[i], swapAmounts[i], amountOut);
        }

        // Update target allocations
        uint256 totalBps = 0;
        uint256[] memory oldAlloc = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            require(isSupported[assets[i]], "Asset not supported");
            oldAlloc[i] = targetAllocations[assets[i]];
            targetAllocations[assets[i]] = newAllocBps[i];
            totalBps += newAllocBps[i];
        }
        require(totalBps == 10000, "Allocations must sum to 100%");

        rebalanceCount++;
        lastRebalanceTimestamp = block.timestamp;

        emit Rebalance(msg.sender, assets, oldAlloc, newAllocBps, block.timestamp);
    }

    function getPortfolio()
        external
        view
        returns (
            address[] memory assets,
            string[] memory names,
            uint256[] memory balances,
            uint256[] memory allocations
        )
    {
        uint256 len = supportedAssets.length;
        assets = new address[](len);
        names = new string[](len);
        balances = new uint256[](len);
        allocations = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            address token = supportedAssets[i];
            assets[i] = token;
            names[i] = assetNames[token];
            balances[i] = assetBalances[token];
            allocations[i] = targetAllocations[token];
        }
    }

    function getSupportedAssets() external view returns (address[] memory) {
        return supportedAssets;
    }

    function getAssetCount() external view returns (uint256) {
        return supportedAssets.length;
    }
}
