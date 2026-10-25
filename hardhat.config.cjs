require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');

/**
 * Local-only EVM development network.
 *
 * The accounts below are Hardhat's well-known deterministic development
 * accounts. They hold no real value and must never be used on a public
 * network. Nothing in this project is configured to deploy anywhere else.
 *
 * @type {import('hardhat/config').HardhatUserConfig}
 */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: {
    sources: './contracts',
    tests: './chain/test',
    cache: './cache',
    artifacts: './artifacts',
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: 'http://127.0.0.1:8545', chainId: 31337 },
    // Used by tests/chain-live.test.ts so a test run never collides with a
    // node the developer already has open on the default port.
    localhostTest: { url: 'http://127.0.0.1:8546', chainId: 31337 },
  },
};
