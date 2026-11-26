import { rpc as StellarRpc, Networks, StrKey } from '@stellar/stellar-sdk';
import env, { StellarNetwork } from './env';
import logger from './logger';

/**
 * Supported Stellar network aliases.
 */
export type { StellarNetwork };

/**
 * Resolved Stellar configuration derived from environment variables.
 */
export interface StellarConfig {
  /** Soroban RPC endpoint URL. */
  rpcUrl: string;
  /** Configured Soroban RPC endpoints, ordered with the preferred endpoint first. */
  rpcUrls: string[];
  /** Base cooldown before a quarantined endpoint is retried. */
  rpcQuarantineMs: number;
  /** Network passphrase used when signing/verifying transactions. */
  networkPassphrase: string;
  /** Human-readable network alias (for logs and API responses). */
  network: StellarNetwork;
  /** HTTP request timeout in milliseconds for RPC calls. */
  timeoutMs: number;
  /**
   * Soroban contract id (`C...`) of the SwiftChain escrow contract.
   * Optional at boot so the API still starts without it; endpoints that need
   * it fail with a clear 503 instead.
   */
  escrowContractId?: string;
  /** Escrow contract function invoked to lock funds. */
  escrowLockFunction: string;
  /** Base fee (in stroops) used when building transactions. */
  baseFee: string;
  /** Time-to-live for cached Soroban contract state entries. */
  sorobanStateCacheTtlMs: number;
  /** Validity window, in seconds, of generated unsigned transactions. */
  transactionTimeoutSeconds: number;
}

// ─── Network passphrase map ────────────────────────────────────────────────────

const NETWORK_PASSPHRASES: Record<StellarNetwork, string> = {
  mainnet: Networks.PUBLIC,
  testnet: Networks.TESTNET,
  futurenet: Networks.FUTURENET,
};

const DEFAULT_RPC_URLS: Record<StellarNetwork, string> = {
  mainnet: 'https://soroban-mainnet.stellar.org',
  testnet: 'https://soroban-testnet.stellar.org',
  futurenet: 'https://rpc-futurenet.stellar.org',
};

// ─── Resolve config from env ───────────────────────────────────────────────────

/**
 * Build the Stellar configuration from environment variables with sensible
 * defaults. Validated at startup so misconfiguration fails fast.
 */
function resolveStellarConfig(): StellarConfig {
  const network = env.STELLAR_NETWORK;

  const fallbackRpcUrl = env.SOROBAN_RPC_URL?.trim() || DEFAULT_RPC_URLS[network];
  const configuredRpcUrls = [
    ...new Set(
      env.SOROBAN_RPC_URLS.split(',')
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ];
  const rpcUrls = configuredRpcUrls.length > 0 ? configuredRpcUrls : [fallbackRpcUrl];
  const preferredRpcUrl =
    env.SOROBAN_RPC_PRIMARY_URL ||
    (configuredRpcUrls.includes(env.SOROBAN_RPC_URL) ? env.SOROBAN_RPC_URL : rpcUrls[0]);
  if (!rpcUrls.includes(preferredRpcUrl)) {
    throw new Error('SOROBAN_RPC_PRIMARY_URL must match one of the URLs in SOROBAN_RPC_URLS.');
  }
  const rpcUrl = preferredRpcUrl;

  // Prefer explicit passphrase env var; fall back to the well-known value for
  // the configured network.
  const networkPassphrase = env.STELLAR_NETWORK_PASSPHRASE?.trim() || NETWORK_PASSPHRASES[network];

  if (!rpcUrl) {
    throw new Error('SOROBAN_RPC_URL is required and could not be resolved.');
  }

  for (const endpoint of rpcUrls) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(endpoint);
    } catch {
      throw new Error(`Invalid Soroban RPC URL: ${endpoint}`);
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error(`Soroban RPC URL must use HTTP or HTTPS: ${endpoint}`);
    }
  }

  if (!networkPassphrase) {
    throw new Error('STELLAR_NETWORK_PASSPHRASE is required and could not be resolved.');
  }

  const escrowContractId = env.SOROBAN_ESCROW_CONTRACT_ID?.trim() || undefined;

  if (escrowContractId && !StrKey.isValidContract(escrowContractId)) {
    throw new Error(
      `Invalid SOROBAN_ESCROW_CONTRACT_ID="${escrowContractId}". ` +
        'Must be a valid Soroban contract id (starts with "C").',
    );
  }

  if (env.SOROBAN_FEE_MAX_STROOPS < env.STELLAR_BASE_FEE) {
    throw new Error('SOROBAN_FEE_MAX_STROOPS must be greater than or equal to STELLAR_BASE_FEE.');
  }

  return {
    rpcUrl,
    rpcUrls: [preferredRpcUrl, ...rpcUrls.filter((url) => url !== preferredRpcUrl)],
    rpcQuarantineMs: env.SOROBAN_RPC_QUARANTINE_MS,
    networkPassphrase,
    network,
    timeoutMs: env.SOROBAN_RPC_TIMEOUT_MS,
    escrowContractId,
    escrowLockFunction: env.SOROBAN_ESCROW_LOCK_FUNCTION,
    // The SDK's transaction builder expects the fee as a string.
    baseFee: String(env.STELLAR_BASE_FEE),
    sorobanStateCacheTtlMs: env.SOROBAN_STATE_CACHE_TTL_MS,
    transactionTimeoutSeconds: env.STELLAR_TRANSACTION_TIMEOUT_SECONDS,
  };
}

// ─── Singleton config ──────────────────────────────────────────────────────────

export const stellarConfig: StellarConfig = resolveStellarConfig();

// ─── Soroban RPC client factory ────────────────────────────────────────────────

/**
 * Create a new `rpc.Server` instance using the resolved configuration.
 *
 * A factory function (rather than a singleton) is used so that callers in
 * tests can construct fresh instances with custom options without mutating
 * shared state.
 *
 * @param options - Optional overrides forwarded to `rpc.Server`.
 * @returns         A configured Soroban RPC client.
 */
export function createSorobanRpcClient(
  options?: Partial<ConstructorParameters<typeof StellarRpc.Server>[1]>,
): StellarRpc.Server {
  return createSorobanRpcClientForUrl(stellarConfig.rpcUrl, options);
}

/** Create an SDK RPC client for one configured endpoint. */
export function createSorobanRpcClientForUrl(
  url: string,
  options?: Partial<ConstructorParameters<typeof StellarRpc.Server>[1]>,
): StellarRpc.Server {
  return new StellarRpc.Server(url, {
    allowHttp: url.startsWith('http://'),
    ...options,
  });
}

/**
 * Pre-built default RPC client singleton.
 * Use this for all production code paths.
 */
export const sorobanRpcClient: StellarRpc.Server = createSorobanRpcClient();

logger.info(
  `[Stellar] Soroban RPC client initialised — network=${stellarConfig.network} ` +
    `url=${stellarConfig.rpcUrl}`,
);
