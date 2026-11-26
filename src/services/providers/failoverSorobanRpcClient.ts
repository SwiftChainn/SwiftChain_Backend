import type { FeeBumpTransaction, Transaction, rpc as StellarRpc, xdr } from '@stellar/stellar-sdk';
import type {
  ISorobanRpcClient,
  PreparedTransaction,
  SorobanGetEventsRequest,
} from './sorobanRpcClient';

export interface SorobanRpcEndpoint {
  url: string;
  client: ISorobanRpcClient;
}

export interface SorobanRpcFailoverOptions {
  primaryUrl?: string;
  quarantineMs?: number;
  probeTimeoutMs?: number;
  now?: () => number;
}

interface EndpointHealth extends SorobanRpcEndpoint {
  primary: boolean;
  quarantineUntil: number;
  consecutiveFailures: number;
  outcomes: boolean[];
  latenciesMs: number[];
}

/** Error raised when no endpoint can serve a request. */
export class SorobanRpcEndpointsUnavailableError extends Error {
  public readonly causes: unknown[];

  constructor(message: string, causes: unknown[] = []) {
    super(message);
    this.name = 'SorobanRpcEndpointsUnavailableError';
    this.causes = causes;
  }
}

/**
 * Scores configured Soroban RPC endpoints and retries only read/simulation
 * calls. Signed transaction submission is sent to one endpoint exactly once
 * because a timeout can leave the transaction's acceptance status unknown.
 */
export class FailoverSorobanRpcClient implements ISorobanRpcClient {
  private readonly endpoints: EndpointHealth[];
  private readonly quarantineMs: number;
  private readonly probeTimeoutMs: number;
  private readonly now: () => number;

  constructor(endpoints: SorobanRpcEndpoint[], options: SorobanRpcFailoverOptions = {}) {
    if (endpoints.length === 0) throw new Error('At least one Soroban RPC endpoint is required.');
    const urls = new Set<string>();
    for (const endpoint of endpoints) {
      if (!endpoint.url || urls.has(endpoint.url)) {
        throw new Error('Soroban RPC endpoints must have unique, non-empty URLs.');
      }
      urls.add(endpoint.url);
    }
    const primaryUrl = options.primaryUrl ?? endpoints[0].url;
    if (!urls.has(primaryUrl))
      throw new Error('The primary Soroban RPC endpoint must be configured.');
    this.quarantineMs = options.quarantineMs ?? 30_000;
    if (
      !Number.isFinite(this.quarantineMs) ||
      this.quarantineMs < 100 ||
      this.quarantineMs > 300_000
    ) {
      throw new Error('Soroban RPC quarantine must be between 100 and 300000 milliseconds.');
    }
    this.probeTimeoutMs = options.probeTimeoutMs ?? 3_000;
    if (
      !Number.isFinite(this.probeTimeoutMs) ||
      this.probeTimeoutMs < 100 ||
      this.probeTimeoutMs > 30_000
    ) {
      throw new Error(
        'Soroban RPC recovery probe timeout must be between 100 and 30000 milliseconds.',
      );
    }
    this.now = options.now ?? Date.now;
    this.endpoints = endpoints.map((endpoint) => ({
      ...endpoint,
      primary: endpoint.url === primaryUrl,
      quarantineUntil: 0,
      consecutiveFailures: 0,
      outcomes: [],
      latenciesMs: [],
    }));
  }

  public getAccount(
    address: string,
  ): Promise<Awaited<ReturnType<ISorobanRpcClient['getAccount']>>> {
    return this.invoke('getAccount', (client) => client.getAccount(address));
  }

  public getHealth(): Promise<StellarRpc.Api.GetHealthResponse> {
    return this.invoke('getHealth', (client) => client.getHealth());
  }

  public getTransaction(hash: string): Promise<StellarRpc.Api.GetTransactionResponse> {
    return this.invoke('getTransaction', (client) => client.getTransaction(hash));
  }

  public getEvents(request: SorobanGetEventsRequest): Promise<StellarRpc.Api.GetEventsResponse> {
    return this.invoke('getEvents', (client) => client.getEvents(request));
  }

  public getLatestLedger(): Promise<StellarRpc.Api.GetLatestLedgerResponse> {
    return this.invoke('getLatestLedger', (client) => client.getLatestLedger());
  }

  public getNetwork(): Promise<StellarRpc.Api.GetNetworkResponse> {
    return this.invoke('getNetwork', (client) => client.getNetwork());
  }

  public prepareTransaction(tx: Transaction | FeeBumpTransaction): Promise<PreparedTransaction> {
    return this.invoke('prepareTransaction', (client) => client.prepareTransaction(tx));
  }

