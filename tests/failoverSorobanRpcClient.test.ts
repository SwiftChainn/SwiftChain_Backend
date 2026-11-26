import { FailoverSorobanRpcClient } from '../src/services/providers/failoverSorobanRpcClient';
import type { ISorobanRpcClient } from '../src/services/providers/sorobanRpcClient';

const makeClient = (overrides: Partial<Record<keyof ISorobanRpcClient, jest.Mock>> = {}) =>
  ({
    getAccount: jest.fn().mockResolvedValue({ accountId: 'GTEST' }),
    getHealth: jest.fn().mockResolvedValue({ status: 'healthy' }),
    getTransaction: jest.fn().mockResolvedValue({ status: 'NOT_FOUND' }),
    getEvents: jest.fn().mockResolvedValue({ events: [], latestLedger: 1, cursor: '' }),
    getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1 }),
    getNetwork: jest.fn().mockResolvedValue({ passphrase: 'test', protocolVersion: '22' }),
    prepareTransaction: jest.fn().mockResolvedValue({ sequence: 1 }),
    sendTransaction: jest.fn().mockResolvedValue({ status: 'PENDING', hash: 'tx-hash' }),
    ...overrides,
  }) as unknown as ISorobanRpcClient;

describe('FailoverSorobanRpcClient', () => {
  it('uses the healthy primary when endpoints have equal health', async () => {
    const primary = makeClient();
    const secondary = makeClient();
    const client = new FailoverSorobanRpcClient([
      { url: 'https://primary.example', client: primary },
      { url: 'https://secondary.example', client: secondary },
    ]);

    await client.getAccount('GTEST');

    expect(primary.getAccount).toHaveBeenCalledTimes(1);
    expect(secondary.getAccount).not.toHaveBeenCalled();
  });

  it('prefers a faster endpoint after collecting latency samples', async () => {
    const primary = makeClient({
      getAccount: jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { accountId: 'GTEST' };
      }),
    });
    const secondary = makeClient();
    const client = new FailoverSorobanRpcClient([
      { url: 'https://primary.example', client: primary },
      { url: 'https://secondary.example', client: secondary },
    ]);

    await client.getAccount('GTEST');
    await client.getAccount('GTEST');

    expect(primary.getAccount).toHaveBeenCalledTimes(1);
    expect(secondary.getAccount).toHaveBeenCalledTimes(1);
  });

  it('quarantines a failing primary and transparently fails over read requests', async () => {
    const primary = makeClient({
      getAccount: jest.fn().mockRejectedValue(new Error('primary offline')),
    });
    const secondary = makeClient();
    const client = new FailoverSorobanRpcClient([
      { url: 'https://primary.example', client: primary },
      { url: 'https://secondary.example', client: secondary },
    ]);

    await expect(client.getAccount('GTEST')).resolves.toEqual({ accountId: 'GTEST' });
    expect(primary.getAccount).toHaveBeenCalledTimes(1);
    expect(secondary.getAccount).toHaveBeenCalledTimes(1);
  });

  it('probes and re-admits an endpoint after its quarantine expires', async () => {
    let now = 0;
    const primary = makeClient({
      getAccount: jest.fn().mockRejectedValueOnce(new Error('temporary outage')),
    });
    const secondary = makeClient({
      getAccount: jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { accountId: 'GTEST' };
      }),
    });
    const client = new FailoverSorobanRpcClient(
      [
        { url: 'https://primary.example', client: primary },
        { url: 'https://secondary.example', client: secondary },
      ],
      { quarantineMs: 100, now: () => now },
    );

    await client.getAccount('GTEST');
    now = 101;
    await client.getAccount('GTEST');

    expect(primary.getHealth).toHaveBeenCalledTimes(1);
    expect(primary.getAccount).toHaveBeenCalledTimes(2);
  });

  it('raises a clear error when every available endpoint is down', async () => {
    const primary = makeClient({ getAccount: jest.fn().mockRejectedValue(new Error('offline')) });
    const secondary = makeClient({ getAccount: jest.fn().mockRejectedValue(new Error('offline')) });
    const client = new FailoverSorobanRpcClient([
      { url: 'https://primary.example', client: primary },
      { url: 'https://secondary.example', client: secondary },
    ]);

    await expect(client.getAccount('GTEST')).rejects.toThrow(
      'All available Soroban RPC endpoints failed during getAccount.',
    );
  });

  it('does not retry transaction submission on another endpoint after an ambiguous failure', async () => {
    const primary = makeClient({
      sendTransaction: jest.fn().mockRejectedValue(new Error('request timed out')),
    });
    const secondary = makeClient();
    const client = new FailoverSorobanRpcClient([
      { url: 'https://primary.example', client: primary },
      { url: 'https://secondary.example', client: secondary },
    ]);

    await expect(client.sendTransaction({} as never)).rejects.toThrow(
      'verify the transaction hash before retrying',
    );
    expect(primary.sendTransaction).toHaveBeenCalledTimes(1);
    expect(secondary.sendTransaction).not.toHaveBeenCalled();
  });
});
