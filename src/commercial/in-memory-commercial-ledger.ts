import type {
  AccountQualificationEvidence,
  BillingEvent,
  BillingRequest,
  CapabilityEntitlement,
  CostEvent,
  EntitlementPolicy,
  TenantRecord,
  TrustedRunReference,
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

function assertNonblankStrings(values: readonly string[], label: string): void {
  if (values.length === 0) throw new Error(`${label} requires at least one value`);
  for (const value of values) assertNonBlank(value, label);
}

function parseTimestamp(value: string, label: string): number {
  assertNonBlank(value, label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp`);
  return parsed;
}

function canonicalTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function inPeriod(value: string, request: BillingRequest): boolean {
  const instant = parseTimestamp(value, 'Event occurredAt');
  return instant >= parseTimestamp(request.periodStart, 'Billing periodStart') && instant < parseTimestamp(request.periodEnd, 'Billing periodEnd');
}

function monthKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function nextUtcMonthStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0);
}

function assertFullUtcMonth(request: BillingRequest): { startMs: number; endMs: number; startIso: string; endIso: string } {
  const startMs = parseTimestamp(request.periodStart, 'Billing periodStart');
  const endMs = parseTimestamp(request.periodEnd, 'Billing periodEnd');
  const start = new Date(startMs);
  const startsAtMonthBoundary = start.getUTCDate() === 1 && start.getUTCHours() === 0 && start.getUTCMinutes() === 0 && start.getUTCSeconds() === 0 && start.getUTCMilliseconds() === 0;
  if (!startsAtMonthBoundary || endMs !== nextUtcMonthStart(startMs)) {
    throw new Error('Billing period must be one full UTC month');
  }
  return { startMs, endMs, startIso: canonicalTimestamp(startMs), endIso: canonicalTimestamp(endMs) };
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds safe integer range`);
  return result;
}

function safeMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds safe integer range`);
  return result;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryCommercialLedger {
  readonly #tenants = new Map<string, TenantRecord>();
  readonly #policies = new Map<string, EntitlementPolicy[]>();
  readonly #trustedRuns = new Map<string, TrustedRunReference>();
  readonly #usage = new Map<string, UsageEvent>();
  readonly #costs = new Map<string, CostEvent>();
  readonly #qualifications = new Map<string, AccountQualificationEvidence>();

  async createTenant(tenant: TenantRecord): Promise<void> {
    assertNonBlank(tenant.id, 'Tenant id');
    assertNonBlank(tenant.name, 'Tenant name');
    assertNonBlank(tenant.plan, 'Tenant plan');
    parseTimestamp(tenant.createdAt, 'Tenant createdAt');
    if (this.#tenants.has(tenant.id)) throw new Error(`Tenant already exists: ${tenant.id}`);
    this.#tenants.set(tenant.id, clone(tenant));
  }

  async registerTrustedRun(run: TrustedRunReference): Promise<void> {
    assertNonBlank(run.id, 'Run id');
    assertNonBlank(run.source, 'Run source');
    parseTimestamp(run.observedAt, 'Run observedAt');
    if (run.tenantId) this.#requireTenant(run.tenantId);
    if (this.#trustedRuns.has(run.id)) throw new Error(`Trusted run already exists: ${run.id}`);
    this.#trustedRuns.set(run.id, clone(run));
  }

  async setEntitlementPolicy(policy: EntitlementPolicy): Promise<void> {
    this.#requireTenant(policy.tenantId);
    const effectiveAtMs = parseTimestamp(policy.effectiveAt, 'Entitlement effectiveAt');
    if (policy.capabilities.length === 0) throw new Error('Entitlement policy requires capabilities');
    const seen = new Set<string>();
    for (const entitlement of policy.capabilities) {
      this.#validateEntitlement(entitlement);
      if (seen.has(entitlement.capability)) throw new Error(`Duplicate entitlement capability: ${entitlement.capability}`);
      seen.add(entitlement.capability);
    }
    const policies = this.#policies.get(policy.tenantId) ?? [];
    if (policies.some((existing) => existing.effectiveAt === policy.effectiveAt)) throw new Error(`Entitlement policy already exists at ${policy.effectiveAt}`);
    policies.push(clone(policy));
    policies.sort((left, right) => parseTimestamp(left.effectiveAt, 'Entitlement effectiveAt') - parseTimestamp(right.effectiveAt, 'Entitlement effectiveAt'));
    if (!Number.isFinite(effectiveAtMs)) throw new Error('Entitlement effectiveAt must be valid');
    this.#policies.set(policy.tenantId, policies);
  }

  async recordUsage(event: UsageEvent): Promise<UsageEvent> {
    this.#requireTenant(event.tenantId);
    assertNonBlank(event.id, 'Usage id');
    assertNonBlank(event.capability, 'Usage capability');
    assertPositiveSafeInteger(event.quantity, 'Usage quantity');
    assertNonBlank(event.source, 'Usage source');
    const occurredAtMs = parseTimestamp(event.occurredAt, 'Usage occurredAt');
    this.#requireTrustedRun(event.runId, event.tenantId);
    if (this.#usage.has(event.id)) throw new Error(`Usage event already exists: ${event.id}`);

    const entitlement = this.#requireEntitlementAt(event.tenantId, event.capability, occurredAtMs);
    const usageMonth = monthKey(occurredAtMs);
    const consumed = this.#usageFor(event.tenantId, event.capability)
      .filter((item) => monthKey(parseTimestamp(item.occurredAt, 'Usage occurredAt')) === usageMonth)
      .reduce((sum, item) => safeAdd(sum, item.quantity, 'Monthly usage quantity'), 0);
    if (safeAdd(consumed, event.quantity, 'Monthly usage quantity') > entitlement.monthlyUnitLimit) {
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
    if (event.sourceReference !== undefined) assertNonBlank(event.sourceReference, 'Cost source reference');
    parseTimestamp(event.occurredAt, 'Cost occurredAt');
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
    const period = assertFullUtcMonth(request);
    parseTimestamp(request.generatedAt, 'Billing generatedAt');

    const usageByPolicyAndCapability = new Map<string, { entitlement: CapabilityEntitlement; effectiveAt: string; usage: UsageEvent[] }>();
    for (const event of [...this.#usage.values()].filter((item) => item.tenantId === request.tenantId && inPeriod(item.occurredAt, request))) {
      const occurredAtMs = parseTimestamp(event.occurredAt, 'Usage occurredAt');
      const policy = this.#requirePolicyAt(request.tenantId, occurredAtMs);
      const entitlement = policy.capabilities.find((item) => item.capability === event.capability);
      if (!entitlement) continue;
      const key = `${policy.effectiveAt}\u0000${event.capability}`;
      const bucket = usageByPolicyAndCapability.get(key) ?? { entitlement, effectiveAt: policy.effectiveAt, usage: [] };
      bucket.usage.push(event);
      usageByPolicyAndCapability.set(key, bucket);
    }

    const result: BillingEvent[] = [];
    for (const { entitlement, effectiveAt, usage } of usageByPolicyAndCapability.values()) {
      const quantity = usage.reduce((sum, event) => safeAdd(sum, event.quantity, 'Billing quantity'), 0);
      const billableQuantity = Math.max(0, quantity - entitlement.includedUnits);
      result.push({
        id: `bill_${request.tenantId}_${entitlement.capability}_${period.startIso}_${period.endIso}_${effectiveAt}`,
        tenantId: request.tenantId,
        capability: entitlement.capability,
        quantity,
        includedUnits: entitlement.includedUnits,
        billableQuantity,
        unitPriceCents: entitlement.unitPriceCents,
        amountCents: safeMultiply(billableQuantity, entitlement.unitPriceCents, 'Billing amountCents'),
        entitlementEffectiveAt: effectiveAt,
        periodStart: period.startIso,
        periodEnd: period.endIso,
        generatedAt: request.generatedAt,
        evidenceEventIds: usage.map((event) => event.id)
      });
    }
    result.sort((left, right) => left.id.localeCompare(right.id));
    return clone(result);
  }

  async recordAccountQualification(evidence: AccountQualificationEvidence): Promise<AccountQualificationEvidence> {
    this.#requireTenant(evidence.tenantId);
    assertNonBlank(evidence.id, 'Qualification id');
    assertNonBlank(evidence.targetAccountName, 'Target account name');
    assertNonBlank(evidence.source, 'Qualification source');
    assertNonBlank(evidence.sourceReference, 'Qualification source reference');
    if (!Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1) throw new Error('Qualification confidence must be between 0 and 1');
    assertNonblankStrings(evidence.fitReasons, 'Qualification fit reasons');
    parseTimestamp(evidence.observedAt, 'Qualification observedAt');
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

  #requireTrustedRun(runId: string, tenantId: string): TrustedRunReference {
    assertNonBlank(runId, 'Usage runId');
    const run = this.#trustedRuns.get(runId);
    if (!run) throw new Error('Usage event requires trusted run provenance');
    if (run.tenantId && run.tenantId !== tenantId) throw new Error('Usage event run provenance belongs to another tenant');
    return run;
  }

  #requirePolicyAt(tenantId: string, atMs: number): EntitlementPolicy {
    const policies = this.#policies.get(tenantId) ?? [];
    const policy = [...policies].reverse().find((item) => parseTimestamp(item.effectiveAt, 'Entitlement effectiveAt') <= atMs);
    if (!policy) throw new Error(`Missing entitlement policy for tenant at usage time: ${tenantId}`);
    return policy;
  }

  #requireEntitlementAt(tenantId: string, capability: string, atMs: number): CapabilityEntitlement {
    const policy = this.#requirePolicyAt(tenantId, atMs);
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
