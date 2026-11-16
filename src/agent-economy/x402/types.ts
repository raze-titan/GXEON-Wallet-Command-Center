/**
 * GXEON Native x402 Protocol Specification & Domain Types
 * Strict compliance with canonical x402 v2 standard for machine-to-machine micropayments.
 */

export interface X402AcceptOption {
  scheme: 'exact';
  network: string; // e.g. "eip155:8453" (Base Mainnet)
  asset: string; // Token contract address (USDC)
  amount: string; // Atomic units (6 decimals for USDC, e.g. "10000" = 0.01 USDC)
  payTo: string; // GXEON Recipient Address
  maxTimeoutSeconds: number;
  extra?: {
    name?: string;
    version?: string;
    assetTransferMethod?: 'eip3009' | 'transfer';
  };
}

export interface X402Resource {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
}

export interface X402Challenge {
  x402Version: 2;
  status: 402;
  title: string;
  error: string;
  resource: X402Resource;
  extensions?: Record<string, unknown>;
  serviceId: string;
  accepts: X402AcceptOption[];
}

export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface X402PaymentPayload {
  x402Version: 2;
  resource?: X402Resource;
  extensions?: Record<string, unknown>;
  accepted: {
    scheme: 'exact';
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra?: {
      name?: string;
      version?: string;
      assetTransferMethod?: 'eip3009' | 'transfer';
    };
  };
  payload: { signature: string; authorization: Eip3009Authorization };
}

export interface X402PaymentIntent {
  id: string;
  requestHash: string;
  firstBlock: string;
  txHash?: string;
}

export interface X402SettlementVerification {
  settlementId: string;
  txHash: `0x${string}`;
  blockNumber: number;
}

export type X402SettlementState =
  | 'DETECTED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'CLAIMED'
  | 'EXECUTING'
  | 'DELIVERED'
  | 'FAILED'
  | 'REFUNDED';

export interface X402SettlementRecord {
  txHash: string;
  settlementId: string;
  network: string;
  payer: string;
  recipient: string;
  asset: string;
  amountAtomic: string;
  amountUsdc: number;
  serviceId: string;
  quantity: number;
  state: X402SettlementState;
  claimedAt: string;
  blockNumber?: number;
  jobId?: string;
  receiptId?: string;
  updatedAt?: string;
}

export interface X402Receipt {
  receiptId: string;
  seller: 'GXEON';
  buyer: string;
  serviceId: string;
  quantity: number;
  paymentRail: 'x402';
  currency: 'USDC';
  amountAtomic: string;
  amountUsdc: string; // Formatted USDC e.g. "0.010000"
  network: string;
  settlementId: string;
  txHash: string;
  blockNumber: string | number;
  jobId: string;
  resultHash: string;
  evidenceHash: string;
  createdAt: string;
}

export interface MachineRevenueRecord {
  revenueId: string;
  rail: 'x402';
  asset: 'USDC';
  network: string;
  txHash: string;
  serviceId: string;
  buyer: string;
  amountAtomic: string;
  amountUsdc: number;
  status: 'SETTLED';
  verifiedAt: string;
  jobId?: string;
  receiptId?: string;
}

export interface MachineCustomerRecord {
  machineCustomerId: string;
  payerAddress: string;
  firstPurchaseAt: string;
  lastPurchaseAt: string;
  jobsPurchased: number;
  totalUsdcPaid: number;
  servicesUsed: string[];
}

export interface X402SettlementResponse {
  x402Version: 2;
  status: 'SUCCESS';
  success: true;
  transaction: string;
  network: string;
  payer: string;
  settlementId: string;
  txHash?: string;
  blockNumber?: number | string;
  receiptId: string;
  amountUsdc: string;
  serviceId: string;
  timestamp: string;
}

export type TreasuryStatus = 'TREASURY_VERIFIED' | 'TREASURY_UNVERIFIED';
