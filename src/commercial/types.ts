export interface TenantRecord {
  readonly id: string;
  readonly name: string;
  readonly plan: string;
  readonly createdAt: string;
}

export interface CapabilityEntitlement {
  readonly capability: string;
  readonly monthlyUnitLimit: number;
  readonly unitPriceCents: number;
  readonly includedUnits: number;
}

export interface EntitlementPolicy {
  readonly tenantId: string;
  readonly effectiveAt: string;
  readonly capabilities: readonly CapabilityEntitlement[];
}

export interface TrustedRunReference {
  readonly id: string;
  readonly tenantId?: string;
  readonly source: string;
  readonly observedAt: string;
}

export interface UsageEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly capability: string;
  readonly quantity: number;
  readonly source: string;
  readonly runId: string;
  readonly occurredAt: string;
}

export interface CostEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly runId: string;
  readonly usageEventId: string;
  readonly sourceReference?: string;
  readonly occurredAt: string;
}

export interface BillingRequest {
  readonly tenantId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly generatedAt: string;
}

export interface BillingEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly capability: string;
  readonly quantity: number;
  readonly includedUnits: number;
  readonly billableQuantity: number;
  readonly unitPriceCents: number;
  readonly amountCents: number;
  readonly entitlementEffectiveAt: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly generatedAt: string;
  readonly evidenceEventIds: readonly string[];
}

export interface AccountQualificationEvidence {
  readonly id: string;
  readonly tenantId: string;
  readonly targetAccountName: string;
  readonly source: string;
  readonly sourceReference: string;
  readonly confidence: number;
  readonly fitReasons: readonly string[];
  readonly riskSignals: readonly string[];
  readonly observedAt: string;
}
