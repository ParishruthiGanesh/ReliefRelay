const { expect } = require('chai');
const { ethers } = require('hardhat');

const ORG_A = '0x1111111111111111111111111111111111111111111111111111111111111111';
const ORG_B = '0x2222222222222222222222222222222222222222222222222222222222222222';
const SUBJECT = '0xaaaa000000000000000000000000000000000000000000000000000000000001';
const HASH_1 = '0xbbbb000000000000000000000000000000000000000000000000000000000001';
const HASH_2 = '0xbbbb000000000000000000000000000000000000000000000000000000000002';
const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';

const COMMITMENT = 0;
const DISPATCH = 1;
const RECEIPT = 2;
const DISCREPANCY = 3;

describe('SupplyAttestations', function () {
  async function deploy() {
    const [admin, orgA, orgB, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('SupplyAttestations');
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    await contract.registerAttester(await orgA.getAddress(), ORG_A);
    await contract.registerAttester(await orgB.getAddress(), ORG_B);
    return { contract, admin, orgA, orgB, stranger };
  }

  it('records a commitment and reads it back', async function () {
    const { contract, orgA } = await deploy();
    await expect(contract.connect(orgA).record(ORG_A, SUBJECT, HASH_1, COMMITMENT))
      .to.emit(contract, 'AttestationRecorded');

    expect(await contract.total()).to.equal(1n);
    const record = await contract.get(0);
    expect(record.orgRef).to.equal(ORG_A);
    expect(record.subjectRef).to.equal(SUBJECT);
    expect(record.manifestHash).to.equal(HASH_1);
    expect(Number(record.eventType)).to.equal(COMMITMENT);
    expect(record.attester).to.equal(await orgA.getAddress());
  });

  it('refuses an unregistered attester', async function () {
    const { contract, stranger } = await deploy();
    await expect(
      contract.connect(stranger).record(ORG_A, SUBJECT, HASH_1, COMMITMENT),
    ).to.be.revertedWithCustomError(contract, 'NotAttester');
  });

  it('refuses one organisation acknowledging as another', async function () {
    const { contract, orgB } = await deploy();
    await expect(
      contract.connect(orgB).record(ORG_A, SUBJECT, HASH_1, COMMITMENT),
    ).to.be.revertedWithCustomError(contract, 'OrgMismatch');
  });

  it('refuses empty references and hashes', async function () {
    const { contract, orgA } = await deploy();
    await expect(
      contract.connect(orgA).record(ORG_A, SUBJECT, ZERO, COMMITMENT),
    ).to.be.revertedWithCustomError(contract, 'ZeroValue');
    await expect(
      contract.connect(orgA).record(ORG_A, ZERO, HASH_1, COMMITMENT),
    ).to.be.revertedWithCustomError(contract, 'ZeroValue');
  });

  it('is append-only: a correction is appended, the original is unchanged', async function () {
    const { contract, orgA } = await deploy();
    await contract.connect(orgA).record(ORG_A, SUBJECT, HASH_1, DISPATCH);
    await contract.connect(orgA).record(ORG_A, SUBJECT, HASH_2, DISCREPANCY);

    expect(await contract.total()).to.equal(2n);
    const original = await contract.get(0);
    expect(original.manifestHash).to.equal(HASH_1);
    expect(Number(original.eventType)).to.equal(DISPATCH);
    const correction = await contract.get(1);
    expect(Number(correction.eventType)).to.equal(DISCREPANCY);

    // There is no function that could have changed record 0.
    expect(contract.interface.fragments.filter((f) => f.type === 'function' && !f.constant).map((f) => f.name))
      .to.not.include.members(['update', 'amend', 'remove', 'delete']);
  });

  it('keeps a per-subject trail across two organisations', async function () {
    const { contract, orgA, orgB } = await deploy();
    await contract.connect(orgA).record(ORG_A, SUBJECT, HASH_1, COMMITMENT);
    await contract.connect(orgB).record(ORG_B, SUBJECT, HASH_2, COMMITMENT);
    await contract.connect(orgA).record(ORG_A, SUBJECT, HASH_1, RECEIPT);

    const indices = await contract.indicesForSubject(SUBJECT);
    expect(indices.map(Number)).to.deep.equal([0, 1, 2]);

    const trail = await contract.attestationsForSubject(SUBJECT);
    expect(trail).to.have.length(3);
    expect(trail[1].orgRef).to.equal(ORG_B);

    const orgATrail = await contract.indicesForOrg(ORG_A);
    expect(orgATrail.map(Number)).to.deep.equal([0, 2]);
  });

  it('only the admin may register or revoke attesters', async function () {
    const { contract, orgA, stranger } = await deploy();
    await expect(
      contract.connect(stranger).registerAttester(await stranger.getAddress(), ORG_A),
    ).to.be.revertedWithCustomError(contract, 'NotAdmin');

    await contract.revokeAttester(await orgA.getAddress());
    await expect(
      contract.connect(orgA).record(ORG_A, SUBJECT, HASH_1, COMMITMENT),
    ).to.be.revertedWithCustomError(contract, 'NotAttester');
  });
});
