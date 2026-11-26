/**
 * E2E Tests — Soroban Payment-Path Contract Operations (mint + pay + release) (#343)
 *
 * Exercises the full payment-path lifecycle for both native XLM and a custom
 * issued Stellar asset (USDC):
 *   1. Mint a known stroop-exact amount to the funding account on the test asset contract.
 *   2. Fund the escrow contract -> assert funder, contract, and recipient balances
 *      and verify the emitted Soroban `escrow_funded` event updates MongoDB state.
 *   3. Release the escrow -> assert recipient balance credited, escrow contract balance
 *      zeroed, funder balance unchanged, and `escrow_released` updates MongoDB state.
 *
 * Uses real `@stellar/stellar-sdk` XDR encoding/decoding (`nativeToScVal`, `scValToNative`,
 * `xdr.ScVal`, `Keypair`) and `toStroops`/`fromStroops` BigInt accounting to guarantee
 * stroop-accurate balances with zero floating-point drift.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Keypair, nativeToScVal, rpc as StellarRpc, xdr } from '@stellar/stellar-sdk';
import Delivery, { DeliveryStatus } from '../../src/models/Delivery';
import Escrow, { EscrowStatus } from '../../src/models/Escrow';
import {
  handleEscrowFundedEvent,
  handleEscrowReleasedEvent,
} from '../../src/indexer/escrowHandlers';
import { fromStroops, toStroops } from '../../src/utils/stroops';

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ─── Standalone Soroban Test-Asset & Escrow Payment-Path Harness ───────────────

interface TestAssetDescriptor {
  code: string;
  issuer?: string;
  contractId: string;
}

interface EscrowSlot {
  escrowId: string;
  deliveryId: string;
  funder: string;
  recipient: string;
  asset: TestAssetDescriptor;
  amountStroops: bigint;
  released: boolean;
}

/**
 * Deterministic standalone Soroban token + escrow contract harness.
 *
 * Maintains stroop-exact BigInt ledgers per asset contract and emits real
 * `@stellar/stellar-sdk` `EventResponse` XDR payloads identical to a Soroban
 * standalone node so the backend's actual event parsers, handlers, and DB
 * services are exercised end to end.
 */
class StandaloneSorobanPaymentHarness {
  private ledger = 10_000;
  private eventSeq = 0;
  private readonly balances = new Map<string, Map<string, bigint>>();
  private readonly escrows = new Map<string, EscrowSlot>();
  public readonly escrowContractId: string;

  constructor(escrowContractId = 'CDESCROWPAYMENTPATHCONTRACT00000000000000000000000000001') {
    this.escrowContractId = escrowContractId;
  }

  public registerAsset(asset: TestAssetDescriptor): void {
    if (!this.balances.has(asset.contractId)) {
      this.balances.set(asset.contractId, new Map());
    }
  }

  public balanceOf(asset: TestAssetDescriptor, account: string): bigint {
    return this.balances.get(asset.contractId)?.get(account) ?? 0n;
  }

  public mint(asset: TestAssetDescriptor, to: string, amountStroops: bigint): bigint {
    if (amountStroops <= 0n) {
      throw new Error('Mint amount must be positive');
    }
    this.registerAsset(asset);
    const ledgerMap = this.balances.get(asset.contractId)!;
    const nextBalance = (ledgerMap.get(to) ?? 0n) + amountStroops;
    ledgerMap.set(to, nextBalance);
    return nextBalance;
  }

