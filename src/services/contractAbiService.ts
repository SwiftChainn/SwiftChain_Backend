import { rpc as StellarRpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import env from '../config/env';
import { escrowIndexerConfig } from '../config/escrow';
import logger from '../config/logger';
import type { ISorobanRpcClient } from './providers/sorobanRpcClient';
import { defaultSorobanRpcClient } from './providers/adapters';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AbiCompatibilityStatus = 'match' | 'warn' | 'mismatch' | 'unknown';

export interface SemverVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export interface ContractAbiTarget {
  /** Logical contract name (e.g. "escrow"). */
  name: string;
  /** Deployed Soroban contract ID ("C..."). */
  contractId: string;
  /** Expected contract ABI semantic version (e.g. "1.0.0"). */
  expectedVersion: string;
  /** Supported semver range (e.g. "^1.0.0", "~1.2.0", ">=1.0.0 <2.0.0", "1.0.0"). */
  supportedRange: string;
  /** Contract storage symbol key exposing the version marker. */
  versionKey?: string;
}

export interface ContractAbiStatus {
  name: string;
  contractId: string;
  currentVersion: string | null;
  expectedVersion: string;
  supportedRange: string;
  status: AbiCompatibilityStatus;
  paused: boolean;
  reason?: string;
  checkedAt: string | null;
}

export interface ContractAbiSnapshot {
  paused: boolean;
  contracts: ContractAbiStatus[];
}

export type ContractVersionReader = (
  contractId: string,
  versionKey: string,
) => Promise<string | null>;

export interface ContractAbiServiceOptions {
  rpc?: ISorobanRpcClient;
  versionReader?: ContractVersionReader;
  targets?: ContractAbiTarget[];
  checkIntervalMs?: number;
}

// ─── Semver helpers ────────────────────────────────────────────────────────────

const SEMVER_REGEX = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(version: string): SemverVersion | null {
  const match = SEMVER_REGEX.exec(version.trim());
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: `${match[1]}.${match[2]}.${match[3]}`,
  };
}

