-include .env

.PHONY: compile simulation deploy-sepolia clean

# Build lifecycle parameters
compile:
	forge compile

simulation:
	forge script script/DeploySentinel.s.sol:DeploySentinel --rpc-url http://127.0.0.1:8545

deploy-sepolia:
	forge script script/DeploySentinel.s.sol:DeploySentinel --rpc-url $(SEPOLIA_RPC_URL) --broadcast --verify --etherscan-api-key $(ETHERSCAN_API_KEY)

clean:
	forge clean