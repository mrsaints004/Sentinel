// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ISwapRouter.sol";

contract SentinelVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public agent;
    address public swapRouter;
    address[] public supportedAssets;
    mapping(address => string) public assetNames;
    mapping(address => uint256) public assetBalances;
    mapping(address => uint256) public targetAllocations;
    mapping(address => bool) public isSupported;

    mapping(address => mapping(address => uint256)) public userDeposits;

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
    event SwapRouterUpdated(address indexed oldRouter, address indexed newRouter);
    event SwapExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    modifier onlyAgent() {
        require(msg.sender == agent, "SentinelVault: not agent");
        _;
    }

    constructor(address _agent) Ownable(msg.sender) {
        require(_agent != address(0), "SentinelVault: zero address");
        agent = _agent;
    }

    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "SentinelVault: zero address");
        address old = agent;
        agent = _agent;
        emit AgentUpdated(old, _agent);
    }

    function addSupportedAsset(address token, string calldata name) external onlyOwner {
        require(token != address(0), "SentinelVault: zero address");
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
        emit Deposit(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(userDeposits[msg.sender][token] >= amount, "Insufficient balance");
        userDeposits[msg.sender][token] -= amount;
        assetBalances[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, token, amount);
    }

    function rebalance(
        address[] calldata assets,
        uint256[] calldata newAllocBps
    ) external onlyAgent nonReentrant {
        require(assets.length == newAllocBps.length, "Length mismatch");
        require(assets.length > 0, "Empty assets");

        uint256 totalBps;
        uint256[] memory oldAlloc = new uint256[](assets.length);

        for (uint256 i = 0; i < assets.length; i++) {
            require(isSupported[assets[i]], "Asset not supported");
            require(newAllocBps[i] <= 6000, "Exceeds 60% limit");
            oldAlloc[i] = targetAllocations[assets[i]];
            targetAllocations[assets[i]] = newAllocBps[i];
            totalBps += newAllocBps[i];
        }
        require(totalBps == 10000, "Must sum to 100%");

        rebalanceCount++;
        lastRebalanceTimestamp = block.timestamp;
        emit Rebalance(msg.sender, assets, oldAlloc, newAllocBps, block.timestamp);
    }

    function setSwapRouter(address _router) external onlyOwner {
        require(_router != address(0), "SentinelVault: zero address");
        address old = swapRouter;
        swapRouter = _router;
        emit SwapRouterUpdated(old, _router);
    }

    /**
     * @notice Rebalance with actual token swaps via DEX router.
     * @param assets Asset addresses for target allocations.
     * @param newAllocBps Target allocation in basis points per asset.
     * @param swapTokenIn Tokens to sell.
     * @param swapTokenOut Tokens to buy.
     * @param swapAmounts Amounts of tokenIn to swap.
     * @param minAmountsOut Minimum output per swap (slippage protection).
     */
    function rebalanceWithSwap(
        address[] calldata assets,
        uint256[] calldata newAllocBps,
        address[] calldata swapTokenIn,
        address[] calldata swapTokenOut,
        uint256[] calldata swapAmounts,
        uint256[] calldata minAmountsOut
    ) external onlyAgent nonReentrant {
        require(assets.length == newAllocBps.length, "Length mismatch");
        require(assets.length > 0, "Empty assets");
        require(
            swapTokenIn.length == swapTokenOut.length &&
            swapTokenIn.length == swapAmounts.length &&
            swapTokenIn.length == minAmountsOut.length,
            "Swap arrays mismatch"
        );
        require(swapRouter != address(0), "No swap router");

        for (uint256 i = 0; i < swapTokenIn.length; i++) {
            if (swapAmounts[i] == 0) continue;
            require(assetBalances[swapTokenIn[i]] >= swapAmounts[i], "Insufficient balance for swap");

            IERC20(swapTokenIn[i]).safeIncreaseAllowance(swapRouter, swapAmounts[i]);
            uint256 amountOut = ISwapRouter(swapRouter).swap(
                swapTokenIn[i],
                swapTokenOut[i],
                swapAmounts[i],
                minAmountsOut[i]
            );
            require(amountOut >= minAmountsOut[i], "Slippage exceeded");

            assetBalances[swapTokenIn[i]] -= swapAmounts[i];
            assetBalances[swapTokenOut[i]] += amountOut;
            emit SwapExecuted(swapTokenIn[i], swapTokenOut[i], swapAmounts[i], amountOut);
        }

        uint256 totalBps;
        uint256[] memory oldAlloc = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            require(isSupported[assets[i]], "Asset not supported");
            require(newAllocBps[i] <= 6000, "Exceeds 60% limit");
            oldAlloc[i] = targetAllocations[assets[i]];
            targetAllocations[assets[i]] = newAllocBps[i];
            totalBps += newAllocBps[i];
        }
        require(totalBps == 10000, "Must sum to 100%");

        rebalanceCount++;
        lastRebalanceTimestamp = block.timestamp;
        emit Rebalance(msg.sender, assets, oldAlloc, newAllocBps, block.timestamp);
    }

    function getPortfolio()
        external view
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

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(!isSupported[token], "Cannot rescue supported asset");
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}
