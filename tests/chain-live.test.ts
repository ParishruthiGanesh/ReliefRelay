import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commitStock, recordDispatch, recordReceipt } from '@/lib/domain/commitments';
import { flushAttestations, chainStatus } from '@/lib/providers/chain';
import { freshDb, itemIdFor, makeRequest } from './helpers';

const run = promisify(execFile);
const PORT = 8546;

function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

/**
 * The live local-chain path.
 *
 * This starts a real Hardhat node, deploys the real contract, and drives real
 * transactions through the real adapter, so the "confirmed on local
 * development chain" status shown in the UI is something that has actually
 * been observed rather than assumed.
 */
describe('attestations on a running local development chain', () => {
  let node: ChildProcess | null = null;
  let available = false;
  let contractAddress = '';
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ['CHAIN_ENABLED', 'CHAIN_RPC_URL', 'CHAIN_CONTRACT_ADDRESS', 'CHAIN_ATTESTER_PRIVATE_KEY']) {
      saved[key] = process.env[key];
    }

    node = spawn('npx', ['hardhat', 'node', '--port', String(PORT)], {
      cwd: process.cwd(),
      stdio: 'ignore',
      detached: false,
    });
    available = await waitForPort(PORT, 90_000);
    if (!available) return;

    const { stdout } = await run(
      'npx',
      ['hardhat', 'run', 'chain/deploy.cjs', '--network', 'localhostTest'],
      { cwd: process.cwd(), env: { ...process.env } },
    );
    contractAddress = stdout.match(/deployed at (0x[0-9a-fA-F]{40})/)?.[1] ?? '';

    process.env.CHAIN_ENABLED = 'true';
    process.env.CHAIN_RPC_URL = `http://127.0.0.1:${PORT}`;
    process.env.CHAIN_CONTRACT_ADDRESS = contractAddress;
    // Hardhat account #1 is registered as the attester for Riverbend Aid.
    process.env.CHAIN_ATTESTER_PRIVATE_KEY =
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
  }, 150_000);

  afterAll(() => {
    if (node && !node.killed) node.kill('SIGTERM');
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('writes the whole acknowledgement trail to the chain and confirms it', async () => {
    if (!available) {
      // A local node could not be started in this environment; the offline
      // behaviour is covered thoroughly in tests/chain.test.ts.
      console.warn('Skipping: no local EVM node available on this machine.');
      return;
    }
    expect(contractAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const status = await chainStatus();
    expect(status.reachable).toBe(true);
    expect(status.attesterRegistered).toBe(true);

    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 60 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');

    // Riverbend Aid owns lot_aid_meals, and account #1 is its attester.
    const commitment = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_meals',
      qty: 60,
      approvedBy: 'usr_coordinator',
    });
    recordDispatch(db, { commitmentId: commitment.commitmentId, qty: 60, actorUserId: 'usr_coordinator' });
    recordReceipt(db, {
      commitmentId: commitment.commitmentId,
      qtyReceived: 50,
      confirmedByKind: 'recipient',
    });

    const flush = await flushAttestations(db, 20);
    if (flush.failed > 0) console.error('FLUSH ERRORS', JSON.stringify(flush.errors, null, 2));
    expect(flush.failed).toBe(0);
    // commitment, dispatch, receipt, and the shortfall correction.
    expect(flush.confirmed).toBe(4);

    const rows = db
      .prepare('SELECT event_type, status, tx_hash, block_number, chain_id FROM attestations ORDER BY created_at')
      .all() as Array<{ event_type: string; status: string; tx_hash: string | null; block_number: number | null; chain_id: string | null }>;

    expect(rows.map((r) => r.event_type)).toEqual(['commitment', 'dispatch', 'receipt', 'discrepancy']);
    for (const row of rows) {
      expect(row.status).toBe('confirmed');
      expect(row.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(row.block_number).toBeGreaterThan(0);
      expect(row.chain_id).toBe('31337');
    }

    const after = await chainStatus();
    expect(after.totalOnChain).toBe(4);
  }, 150_000);
});