export function compareSemver(a: SemverVersion, b: SemverVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function satisfiesSingleComparator(version: SemverVersion, comparator: string): boolean {
  const token = comparator.trim();
  if (!token) return true;

  if (token.startsWith('^')) {
    const base = parseSemver(token.slice(1));
    if (!base) return false;
    return version.major === base.major && compareSemver(version, base) >= 0;
  }

  if (token.startsWith('~')) {
    const base = parseSemver(token.slice(1));
    if (!base) return false;
    return (
      version.major === base.major &&
      version.minor === base.minor &&
      compareSemver(version, base) >= 0
    );
  }

  const opMatch = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(token);
  if (!opMatch) return false;
  const op = opMatch[1] ?? '=';
  const target = parseSemver(opMatch[2]);
  if (!target) return false;

  const cmp = compareSemver(version, target);
  switch (op) {
    case '>=':
      return cmp >= 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '<':
      return cmp < 0;
    case '=':
    default:
      return cmp === 0;
  }
}

export function satisfiesSemverRange(version: SemverVersion, range: string): boolean {
  const comparators = range
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (comparators.length === 0) return false;
  return comparators.every((comparator) => satisfiesSingleComparator(version, comparator));
}

/**
 * Evaluate a deployed contract's version against the expected version and
 * supported semver range:
 *   - `match`: within supported range and same major.minor as expected
 *   - `warn`: within supported range (compatible major) but minor differs
 *   - `mismatch`: missing/unparseable version or outside supported range -> pause ingestion
 */
export function evaluateContractVersion(
  currentVersion: string | null,
  expectedVersion: string,
  supportedRange: string,
): { status: AbiCompatibilityStatus; paused: boolean; reason?: string } {
  if (!currentVersion) {
    return {
      status: 'mismatch',
      paused: true,
      reason: 'Contract version marker is missing or unreadable',
    };
  }

  const parsedCurrent = parseSemver(currentVersion);
  const parsedExpected = parseSemver(expectedVersion);

  if (!parsedCurrent) {
    return {
      status: 'mismatch',
      paused: true,
      reason: `Contract returned invalid semantic version '${currentVersion}'`,
    };
  }

  if (!parsedExpected) {
    return {
      status: 'mismatch',
      paused: true,
      reason: `Configured expected version '${expectedVersion}' is invalid`,
    };
  }

  if (!satisfiesSemverRange(parsedCurrent, supportedRange)) {
    return {
      status: 'mismatch',
      paused: true,
      reason: `Contract version ${parsedCurrent.raw} is outside supported range ${supportedRange}`,
    };
  }

  if (parsedCurrent.minor !== parsedExpected.minor) {
    return {
      status: 'warn',
      paused: false,
      reason: `Minor version mismatch: contract=${parsedCurrent.raw} expected=${parsedExpected.raw}`,
    };
  }

  return { status: 'match', paused: false };
}

// ─── Default RPC version reader ────────────────────────────────────────────────

export function createRpcContractVersionReader(rpc: ISorobanRpcClient): ContractVersionReader {
  return async (contractId: string, versionKey: string): Promise<string | null> => {
    if (!rpc.getContractData) {
      return null;
    }

    const key = xdr.ScVal.scvSymbol(versionKey);
    const entry = await rpc.getContractData(contractId, key, StellarRpc.Durability.Persistent);
    if (!entry) {
      return null;
    }

    const ledgerData = entry.val;
    const contractData = ledgerData.contractData();
    const native = scValToNative(contractData.val()) as unknown;

    if (typeof native === 'string' && native.trim().length > 0) {
      return native.trim();
    }

    if (native !== null && typeof native === 'object' && 'version' in native) {
      const value = (native as { version?: unknown }).version;
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  };
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class ContractAbiService {
  private readonly versionReader: ContractVersionReader;
  private readonly targets: ContractAbiTarget[];
  private readonly checkIntervalMs: number;
  private readonly statuses = new Map<string, ContractAbiStatus>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(options: ContractAbiServiceOptions = {}) {
    const rpc = options.rpc ?? defaultSorobanRpcClient;
    this.versionReader = options.versionReader ?? createRpcContractVersionReader(rpc);
    this.targets = options.targets ?? ContractAbiService.resolveDefaultTargets();
    this.checkIntervalMs = options.checkIntervalMs ?? env.CONTRACT_ABI_CHECK_INTERVAL_MS;

    for (const target of this.targets) {
      this.statuses.set(target.contractId, {
        name: target.name,
        contractId: target.contractId,
        currentVersion: null,
        expectedVersion: target.expectedVersion,
        supportedRange: target.supportedRange,
        status: 'unknown',
        paused: false,
        checkedAt: null,
      });
    }
  }

  public static resolveDefaultTargets(): ContractAbiTarget[] {
    const targets: ContractAbiTarget[] = [];
    if (escrowIndexerConfig.contractId) {
      targets.push({
        name: 'escrow',
        contractId: escrowIndexerConfig.contractId,
        expectedVersion: env.CONTRACT_ABI_EXPECTED_VERSION,
        supportedRange: env.CONTRACT_ABI_SUPPORTED_RANGE,
        versionKey: env.CONTRACT_ABI_VERSION_KEY,
      });
    }
    return targets;
  }

  /** Check a single contract's deployed ABI version and update cached state. */
  public async checkContract(target: ContractAbiTarget): Promise<ContractAbiStatus> {
    const versionKey = target.versionKey ?? env.CONTRACT_ABI_VERSION_KEY;
    const checkedAt = new Date().toISOString();

    let currentVersion: string | null = null;
    try {
      currentVersion = await this.versionReader(target.contractId, versionKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedStatus: ContractAbiStatus = {
        name: target.name,
        contractId: target.contractId,
        currentVersion: null,
        expectedVersion: target.expectedVersion,
        supportedRange: target.supportedRange,
        status: 'mismatch',
        paused: true,
        reason: `Failed to read contract version: ${message}`,
        checkedAt,
      };
      this.statuses.set(target.contractId, failedStatus);
      logger.error('[ContractAbiService] Hard ABI version check failure — pausing ingestion', {
        contract: target.name,
        contractId: target.contractId,
        expectedVersion: target.expectedVersion,
        supportedRange: target.supportedRange,
        error: message,
      });
      return failedStatus;
    }

    const evaluation = evaluateContractVersion(
      currentVersion,
      target.expectedVersion,
      target.supportedRange,
    );

    const status: ContractAbiStatus = {
      name: target.name,
      contractId: target.contractId,
      currentVersion,
      expectedVersion: target.expectedVersion,
      supportedRange: target.supportedRange,
      status: evaluation.status,
      paused: evaluation.paused,
      reason: evaluation.reason,
      checkedAt,
    };

    this.statuses.set(target.contractId, status);

    if (status.status === 'warn') {
      logger.warn('[ContractAbiService] Contract ABI minor version mismatch detected', {
        contract: target.name,
        contractId: target.contractId,
        currentVersion,
        expectedVersion: target.expectedVersion,
        supportedRange: target.supportedRange,
        reason: status.reason,
      });
    } else if (status.status === 'mismatch') {
      logger.error('[ContractAbiService] Contract ABI hard version mismatch — pausing ingestion', {
        contract: target.name,
        contractId: target.contractId,
        currentVersion,
        expectedVersion: target.expectedVersion,
        supportedRange: target.supportedRange,
        reason: status.reason,
      });
    } else {
      logger.info('[ContractAbiService] Contract ABI version verified', {
        contract: target.name,
        contractId: target.contractId,
        currentVersion,
        expectedVersion: target.expectedVersion,
      });
    }

    return status;
  }

  /** Check all configured contracts and return their latest ABI statuses. */
  public async checkAllContracts(): Promise<ContractAbiStatus[]> {
    const results: ContractAbiStatus[] = [];
    for (const target of this.targets) {
      results.push(await this.checkContract(target));
    }
    return results;
  }

  /** Whether any monitored contract has entered a hard-mismatch paused state. */
  public isIngestionPaused(): boolean {
    for (const status of this.statuses.values()) {
      if (status.paused) {
        return true;
      }
    }
    return false;
  }

  /** Snapshot of all monitored contract ABI versions for indexer status endpoints. */
  public getSnapshot(): ContractAbiSnapshot {
    const contracts = Array.from(this.statuses.values());
    return {
      paused: this.isIngestionPaused(),
      contracts,
    };
  }

  /** Run an immediate startup verification and schedule periodic checks. */
  public start(): void {
    if (this.intervalHandle) {
      return;
    }

    void this.checkAllContracts();

    this.intervalHandle = setInterval(() => {
      void this.checkAllContracts();
    }, this.checkIntervalMs);
    this.intervalHandle.unref?.();

    logger.info(
      `[ContractAbiService] Started periodic ABI checks — contracts=${this.targets.length} ` +
        `intervalMs=${this.checkIntervalMs}`,
    );
  }

  /** Stop periodic ABI checks. */
  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}

export const contractAbiService = new ContractAbiService();

export const startContractAbiMonitor = (): void => {
  contractAbiService.start();
};

export const stopContractAbiMonitor = (): void => {
  contractAbiService.stop();
};