  /** Optional ledger read used by the contract-state service when available. */
  public getLedgerEntries(
    ...keys: xdr.LedgerKey[]
  ): Promise<StellarRpc.Api.GetLedgerEntriesResponse> {
    return this.invoke('getLedgerEntries', (client) => {
      const ledgerClient = client as ISorobanRpcClient & {
        getLedgerEntries?: (
          ...ledgerKeys: xdr.LedgerKey[]
        ) => Promise<StellarRpc.Api.GetLedgerEntriesResponse>;
      };
      if (!ledgerClient.getLedgerEntries) {
        throw new Error('The configured Soroban RPC client does not support ledger entry reads.');
      }
      return ledgerClient.getLedgerEntries(...keys);
    });
  }

  public sendTransaction(
    tx: Transaction | FeeBumpTransaction,
  ): Promise<StellarRpc.Api.SendTransactionResponse> {
    return this.invoke('sendTransaction', (client) => client.sendTransaction(tx), false);
  }

  private async invoke<T>(
    operation: string,
    action: (client: ISorobanRpcClient) => Promise<T>,
    retryable = true,
  ): Promise<T> {
    await this.probeRecoveredEndpoints();
    const candidates = this.rankedEndpoints();
    if (candidates.length === 0) {
      throw new SorobanRpcEndpointsUnavailableError(
        'All configured Soroban RPC endpoints are quarantined; retry after their backoff window.',
      );
    }

    const attempts = retryable ? candidates : candidates.slice(0, 1);
    const causes: unknown[] = [];
    for (const endpoint of attempts) {
      const startedAt = performance.now();
      try {
        const result = await action(endpoint.client);
        this.recordSuccess(endpoint, performance.now() - startedAt);
        return result;
      } catch (error) {
        this.recordFailure(endpoint);
        causes.push(error);
        if (!retryable) {
          throw new SorobanRpcEndpointsUnavailableError(
            'Soroban RPC transaction submission failed; verify the transaction hash before retrying.',
            causes,
          );
        }
      }
    }
    throw new SorobanRpcEndpointsUnavailableError(
      `All available Soroban RPC endpoints failed during ${operation}.`,
      causes,
    );
  }

  private async probeRecoveredEndpoints(): Promise<void> {
    const now = this.now();
    const recovered = this.endpoints.filter(
      (endpoint) => endpoint.quarantineUntil > 0 && endpoint.quarantineUntil <= now,
    );
    await Promise.all(
      recovered.map(async (endpoint) => {
        const startedAt = performance.now();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const health = await Promise.race([
            endpoint.client.getHealth(),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error('Soroban RPC recovery probe timed out.')),
                this.probeTimeoutMs,
              );
            }),
          ]);
          if (health.status !== 'healthy')
            throw new Error('Soroban RPC health check did not return healthy.');
          this.recordRecovery(endpoint, performance.now() - startedAt);
        } catch {
          this.recordFailure(endpoint);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      }),
    );
  }

  private rankedEndpoints(): EndpointHealth[] {
    const now = this.now();
    return this.endpoints
      .filter((endpoint) => endpoint.quarantineUntil <= now)
      .sort((left, right) => {
        const failureDifference = this.failureRate(left) - this.failureRate(right);
        if (failureDifference !== 0) return failureDifference;
        const latencyDifference = this.averageLatency(left) - this.averageLatency(right);
        if (latencyDifference !== 0) return latencyDifference;
        return Number(right.primary) - Number(left.primary);
      });
  }

  private failureRate(endpoint: EndpointHealth): number {
    if (endpoint.outcomes.length === 0) return 0;
    return endpoint.outcomes.filter(Boolean).length / endpoint.outcomes.length;
  }

  private averageLatency(endpoint: EndpointHealth): number {
    if (endpoint.latenciesMs.length === 0) return 100;
    return (
      endpoint.latenciesMs.reduce((total, latency) => total + latency, 0) /
      endpoint.latenciesMs.length
    );
  }

  private recordSuccess(endpoint: EndpointHealth, latencyMs: number): void {
    endpoint.consecutiveFailures = 0;
    endpoint.quarantineUntil = 0;
    endpoint.outcomes.push(false);
    endpoint.latenciesMs.push(latencyMs);
    if (endpoint.outcomes.length > 20) endpoint.outcomes.shift();
    if (endpoint.latenciesMs.length > 20) endpoint.latenciesMs.shift();
  }

  private recordRecovery(endpoint: EndpointHealth, latencyMs: number): void {
    endpoint.consecutiveFailures = 0;
    endpoint.quarantineUntil = 0;
    endpoint.outcomes = [false];
    endpoint.latenciesMs.push(latencyMs);
    if (endpoint.latenciesMs.length > 20) endpoint.latenciesMs.shift();
  }

  private recordFailure(endpoint: EndpointHealth): void {
    endpoint.consecutiveFailures += 1;
    endpoint.outcomes.push(true);
    if (endpoint.outcomes.length > 20) endpoint.outcomes.shift();
    const backoff = Math.min(this.quarantineMs * 2 ** (endpoint.consecutiveFailures - 1), 300_000);
    endpoint.quarantineUntil = this.now() + backoff;
  }
}
