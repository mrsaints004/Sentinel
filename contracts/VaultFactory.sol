// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./SentinelVault.sol";
import "./DecisionLogger.sol";

contract VaultFactory is Ownable {
    struct VaultInfo {
        address vault;
        address logger;
        uint256 createdAt;
    }

    address public platformAgent;
    address public defaultSwapRouter;
    mapping(address => VaultInfo) public vaults;
    address[] public vaultOwners;

    // Default supported assets (set by owner after deploy)
    address[] public defaultAssets;
    string[] public defaultAssetNames;

    event VaultCreated(address indexed owner, address vault, address logger);
    event DefaultAssetsUpdated(address[] assets, string[] names);
    event DefaultSwapRouterUpdated(address indexed router);

    constructor(address _platformAgent) Ownable(msg.sender) {
        require(_platformAgent != address(0), "VaultFactory: zero agent");
        platformAgent = _platformAgent;
    }

    function setDefaultAssets(address[] calldata assets, string[] calldata names) external onlyOwner {
        require(assets.length == names.length, "Length mismatch");
        defaultAssets = assets;
        defaultAssetNames = names;
        emit DefaultAssetsUpdated(assets, names);
    }

    function setDefaultSwapRouter(address _router) external onlyOwner {
        defaultSwapRouter = _router;
        emit DefaultSwapRouterUpdated(_router);
    }

    function createVault() external returns (address vault, address logger) {
        require(vaults[msg.sender].vault == address(0), "VaultFactory: vault exists");

        // Deploy new SentinelVault with platform agent
        SentinelVault newVault = new SentinelVault(platformAgent);
        // Deploy new DecisionLogger with platform agent
        DecisionLogger newLogger = new DecisionLogger(platformAgent);

        // Add default supported assets to the vault
        for (uint256 i = 0; i < defaultAssets.length; i++) {
            newVault.addSupportedAsset(defaultAssets[i], defaultAssetNames[i]);
        }

        // Set swap router BEFORE transferring ownership
        if (defaultSwapRouter != address(0)) {
            newVault.setSwapRouter(defaultSwapRouter);
        }

        // Transfer ownership to the user
        newVault.transferOwnership(msg.sender);
        newLogger.transferOwnership(msg.sender);

        vaults[msg.sender] = VaultInfo({
            vault: address(newVault),
            logger: address(newLogger),
            createdAt: block.timestamp
        });
        vaultOwners.push(msg.sender);

        emit VaultCreated(msg.sender, address(newVault), address(newLogger));
        return (address(newVault), address(newLogger));
    }

    function getVault(address owner) external view returns (address vault, address logger, uint256 createdAt) {
        VaultInfo storage info = vaults[owner];
        return (info.vault, info.logger, info.createdAt);
    }

    function getAllVaults() external view returns (address[] memory owners, VaultInfo[] memory infos) {
        uint256 len = vaultOwners.length;
        owners = new address[](len);
        infos = new VaultInfo[](len);
        for (uint256 i = 0; i < len; i++) {
            owners[i] = vaultOwners[i];
            infos[i] = vaults[vaultOwners[i]];
        }
    }

    function vaultCount() external view returns (uint256) {
        return vaultOwners.length;
    }

    function setPlatformAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "VaultFactory: zero agent");
        platformAgent = _agent;
    }
}
