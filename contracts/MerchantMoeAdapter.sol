// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ISwapRouter.sol";

/**
 * @title MerchantMoeAdapter
 * @notice Adapter that wraps Merchant Moe's LB Router to match our ISwapRouter interface.
 * Allows SentinelVault to execute real DEX swaps on Mantle mainnet.
 */

interface ILBRouter {
    struct Path {
        uint256[] pairBinSteps;
        uint8[] versions;
        address[] tokenPath;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Path memory path,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);

    function getSwapOut(
        address pair,
        uint128 amountIn,
        bool swapForY
    ) external view returns (uint128 amountInLeft, uint128 amountOut, uint128 fee);
}

interface ILBFactory {
    function getLBPairInformation(
        address tokenX,
        address tokenY,
        uint256 binStep
    ) external view returns (address lbPair, bool createdByOwner, bool ignoredForRouting);

    function getAllLBPairs(
        address tokenX,
        address tokenY
    ) external view returns (address[] memory lbPairs);
}

contract MerchantMoeAdapter is ISwapRouter, Ownable {
    using SafeERC20 for IERC20;

    ILBRouter public immutable lbRouter;
    ILBFactory public immutable lbFactory;

    // Default bin steps for common pairs (configurable)
    mapping(bytes32 => uint256) public pairBinSteps;

    event BinStepSet(address indexed tokenA, address indexed tokenB, uint256 binStep);

    constructor(address _lbRouter, address _lbFactory) Ownable(msg.sender) {
        lbRouter = ILBRouter(_lbRouter);
        lbFactory = ILBFactory(_lbFactory);
    }

    /**
     * @notice Set the bin step for a token pair (used for routing)
     */
    function setBinStep(address tokenA, address tokenB, uint256 binStep) external onlyOwner {
        bytes32 key = _pairKey(tokenA, tokenB);
        pairBinSteps[key] = binStep;
        emit BinStepSet(tokenA, tokenB, binStep);
    }

    /**
     * @notice Execute a swap via Merchant Moe LB Router
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external override returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");

        // Transfer tokens from caller
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Approve LB Router
        IERC20(tokenIn).approve(address(lbRouter), amountIn);

        // Get bin step for this pair
        uint256 binStep = pairBinSteps[_pairKey(tokenIn, tokenOut)];
        require(binStep > 0, "Bin step not configured");

        // Build path
        address[] memory tokenPath = new address[](2);
        tokenPath[0] = tokenIn;
        tokenPath[1] = tokenOut;

        uint256[] memory pairBinStepsArr = new uint256[](1);
        pairBinStepsArr[0] = binStep;

        uint8[] memory versions = new uint8[](1);
        versions[0] = 2; // LB v2.2

        ILBRouter.Path memory path = ILBRouter.Path({
            pairBinSteps: pairBinStepsArr,
            versions: versions,
            tokenPath: tokenPath
        });

        // Execute swap
        amountOut = lbRouter.swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            path,
            msg.sender, // Send output directly to caller (vault)
            block.timestamp + 300 // 5 minute deadline
        );
    }

    /**
     * @notice Get expected output amount (estimate)
     */
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view override returns (uint256) {
        uint256 binStep = pairBinSteps[_pairKey(tokenIn, tokenOut)];
        if (binStep == 0) return 0;

        // Try to get the LB pair and quote
        try lbFactory.getLBPairInformation(tokenIn, tokenOut, binStep) returns (
            address lbPair, bool, bool
        ) {
            if (lbPair == address(0)) return 0;
            try lbRouter.getSwapOut(lbPair, uint128(amountIn), true) returns (
                uint128, uint128 amountOut, uint128
            ) {
                return uint256(amountOut);
            } catch {
                return 0;
            }
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
