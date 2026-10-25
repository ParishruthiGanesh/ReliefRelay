/**
 * Deploys SupplyAttestations to the local development network and registers one
 * development identity per fictional organisation.
 *
 * The private keys used here are Hardhat's well-known deterministic accounts.
 * They hold nothing and exist only so the demonstration can show separate
 * organisations signing their own acknowledgements.
 */
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('hardhat');

// Kept in step with src/lib/db/seed-data.ts.
const ORGANIZATIONS = [
  { id: 'org_riverbend_aid', signerIndex: 1, chainOrgRef: '0x1111111111111111111111111111111111111111111111111111111111111111' },
  { id: 'org_northfield_trust', signerIndex: 2, chainOrgRef: '0x2222222222222222222222222222222222222222222222222222222222222222' },
  { id: 'org_southgate_foods', signerIndex: 3, chainOrgRef: '0x3333333333333333333333333333333333333333333333333333333333333333' },
];

async function main() {
  const signers = await ethers.getSigners();
  const admin = signers[0];
  const network = await ethers.provider.getNetwork();

  const factory = await ethers.getContractFactory('SupplyAttestations', admin);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  const registered = [];
  for (const org of ORGANIZATIONS) {
    const signer = signers[org.signerIndex];
    if (!signer) throw new Error(`No local signer at index ${org.signerIndex}`);
    const attester = await signer.getAddress();
    const tx = await contract.registerAttester(attester, org.chainOrgRef);
    await tx.wait();
    registered.push({ ...org, attester, privateKeyHint: `hardhat account #${org.signerIndex}` });
  }

  const deployment = {
    network: network.name,
    chainId: String(network.chainId),
    contractAddress: address,
    admin: await admin.getAddress(),
    organizations: registered,
    deployedAt: new Date().toISOString(),
    note: 'Local development chain only. Development keys hold no value.',
  };

  const outPath = path.join(__dirname, 'deployment.local.json');
  fs.writeFileSync(outPath, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log(`SupplyAttestations deployed at ${address} on chainId ${network.chainId}`);
  console.log(`Registered ${registered.length} fictional organisation attesters.`);
  console.log(`Wrote ${outPath}\n`);
  console.log('Add these to .env.local to turn attestations on:');
  console.log('  CHAIN_ENABLED=true');
  console.log('  CHAIN_RPC_URL=http://127.0.0.1:8545');
  console.log(`  CHAIN_CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
