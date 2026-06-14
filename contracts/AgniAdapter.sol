// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ISwapRouter.sol";

/**
 * @title AgniAdapter
 * @notice Adapter that wraps Agni Finance's V3 SwapRouter to match our ISwapRouter interface.
 * Allows SentinelVault to execute real DEX swaps on Mantle mainnet via Agni (Uniswap V3 fork).
 */

interface IAgniV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
}

interface IAgniV3Quoter {
    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut);
}

contract AgniAdapter is ISwapRouter, Ownable {
    using SafeERC20 for IERC20;

    IAgniV3Router public immutable agniRouter;
    IAgniV3Quoter public immutable agniQuoter;

    // Fee tier per token pair (e.g., 100 = 0.01%, 500 = 0.05%, 3000 = 0.3%)
    mapping(bytes32 => uint24) public pairFeeTiers;

    event FeeTierSet(address indexed tokenA, address indexed tokenB, uint24 fee);

    constructor(address _router, address _quoter) Ownable(msg.sender) {
        require(_router != address(0), "AgniAdapter: zero router");
        require(_quoter != address(0), "AgniAdapter: zero quoter");
        agniRouter = IAgniV3Router(_router);
        agniQuoter = IAgniV3Quoter(_quoter);
    }

    /**
     * @notice Set the fee tier for a token pair (used for routing)
     */
    function setFeeTier(address tokenA, address tokenB, uint24 fee) external onlyOwner {
        require(fee > 0, "AgniAdapter: zero fee");
        bytes32 key = _pairKey(tokenA, tokenB);
        pairFeeTiers[key] = fee;
        emit FeeTierSet(tokenA, tokenB, fee);
    }

    /**
     * @notice Execute a swap via Agni V3 Router
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external override returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");

        uint24 fee = pairFeeTiers[_pairKey(tokenIn, tokenOut)];
        require(fee > 0, "Fee tier not configured");

        // Transfer tokens from caller
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Approve Agni Router
        IERC20(tokenIn).approve(address(agniRouter), amountIn);

        // Execute swap via Agni V3
        amountOut = agniRouter.exactInputSingle(
            IAgniV3Router.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender, // Send output directly to caller (vault)
                deadline: block.timestamp + 300, // 5 minute deadline
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0 // No price limit
            })
        );
    }

    /**
     * @notice Get expected output amount (estimate) via Agni Quoter
     */
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external override returns (uint256) {
        uint24 fee = pairFeeTiers[_pairKey(tokenIn, tokenOut)];
        if (fee == 0) return 0;

        try agniQuoter.quoteExactInputSingle(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            0 // No price limit
        ) returns (uint256 amountOut) {
            return amountOut;
        } catch {
            return 0;
        }
    }

    function _pairKey(address tokenA, address tokenB) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            tokenA < tokenB ? tokenA : tokenB,
            tokenA < tokenB ? tokenB : tokenA
        ));
    }

    /**
     * @notice Recover tokens sent to this contract by mistake
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}
