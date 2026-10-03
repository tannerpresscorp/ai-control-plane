import type {
  AccountQualificationEvidence,
  BillingEvent,
  BillingRequest,
  CapabilityEntitlement,
  CostEvent,
  EntitlementPolicy,
  TenantRecord,
  UsageEvent
} from './types.js';

function assertNonBlank(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function inPeriod(value: string, request: BillingRequest): boolean {
  return value >= request.periodStart && value < request.periodEnd;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryCommercialLedger {
  readonly #tenants = new Map<string, TenantRecord>();
  readonly #policies = new Map<string, EntitlementPolicy>();
  readonly #usage = new Map<string, UsageEvent>();
  readonly #costs = new Map<string, CostEvent>();
  readonly #qualifications = new Map<string, AccountQualificationEvidence>();

  async createTenant(tenant: TenantRecord): Promise<void> {
    assertNonBlank(tenant.id, 'Tenant id');
    assertNonBlank(tenant.name, 'Tenant name');
    assertNonBlank(tenant.plan, 'Tenant plan');
    assertNonBlank(tenant.createdAt, 'Tenant createdAt');
    if (this.#tenants.has(tenant.id)) throw new Error(`Tenant already exists: ${tenant.id}`);
    this.#tenants.set(tenant.id, clone(tenant));
  }

  async setEntitlementPolicy(policy: EntitlementPolicy): Promise<void> {
    this.#requireTenant(policy.tenantId);
    assertNonBlank(policy.effectiveAt, 'Entitlement effectiveAt');
    if (policy.capabilities.length === 0) throw new Error('Entitlement policy requires capabilities');
    const seen = new Set<string>();
    for (const entitlement of policy.capabilities) {
      this.#validateEntitlement(entitlement);
      if (seen.has(entitlement.capability)) throw new Error(`Duplicate entitlement capability: ${entitlement.capability}`);
      seen.add(entitlement.capability);
    }
    this.#policies.set(policy.tenantId, clone(policy));
  }

  async recordUsage(event: UsageEvent): Promise<UsageEvent> {
    this.#requireTenant(event.tenantId);
    assertNonBlank(event.id, 'Usage id');
    assertNonBlank(event.capability, 'Usage capability');
    assertPositiveSafeInteger(event.quantity, 'Usage quantity');
    assertNonBlank(event.source, 'Usage source');
    assertNonBlank(event.occurredAt, 'Usage occurredAt');
    if (!event.runId || event.runId.trim().length === 0) throw new Error('Usage event requires run provenance');
    if (this.#usage.has(event.id)) throw new Error(`Usage event already exists: ${event.id}`);

    const entitlement = this.#requireEntitlement(event.tenantId, event.capability);
    const consumed = this.#usageFor(event.tenantId, event.capability).reduce((sum, item) => sum + item.quantity, 0);
    if (consumed + event.quantity > entitlement.monthlyUnitLimit) {
      throw new Error(`Usage exceeds entitlement limit for ${event.capability}`);
    }

    this.#usage.set(event.id, clone(event));
    return clone(event);
  }

  async recordCost(event: CostEvent): Promise<CostEvent> {
    this.#requireTenant(event.tenantId);
    assertNonBlank(event.id, 'Cost id');
    assertNonBlank(event.provider, 'Cost provider');
    assertNonNegativeSafeInteger(event.amountCents, 'Cost amountCents');
    if (!/^[A-Z]{3}$/.test(event.currency)) throw new Error('Cost currency must be ISO-like uppercase code');
    assertNonBlank(event.runId, 'Cost runId');
    assertNonBlank(event.usageEventId, 'Cost usageEventId');
    assertNonBlank(event.occurredAt, 'Cost occurredAt');
    if (this.#costs.has(event.id)) throw new Error(`Cost event already exists: ${event.id}`);

    const usage = this.#usage.get(event.usageEventId);
    if (!usage || usage.tenantId !== event.tenantId || usage.runId !== event.runId) {
      throw new Error('Cost event requires matching usage provenance');
    }

    this.#costs.set(event.id, clone(event));
    return clone(event);
  }

  async createBillingEvents(request: BillingRequest): Promise<readonly BillingEvent[]> {
    this.#requireTenant(request.tenantId);
    assertNonBlank(request.periodStart, 'Billing periodStart');
    assertNonBlank(request.periodEnd, 'Billing periodEnd');
    assertNonBlank(request.generatedAt, 'Billing generatedAt');
    if (request.periodStart >= request.periodEnd) throw new Error('Billing period must have positive duration');

    const policy = this.#policies.get(request.tenantId);
    if (!policy) throw new Error(`Missing entitlement policy for tenant: ${request.tenantId}`);

    const result: BillingEvent[] = [];
    for (const entitlement of policy.capabilities) {
      const usage = this.#usageFor(request.tenantId, entitlement.capability).filter((event) => inPeriod(event.occurredAt, request));
      if (usage.length === 0) continue;
      const quantity = usage.reduce((sum, event) => sum + event.quantity, 0);
      const billableQuantity = Math.max(0, quantity - entitlement.includedUnits);
      result.push({
        id: `bill_${request.tenantId}_${entitlement.capability}_${request.periodStart}`,
        tenantId: request.tenantId,
        capability: entitlement.capability,
        quantity,
        includedUnits: entitlement.includedUnits,
        billableQuantity,
        unitPriceCents: entitlement.unitPriceCents,
        amountCents: billableQuantity * entitlement.unitPriceCents,
        periodStart: request.periodStart,
        periodEnd: request.periodEnd,
        generatedAt: request.generatedAt,
        evidenceEventIds: usage.map((event) => event.id)
      });
    }
    return clone(result);
  }

  async recordAccountQualification(evidence: AccountQualificationEvidence): Promise<AccountQualificationEvidence> {
    this.#requireTenant(evidence.tenantId);
    assertNonBlank(evidence.id, 'Qualification id');
    assertNonBlank(evidence.targetAccountName, 'Target account name');
    assertNonBlank(evidence.source, 'Qualification source');
    assertNonBlank(evidence.sourceReference, 'Qualification source reference');
    if (typeof evidence.confidence !== 'number' || evidence.confidence < 0 || evidence.confidence > 1) throw new Error('Qualification confidence must be between 0 and 1');
    if (evidence.fitReasons.length === 0) throw new Error('Qualification requires fit reasons');
    assertNonBlank(evidence.observedAt, 'Qualification observedAt');
    if (this.#qualifications.has(evidence.id)) throw new Error(`Qualification already exists: ${evidence.id}`);
    this.#qualifications.set(evidence.id, clone(evidence));
    return clone(evidence);
  }

  async listAccountQualifications(tenantId: string): Promise<readonly AccountQualificationEvidence[]> {
    this.#requireTenant(tenantId);
    return clone([...this.#qualifications.values()].filter((evidence) => evidence.tenantId === tenantId));
  }

  #requireTenant(tenantId: string): TenantRecord {
    assertNonBlank(tenantId, 'Tenant id');
    const tenant = this.#tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
    return tenant;
  }

  #requireEntitlement(tenantId: string, capability: string): CapabilityEntitlement {
    const policy = this.#policies.get(tenantId);
    if (!policy) throw new Error(`Missing entitlement policy for tenant: ${tenantId}`);
    const entitlement = policy.capabilities.find((item) => item.capability === capability);
    if (!entitlement) throw new Error(`Capability is not entitled: ${capability}`);
    return entitlement;
  }

  #usageFor(tenantId: string, capability: string): UsageEvent[] {
    return [...this.#usage.values()].filter((event) => event.tenantId === tenantId && event.capability === capability);
  }

  #validateEntitlement(entitlement: CapabilityEntitlement): void {
    assertNonBlank(entitlement.capability, 'Entitlement capability');
    assertPositiveSafeInteger(entitlement.monthlyUnitLimit, 'Entitlement monthlyUnitLimit');
    assertNonNegativeSafeInteger(entitlement.unitPriceCents, 'Entitlement unitPriceCents');
    assertNonNegativeSafeInteger(entitlement.includedUnits, 'Entitlement includedUnits');
    if (entitlement.includedUnits > entitlement.monthlyUnitLimit) throw new Error('Included units cannot exceed monthly limit');
  }
}
