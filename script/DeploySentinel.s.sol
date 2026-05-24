// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {RiskRegistry} from "../src/registry/RiskRegistry.sol";
import {ShieldToken} from "../src/governance/ShieldToken.sol";
import {PolicyNFT} from "../src/token/PolicyNFT.sol";
import {CoveragePool} from "../src/core/CoveragePool.sol";
import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {ClaimsGovernor} from "../src/core/ClaimsGovernor.sol";
import {PayoutExecutor} from "../src/core/PayoutExecutor.sol";
import {VetoCouncil} from "../src/governance/VetoCouncil.sol";

/**
 * @title   DeploySentinel
 * @author  NexTechArchitect
 * @notice  Master deployment script orchestration for the SentinelShield protocol ecosystem.
 * @dev     Executes sequential atomic deployment and cross-contract linking within a single script context.
 */
contract DeploySentinel is Script {
    function run() external {
        // Load configurations from ambient environment matrix
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("SEPOLIA_USDC_ADDRESS");
        address aavePool = vm.envAddress("SEPOLIA_AAVE_POOL_ADDRESS");
        address aUsdc = vm.envAddress("SEPOLIA_A_USDC_ADDRESS");

        // Validate ambient environment addresses before hitting the EVM infrastructure
        require(usdc != address(0), "DeploySentinel: Invalid USDC address");
        require(aavePool != address(0), "DeploySentinel: Invalid Aave Pool address");
        require(aUsdc != address(0), "DeploySentinel: Invalid aUSDC address");

        // Initialize state broadcasting to the target EVM infrastructure
        vm.startBroadcast(deployerPrivateKey);
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Starting SentinelShield Protocol Deployment");
        console.log("Deployer Account Authority:", deployer);

        // 1. RiskRegistry Deployment Phase
        RiskRegistry registry = new RiskRegistry();
        console.log("Contract deployed: RiskRegistry at", address(registry));

        // 2. Governance Token Deployment Phase
        ShieldToken shield = new ShieldToken();
        console.log("Contract deployed: ShieldToken at", address(shield));

        // 3. Registry Token Representation Phase
        PolicyNFT nft = new PolicyNFT();
        console.log("Contract deployed: PolicyNFT at", address(nft));

        // 4. Asset Underwriting Liquidity Infrastructure Phase
        CoveragePool pool = new CoveragePool(usdc, aavePool, aUsdc);
        console.log("Contract deployed: CoveragePool at", address(pool));

        // 5. Core Policy Processing Registry Interface Phase
        PolicyEngine engine = new PolicyEngine(usdc, address(registry), address(pool), address(nft));
        console.log("Contract deployed: PolicyEngine at", address(engine));

        // 6. Decentralized Adjudication Mechanism Setup Phase
        ClaimsGovernor governor = new ClaimsGovernor(address(shield), address(engine), address(pool), 7 days);
        console.log("Contract deployed: ClaimsGovernor at", address(governor));

        // 7. Context Router / Execution Pipeline Configuration Phase
        PayoutExecutor executor = new PayoutExecutor(address(governor), address(engine), address(pool));
        console.log("Contract deployed: PayoutExecutor at", address(executor));

        // 8. Emergency System Infrastructure Deployment Phase
        address[] memory guardians = new address[](3);
        guardians[0] = deployer;
        // Fix: Use recognizable distinct public keys or real staging addresses for your multi-sig matrix
        guardians[1] = address(0x1111111111111111111111111111111111111111); 
        guardians[2] = address(0x2222222222222222222222222222222222222222); 
        VetoCouncil vetoCouncil = new VetoCouncil(address(governor), guardians, 2);
        console.log("Contract deployed: VetoCouncil at", address(vetoCouncil));

        // 9. Ecosystem Initialization & Dynamic State Authorization (Wiring)
        console.log("Executing post-deployment structural wiring initialization");
        
        nft.setPolicyEngine(address(engine));
        pool.setPolicyEngine(address(engine));
        pool.setPayoutExecutor(address(executor));
        engine.setClaimsGovernor(address(governor));
        governor.setVetoCouncil(address(vetoCouncil));
        governor.setPayoutExecutor(address(executor));

        console.log("Ecosystem state architecture successfully synchronized");
        vm.stopBroadcast();
    }
}