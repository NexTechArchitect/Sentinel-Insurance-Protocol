const fs = require('fs');
const path = require('path');

const FOUNDRY_OUT_DIR = path.join(__dirname, '../out');
const TARGET_ABI_DIR = path.join(__dirname, 'src/constants/abis');

const CONTRACTS_TO_EXTRACT = [
    'PolicyEngine',
    'CoveragePool',
    'RiskRegistry',
    'ClaimsGovernor',
    'ShieldToken',
    'VetoCouncil',
    'PolicyNFT'
];

function extractAbis() {
    console.log('🔄 Extracting clean ABIs from Foundry artifacts...');
    
    if (!fs.existsSync(TARGET_ABI_DIR)) {
        fs.mkdirSync(TARGET_ABI_DIR, { recursive: true });
    }

    CONTRACTS_TO_EXTRACT.forEach(contractName => {
        const artifactPath = path.join(FOUNDRY_OUT_DIR, `${contractName}.sol`, `${contractName}.json`);
        
        if (fs.existsSync(artifactPath)) {
            const rawData = fs.readFileSync(artifactPath, 'utf8');
            const parsedData = JSON.parse(rawData);
            
            if (parsedData.abi) {
                const targetPath = path.join(TARGET_ABI_DIR, `${contractName}.json`);
                // Sirf pure abi array ko save kar rahe hain, baaki kachra dropped!
                fs.writeFileSync(targetPath, JSON.stringify(parsedData.abi, null, 2));
                console.log(`✅ Extracted clean ABI for: ${contractName}`);
            } else {
                console.log(`⚠️ No ABI found inside artifact for ${contractName}`);
            }
        } else {
            console.log(`❌ Artifact missing for ${contractName} at: ${artifactPath}. Did you run forge build?`);
        }
    });

    console.log('🚀 ABI extraction pipeline complete!');
}

extractAbis();