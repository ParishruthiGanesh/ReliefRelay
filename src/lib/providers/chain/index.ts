import { ethers } from 'ethers';
import type { DB } from '@/lib/db';
import {
  markAttestationConfirmed,
  markAttestationFailed,
  pendingAttestations,
  type AttestationEventType,
} from '@/lib/domain/attestations';

/**
 * Local-chain attestation adapter.
 *
 * The design point: relief work never waits on this. `queueAttestation` has
 * already written a durable `pending` row by the time anything here runs, and
 * every failure path below leaves the row as `failed` and retryable. No
 * request, commitment, dispatch or receipt is blocked by the chain being down,
 * misconfigured, or absent entirely.
 */

const ABI = [
  'function record(bytes32 orgRef, bytes32 subjectRef, bytes32 manifestHash, uint8 eventType) returns (uint256)',
  'function total() view returns (uint256)',
  'function attestationsForSubject(bytes32 subjectRef) view returns (tuple(bytes32 orgRef, bytes32 subjectRef, bytes32 manifestHash, uint8 eventType, uint64 recordedAt, address attester)[])',
  'function isAttester(address) view returns (bool)',
];

const EVENT_TYPE_INDEX: Record<AttestationEventType, number> = {
  commitment: 0,
  dispatch: 1,
  receipt: 2,
  discrepancy: 3,
};

export interface ChainConfig {
  enabled: boolean;
  rpcUrl: string;
  contractAddress: string | null;
  attesterPrivateKey: string | null;
}

export function chainConfig(): ChainConfig {
  return {
    enabled: process.env.CHAIN_ENABLED === 'true',
    rpcUrl: process.env.CHAIN_RPC_URL ?? 'http://127.0.0.1:8545',
    contractAddress: process.env.CHAIN_CONTRACT_ADDRESS || null,
    attesterPrivateKey: process.env.CHAIN_ATTESTER_PRIVATE_KEY || null,
  };
}

export class ChainDisabledError extends Error {
  code = 'chain_disabled' as const;
}

async function connect(config: ChainConfig) {
  if (!config.enabled) {
    throw new ChainDisabledError('CHAIN_ENABLED is not true.');
  }
  if (!config.contractAddress) {
    throw new ChainDisabledError('CHAIN_CONTRACT_ADDRESS is not set.');
  }
  if (!config.attesterPrivateKey) {
    throw new ChainDisabledError('CHAIN_ATTESTER_PRIVATE_KEY is not set.');
  }
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  const wallet = new ethers.Wallet(config.attesterPrivateKey, provider);
  const contract = new ethers.Contract(config.contractAddress, ABI, wallet);
  return { provider, wallet, contract, chainId: String(network.chainId) };
}

export interface FlushResult {
  attempted: number;
  confirmed: number;
  failed: number;
  skippedReason?: string;
  errors: Array<{ attestationId: string; error: string }>;
}

/**
 * Tries to push queued attestations onto the chain.
 *
 * Safe to call at any time, including when the chain is unreachable: it
 * returns a report instead of throwing, so a caller in a request handler can
 * never turn a chain problem into a failed relief operation.
 */
export async function flushAttestations(db: DB, limit = 10): Promise<FlushResult> {
  const config = chainConfig();
  const queued = pendingAttestations(db, limit);
  const result: FlushResult = { attempted: 0, confirmed: 0, failed: 0, errors: [] };

  if (queued.length === 0) return result;

  let connection: Awaited<ReturnType<typeof connect>>;
  try {
    connection = await connect(config);
  } catch (error) {
    // Not an error for the operation that queued these: they simply stay
    // pending and will be retried later.
    result.skippedReason = (error as Error).message;
    return result;
  }

  // Nonces are assigned here rather than left to the signer.
  //
  // A flush sends several transactions in a row from one account. Letting the
  // signer derive each nonce makes it query the node between sends, and a node
  // that has not yet settled the previous transaction hands back a stale count
  // — two transactions then claim the same nonce and the later ones are
  // rejected as "nonce too low". Tracking it locally makes a batch flush
  // deterministic; a failure resyncs from the node so one bad row cannot
  // poison the rest of the queue.
  const signerAddress = await connection.wallet.getAddress();
  let nonce = await connection.provider.getTransactionCount(signerAddress, 'latest');

  for (const row of queued) {
    result.attempted += 1;
    try {
      const manifest = JSON.parse(row.manifest_json) as {
        subjectRef: string;
        chainOrgRef: string;
      };
      const tx = await connection.contract.record(
        row.chain_org_ref,
        manifest.subjectRef,
        row.manifest_hash,
        EVENT_TYPE_INDEX[row.event_type],
        { nonce },
      );
      nonce += 1;
      const receipt = await tx.wait();
      markAttestationConfirmed(db, row.id, {
        txHash: receipt?.hash ?? tx.hash,
        blockNumber: Number(receipt?.blockNumber ?? 0),
        chainId: connection.chainId,
      });
      result.confirmed += 1;
    } catch (error) {
      markAttestationFailed(db, row.id, (error as Error).message);
      result.failed += 1;
      result.errors.push({ attestationId: row.id, error: (error as Error).message });
      // The nonce may or may not have been consumed; ask the node rather than
      // guessing, so the remaining rows still get a fair attempt.
      try {
        nonce = await connection.provider.getTransactionCount(signerAddress, 'latest');
      } catch {
        // If even that fails the chain is gone; the rows stay queued.
        break;
      }
    }
  }

  return result;
}

export interface ChainStatus {
  enabled: boolean;
  reachable: boolean;
  chainId: string | null;
  contractAddress: string | null;
  attesterAddress: string | null;
  attesterRegistered: boolean | null;
  totalOnChain: number | null;
  note: string;
}

export async function chainStatus(): Promise<ChainStatus> {
  const config = chainConfig();
  const base: ChainStatus = {
    enabled: config.enabled,
    reachable: false,
    chainId: null,
    contractAddress: config.contractAddress,
    attesterAddress: null,
    attesterRegistered: null,
    totalOnChain: null,
    note: '',
  };

  if (!config.enabled) {
    return {
      ...base,
      note: 'Attestations are queued in the database as "pending" and are not being written to a chain. Start the local node, run the deploy script, then set CHAIN_ENABLED=true, CHAIN_CONTRACT_ADDRESS and restart. Relief coordination works either way.',
    };
  }

  try {
    const { contract, wallet, chainId } = await connect(config);
    const total = await contract.total();
    const address = await wallet.getAddress();
    const registered = (await contract.isAttester(address)) as boolean;
    return {
      ...base,
      reachable: true,
      chainId,
      attesterAddress: address,
      attesterRegistered: registered,
      totalOnChain: Number(total),
      note: registered
        ? `Connected to the local development chain (chainId ${chainId}). Acknowledgements are written as opaque references and manifest hashes only.`
        : `Connected to chainId ${chainId}, but this attester address is not registered on the contract. Run the deploy script, which registers one development identity per fictional organisation.`,
    };
  } catch (error) {
    return {
      ...base,
      note: `CHAIN_ENABLED is true but the chain could not be reached: ${(error as Error).message}. Queued attestations stay pending and retryable; nothing else is affected.`,
    };
  }
}

/** Fire-and-forget flush used after a commitment, dispatch or receipt. */
export function flushInBackground(db: DB): void {
  void flushAttestations(db).catch(() => {
    // Already recorded against each row; nothing here should surface to a user.
  });
}
