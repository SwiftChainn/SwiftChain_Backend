import { nativeToScVal, rpc as StellarRpc } from '@stellar/stellar-sdk';
import {
  ContractAbiService,
  createRpcContractVersionReader,
  evaluateContractVersion,
  parseSemver,
  satisfiesSemverRange,
} from '../src/services/contractAbiService';
import { IndexerService } from '../src/services/indexerService';
import { EventPoller } from '../src/services/eventPoller';
import { IndexerStatus } from '../src/models/IndexerStatus';
import EventLog from '../src/models/EventLog';
import type { ISorobanRpcClient } from '../src/services/providers/sorobanRpcClient';
import logger from '../src/config/logger';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('Contract ABI / interface version negotiation (#342)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('semver parsing and range evaluation', () => {
    it('parses valid semver strings and rejects malformed ones', () => {
      expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, raw: '1.2.3' });
      expect(parseSemver('v2.0.1')).toEqual({ major: 2, minor: 0, patch: 1, raw: '2.0.1' });
      expect(parseSemver('not-a-version')).toBeNull();
    });

    it('evaluates caret, tilde, exact, and compound ranges', () => {
      const v123 = parseSemver('1.2.3')!;
      expect(satisfiesSemverRange(v123, '^1.0.0')).toBe(true);
      expect(satisfiesSemverRange(v123, '~1.2.0')).toBe(true);
      expect(satisfiesSemverRange(v123, '~1.1.0')).toBe(false);
      expect(satisfiesSemverRange(v123, '>=1.0.0 <2.0.0')).toBe(true);
      expect(satisfiesSemverRange(parseSemver('2.0.0')!, '^1.0.0')).toBe(false);
    });

    it('returns match, warn, and mismatch outcomes correctly', () => {
      expect(evaluateContractVersion('1.0.0', '1.0.0', '^1.0.0')).toMatchObject({
        status: 'match',
        paused: false,
      });

      expect(evaluateContractVersion('1.0.4', '1.0.0', '^1.0.0')).toMatchObject({
        status: 'match',
        paused: false,
      });

      expect(evaluateContractVersion('1.2.0', '1.0.0', '^1.0.0')).toMatchObject({
        status: 'warn',
        paused: false,
      });

      expect(evaluateContractVersion('2.0.0', '1.0.0', '^1.0.0')).toMatchObject({
        status: 'mismatch',
        paused: true,
      });

      expect(evaluateContractVersion(null, '1.0.0', '^1.0.0')).toMatchObject({
        status: 'mismatch',
        paused: true,
      });
    });
  });

  describe('ContractAbiService behaviors', () => {
    const target = {
      name: 'escrow',
      contractId: 'CESCROWCONTRACT123',
      expectedVersion: '1.0.0',
      supportedRange: '^1.0.0',
      versionKey: 'version',
    };

    it('verifies matching version without warning or pausing', async () => {
      const service = new ContractAbiService({
        targets: [target],
        versionReader: jest.fn().mockResolvedValue('1.0.0'),
      });

      const [status] = await service.checkAllContracts();

      expect(status).toMatchObject({
        name: 'escrow',
        contractId: target.contractId,
        currentVersion: '1.0.0',
        expectedVersion: '1.0.0',
        status: 'match',
        paused: false,
      });
      expect(service.isIngestionPaused()).toBe(false);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('emits structured warning on minor mismatch without pausing ingestion', async () => {
      const service = new ContractAbiService({
        targets: [target],
        versionReader: jest.fn().mockResolvedValue('1.3.0'),
      });

      const [status] = await service.checkAllContracts();

      expect(status).toMatchObject({
        currentVersion: '1.3.0',
        expectedVersion: '1.0.0',
        status: 'warn',
        paused: false,
      });
      expect(service.isIngestionPaused()).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        '[ContractAbiService] Contract ABI minor version mismatch detected',
        expect.objectContaining({
          contract: 'escrow',
          currentVersion: '1.3.0',
          expectedVersion: '1.0.0',
        }),
      );
    });

    it('enters paused state on hard major mismatch and recovers when version matches again', async () => {
      const reader = jest.fn<Promise<string | null>, [string, string]>();
      reader.mockResolvedValueOnce('2.0.0').mockResolvedValueOnce('1.0.0');

      const service = new ContractAbiService({
        targets: [target],
        versionReader: reader,
      });

      const [mismatch] = await service.checkAllContracts();
      expect(mismatch).toMatchObject({
        currentVersion: '2.0.0',
        expectedVersion: '1.0.0',
        status: 'mismatch',
        paused: true,
      });
      expect(service.isIngestionPaused()).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        '[ContractAbiService] Contract ABI hard version mismatch — pausing ingestion',
        expect.objectContaining({
          contract: 'escrow',
          currentVersion: '2.0.0',
        }),
      );

      const [recovered] = await service.checkAllContracts();
      expect(recovered.status).toBe('match');
      expect(service.isIngestionPaused()).toBe(false);
    });

    it('reads version marker from Soroban RPC getContractData', async () => {
      const scVal = nativeToScVal('1.1.0', { type: 'string' });
      const rpc = {
        getContractData: jest.fn().mockResolvedValue({
          val: {
            contractData: (): { val: () => typeof scVal } => ({
              val: (): typeof scVal => scVal,
            }),
          },
        } as unknown as StellarRpc.Api.LedgerEntryResult),
      } as unknown as ISorobanRpcClient;

      const reader = createRpcContractVersionReader(rpc);
      const version = await reader(target.contractId, 'version');

      expect(version).toBe('1.1.0');
      expect(rpc.getContractData).toHaveBeenCalledTimes(1);
    });

    it('blocks EventPoller ingestion when paused on hard ABI mismatch', async () => {
      const abiService = new ContractAbiService({
        targets: [target],
        versionReader: jest.fn().mockResolvedValue('3.0.0'),
      });
      await abiService.checkAllContracts();
      expect(abiService.isIngestionPaused()).toBe(true);

      jest.spyOn(IndexerStatus, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue({ lastProcessedLedger: 500 }),
      } as never);

      const getLatestLedger = jest.fn();
      const getEvents = jest.fn();
      const rpc = { getLatestLedger, getEvents } as unknown as ISorobanRpcClient;

      const poller = new EventPoller({
        rpc,
        network: 'testnet',
        contractId: target.contractId,
        subscriptions: [{ eventType: 'escrow', topic: 'escrow_funded', handle: jest.fn() }],
        intervalMs: 60_000,
        pageSize: 100,
        isPaused: (): boolean => abiService.isIngestionPaused(),
      });

      const cycle = await poller.pollOnce();
      expect(cycle).toEqual({
        fromLedger: 500,
        toLedger: 500,
        fetched: 0,
        processed: 0,
        duplicates: 0,
        failed: 0,
      });
      expect(getLatestLedger).not.toHaveBeenCalled();
      expect(getEvents).not.toHaveBeenCalled();
    });

    it('exposes contractVersions on IndexerService.getIndexerStatusOverview', async () => {
      const rpc = {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
      } as unknown as ISorobanRpcClient;

      jest.spyOn(EventLog, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      } as never);

      const indexerService = new IndexerService(rpc);
      const overview = await indexerService.getIndexerStatusOverview();

      expect(overview).toHaveProperty('indexers');
      expect(overview).toHaveProperty('contractVersions');
      expect(typeof overview.contractVersions.paused).toBe('boolean');
      expect(Array.isArray(overview.contractVersions.contracts)).toBe(true);
    });
  });
});