  public fundEscrow(params: {
    escrowId: string;
    deliveryId: string;
    funder: string;
    recipient: string;
    asset: TestAssetDescriptor;
    amountStroops: bigint;
  }): StellarRpc.Api.EventResponse {
    const { escrowId, deliveryId, funder, recipient, asset, amountStroops } = params;
    if (amountStroops <= 0n) {
      throw new Error('Escrow fund amount must be positive');
    }

    const funderBalance = this.balanceOf(asset, funder);
    if (funderBalance < amountStroops) {
      throw new Error(
        `Insufficient ${asset.code} balance: have ${funderBalance}, need ${amountStroops}`,
      );
    }

    const ledgerMap = this.balances.get(asset.contractId)!;
    ledgerMap.set(funder, funderBalance - amountStroops);
    ledgerMap.set(
      this.escrowContractId,
      (ledgerMap.get(this.escrowContractId) ?? 0n) + amountStroops,
    );

    this.escrows.set(escrowId, {
      escrowId,
      deliveryId,
      funder,
      recipient,
      asset,
      amountStroops,
      released: false,
    });

    this.ledger += 1;
    this.eventSeq += 1;
    const txHash = `tx-fund-${this.ledger}-${this.eventSeq}`;

    // Build real Soroban XDR event matching `parseEscrowFundedEvent`
    const payloadMap: Record<string, unknown> = {
      amount: amountStroops,
      asset: asset.code,
      funded_by: funder,
    };
    if (asset.issuer) {
      payloadMap.asset_issuer = asset.issuer;
    }

    return {
      id: `evt-fund-${this.eventSeq}`,
      type: 'contract',
      ledger: this.ledger,
      ledgerClosedAt: new Date().toISOString(),
      contractId: this.escrowContractId,
      txHash,
      topic: [xdr.ScVal.scvSymbol('escrow_funded'), nativeToScVal(deliveryId, { type: 'string' })],
      value: nativeToScVal(payloadMap),
      inSuccessfulContractCall: true,
      pagingToken: `evt-fund-${this.eventSeq}`,
    } as unknown as StellarRpc.Api.EventResponse;
  }

