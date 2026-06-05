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
 * @notice  Master deployment script orchestration for the SentinelShield protocol ecosystem on Base Mainnet.
 * @dev     Executes sequential atomic deployment and cross-contract linking within a single script context.
 */
contract DeploySentinel is Script {
    function run() external {
        // Load configurations from ambient environment matrix (Base Mainnet Core Clusters)
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("BASE_USDC_ADDRESS");
        address aavePool = vm.envAddress("BASE_AAVE_POOL_ADDRESS");
        address aUsdc = vm.envAddress("BASE_A_USDC_ADDRESS");

        // Validate ambient environment addresses before hitting the EVM infrastructure
        require(usdc != address(0), "DeploySentinel: Invalid USDC address");
        require(aavePool != address(0), "DeploySentinel: Invalid Aave Pool address");
        require(aUsdc != address(0), "DeploySentinel: Invalid aUSDC address");

        // Initialize state broadcasting to the target EVM infrastructure
        vm.startBroadcast(deployerPrivateKey);
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Starting SentinelShield Protocol Deployment on Base Mainnet");
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

        // 4. Asset Underwriting Liquidity Infrastructure Phase (Triggers ERC-4626 Base Strategy)
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

        // 8. Emergency System Infrastructure Deployment Phase (Veto Council Matrix)
        address[] memory guardians = new address[](3);
        guardians[0] = deployer;
        // Production Note: Replace these placeholder addresses with your real multi-sig signers or safe cold wallets!
        guardians[1] = address(0x3333333333333333333333333333333333333333); 
        guardians[2] = address(0x4444444444444444444444444444444444444444); 
        
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