  public releaseEscrow(escrowId: string): StellarRpc.Api.EventResponse {
    const slot = this.escrows.get(escrowId);
    if (!slot) {
      throw new Error(`Unknown escrow ${escrowId}`);
    }
    if (slot.released) {
      throw new Error(`Escrow ${escrowId} already released`);
    }

    const ledgerMap = this.balances.get(slot.asset.contractId)!;
    const contractBalance = ledgerMap.get(this.escrowContractId) ?? 0n;
    if (contractBalance < slot.amountStroops) {
      throw new Error('Escrow contract underfunded');
    }

    ledgerMap.set(this.escrowContractId, contractBalance - slot.amountStroops);
    ledgerMap.set(slot.recipient, (ledgerMap.get(slot.recipient) ?? 0n) + slot.amountStroops);
    slot.released = true;

    this.ledger += 1;
    this.eventSeq += 1;
    const txHash = `tx-release-${this.ledger}-${this.eventSeq}`;
    const timestamp = Math.floor(Date.now() / 1000);

    return {
      id: `evt-release-${this.eventSeq}`,
      type: 'contract',
      ledger: this.ledger,
      ledgerClosedAt: new Date().toISOString(),
      contractId: this.escrowContractId,
      txHash,
      topic: [xdr.ScVal.scvSymbol('escrow_released'), nativeToScVal(escrowId, { type: 'string' })],
      value: nativeToScVal({
        amount: slot.amountStroops,
        asset: slot.asset.code,
        recipient: slot.recipient,
        transaction_hash: txHash,
        ledger: this.ledger,
        timestamp,
      }),
      inSuccessfulContractCall: true,
      pagingToken: `evt-release-${this.eventSeq}`,
    } as unknown as StellarRpc.Api.EventResponse;
  }
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe('E2E Payment-Path Contract Operations: mint -> fund -> release (#343)', () => {
  let mongoServer: MongoMemoryServer;
  let harness: StandaloneSorobanPaymentHarness;

  const nativeXlmAsset: TestAssetDescriptor = {
    code: 'XLM',
    contractId: 'CDNATIVEASSETCONTRACT000000000000000000000000000000000001',
  };

  const issuedUsdcIssuer = Keypair.random().publicKey();
  const issuedUsdcAsset: TestAssetDescriptor = {
    code: 'USDC',
    issuer: issuedUsdcIssuer,
    contractId: 'CDISSUEDUSDCASSETCONTRACT00000000000000000000000000000002',
  };

  const originalUsdcIssuer = process.env.USDC_ASSET_ISSUER;

  beforeAll(async () => {
    process.env.USDC_ASSET_ISSUER = issuedUsdcIssuer;
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 120_000);

  beforeEach(async () => {
    await Promise.all([Delivery.deleteMany({}), Escrow.deleteMany({})]);
    harness = new StandaloneSorobanPaymentHarness();
    harness.registerAsset(nativeXlmAsset);
    harness.registerAsset(issuedUsdcAsset);
  });

  afterAll(async () => {
    if (originalUsdcIssuer === undefined) {
      delete process.env.USDC_ASSET_ISSUER;
    } else {
      process.env.USDC_ASSET_ISSUER = originalUsdcIssuer;
    }
    await mongoose.disconnect();
    await mongoServer.stop();
  }, 30_000);

  const createDeliveryRecord = async (escrowAsset?: {
    code: string;
    issuer?: string;
  }): Promise<string> => {
    const delivery = await Delivery.create({
      deliveryId: `DEL-${Date.now()}-${Math.random()}`,
      trackingNumber: `TRK-${Date.now()}-${Math.random()}`,
      driverId: new Types.ObjectId().toString(),
      userId: new Types.ObjectId().toString(),
      pickupCoordinates: { lat: 6.5244, lng: 3.3792, address: 'Lagos Pickup' },
      dropoffCoordinates: { lat: 6.4549, lng: 3.4246, address: 'Lagos Dropoff' },
      status: DeliveryStatus.PENDING,
      ...(escrowAsset ? { escrowAsset } : {}),
    });
    return delivery._id.toString();
  };

  it('executes full native XLM payment path (mint -> fund -> release) with exact stroop balances', async () => {
    const funder = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const deliveryId = await createDeliveryRecord();

    // 1. Mint 100.0000000 XLM (1,000,000,000 stroops) to funder
    const mintedStroops = toStroops(100);
    expect(mintedStroops).toBe(1_000_000_000n);
    harness.mint(nativeXlmAsset, funder, mintedStroops);

    expect(harness.balanceOf(nativeXlmAsset, funder)).toBe(1_000_000_000n);
    expect(harness.balanceOf(nativeXlmAsset, harness.escrowContractId)).toBe(0n);
    expect(harness.balanceOf(nativeXlmAsset, recipient)).toBe(0n);

    // 2. Fund escrow with 25.0500001 XLM (250,500,001 stroops)
    const paymentStroops = 250_500_001n;
    const fundEvent = harness.fundEscrow({
      escrowId: harness.escrowContractId,
      deliveryId,
      funder,
      recipient,
      asset: nativeXlmAsset,
      amountStroops: paymentStroops,
    });

    // Assert on-chain balances immediately after funding
    expect(harness.balanceOf(nativeXlmAsset, funder)).toBe(749_499_999n);
    expect(harness.balanceOf(nativeXlmAsset, harness.escrowContractId)).toBe(250_500_001n);
    expect(harness.balanceOf(nativeXlmAsset, recipient)).toBe(0n);

    // Process real Soroban `escrow_funded` event through backend handler -> DB
    const fundResult = await handleEscrowFundedEvent(fundEvent, harness.escrowContractId);
    expect(fundResult.status).toBe('processed');

    const fundedEscrow = await Escrow.findOne({ contractId: harness.escrowContractId });
    expect(fundedEscrow).not.toBeNull();
    expect(fundedEscrow?.status).toBe(EscrowStatus.LOCKED);
    expect(fundedEscrow?.assetCode).toBe('XLM');
    expect(fundedEscrow?.amount).toBe(Number(paymentStroops));

    const fundedDelivery = await Delivery.findById(deliveryId);
    expect(fundedDelivery?.status).toBe(DeliveryStatus.FUNDED);

    // 3. Release escrow to recipient
    const releaseEvent = harness.releaseEscrow(harness.escrowContractId);

    // Assert on-chain balances after release: recipient credited, escrow zeroed
    expect(harness.balanceOf(nativeXlmAsset, funder)).toBe(749_499_999n);
    expect(harness.balanceOf(nativeXlmAsset, harness.escrowContractId)).toBe(0n);
    expect(harness.balanceOf(nativeXlmAsset, recipient)).toBe(250_500_001n);
    expect(fromStroops(harness.balanceOf(nativeXlmAsset, recipient))).toBe('25.0500001');

    // Process real Soroban `escrow_released` event through backend handler -> DB
    const releaseResult = await handleEscrowReleasedEvent(releaseEvent);
    expect(releaseResult.status).toBe('processed');

    const releasedEscrow = await Escrow.findOne({ contractId: harness.escrowContractId });
    expect(releasedEscrow?.status).toBe(EscrowStatus.RELEASED);
    expect(releasedEscrow?.releaseTransactionHash).toBe(releaseEvent.txHash);
    expect(releasedEscrow?.transactions.map((t) => t.type)).toEqual(['fund', 'release']);
  });

  it('executes full issued asset (USDC) payment path with stroop-accurate balances and zero rounding drift', async () => {
    const funder = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const deliveryId = await createDeliveryRecord({ code: 'USDC', issuer: issuedUsdcIssuer });

    // 15.99 is a classic IEEE-754 float drift value (15.99 * 1e7 = 159899999.99999997)
    const mintedStroops = toStroops(15.99) + 7n; // 159,900,007 stroops = 15.9900007 USDC
    expect(mintedStroops).toBe(159_900_007n);
    harness.mint(issuedUsdcAsset, funder, mintedStroops);

    expect(harness.balanceOf(issuedUsdcAsset, funder)).toBe(159_900_007n);
    expect(harness.balanceOf(issuedUsdcAsset, harness.escrowContractId)).toBe(0n);
    expect(harness.balanceOf(issuedUsdcAsset, recipient)).toBe(0n);

    // Fund 15.9900003 USDC (leaving exactly 4 stroops on funder)
    const escrowStroops = 159_900_003n;
    const fundEvent = harness.fundEscrow({
      escrowId: harness.escrowContractId,
      deliveryId,
      funder,
      recipient,
      asset: issuedUsdcAsset,
      amountStroops: escrowStroops,
    });

    expect(harness.balanceOf(issuedUsdcAsset, funder)).toBe(4n);
    expect(harness.balanceOf(issuedUsdcAsset, harness.escrowContractId)).toBe(159_900_003n);
    expect(harness.balanceOf(issuedUsdcAsset, recipient)).toBe(0n);

    const fundResult = await handleEscrowFundedEvent(fundEvent, harness.escrowContractId);
    expect(fundResult.status).toBe('processed');

    const fundedEscrow = await Escrow.findOne({ contractId: harness.escrowContractId });
    expect(fundedEscrow?.status).toBe(EscrowStatus.LOCKED);
    expect(fundedEscrow?.assetCode).toBe('USDC');
    expect(fundedEscrow?.assetIssuer).toBe(issuedUsdcIssuer);
    expect(fundedEscrow?.amount).toBe(159_900_003);

    // Release to recipient and verify exact stroop accounting
    const releaseEvent = harness.releaseEscrow(harness.escrowContractId);

    expect(harness.balanceOf(issuedUsdcAsset, funder)).toBe(4n);
    expect(harness.balanceOf(issuedUsdcAsset, harness.escrowContractId)).toBe(0n);
    expect(harness.balanceOf(issuedUsdcAsset, recipient)).toBe(159_900_003n);
    expect(fromStroops(harness.balanceOf(issuedUsdcAsset, recipient))).toBe('15.9900003');
    expect(fromStroops(harness.balanceOf(issuedUsdcAsset, funder))).toBe('0.0000004');

    const releaseResult = await handleEscrowReleasedEvent(releaseEvent);
    expect(releaseResult.status).toBe('processed');

    const releasedEscrow = await Escrow.findOne({ contractId: harness.escrowContractId });
    expect(releasedEscrow?.status).toBe(EscrowStatus.RELEASED);
  });

  it('rejects funding beyond minted balance and prevents double-release', async () => {
    const funder = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const deliveryId = await createDeliveryRecord();

    harness.mint(nativeXlmAsset, funder, 50_000_000n);

    expect(() =>
      harness.fundEscrow({
        escrowId: harness.escrowContractId,
        deliveryId,
        funder,
        recipient,
        asset: nativeXlmAsset,
        amountStroops: 50_000_001n,
      }),
    ).toThrow(/Insufficient XLM balance/);

    expect(harness.balanceOf(nativeXlmAsset, funder)).toBe(50_000_000n);
    expect(harness.balanceOf(nativeXlmAsset, harness.escrowContractId)).toBe(0n);

    harness.fundEscrow({
      escrowId: harness.escrowContractId,
      deliveryId,
      funder,
      recipient,
      asset: nativeXlmAsset,
      amountStroops: 50_000_000n,
    });
    harness.releaseEscrow(harness.escrowContractId);

    expect(() => harness.releaseEscrow(harness.escrowContractId)).toThrow(/already released/);
    expect(harness.balanceOf(nativeXlmAsset, harness.escrowContractId)).toBe(0n);
    expect(harness.balanceOf(nativeXlmAsset, recipient)).toBe(50_000_000n);
  });
});
