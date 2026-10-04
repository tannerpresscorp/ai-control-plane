import type { AccountQualificationEvidence, UsageEvent } from '../commercial/types.js';
import { mapAccountQualification } from './account-qualification.js';
import type {
  CompanyEnrichmentRequest,
  CompanyIntelligence,
  CompanySearchRequest,
  IntelligenceCallContext,
  IntelligenceCapability,
  IntelligenceContext,
  IntelligenceCost,
  IntelligenceLedger,
  IntelligenceProvider,
  IntelligenceResponse,
  PeopleSearchRequest,
  PersonIntelligence
} from './contracts.js';
import { array, company, nonblank, object, person, timestamp } from './validation.js';

export class GovernedIntelligence {
  constructor(
    private readonly provider: IntelligenceProvider,
    private readonly ledger: IntelligenceLedger
  ) {}

  searchCompanies(request: CompanySearchRequest, context: IntelligenceContext): Promise<IntelligenceResponse<CompanyIntelligence>> {
    const query = nonblank(request.query, 'Company query');
    return this.#execute('intelligence.company.search', context,
      (call) => this.provider.searchCompanies({ query }, call), company);
  }

  enrichCompany(request: CompanyEnrichmentRequest, context: IntelligenceContext): Promise<IntelligenceResponse<CompanyIntelligence>> {
    const domain = nonblank(request.domain, 'Company domain');
    return this.#execute('intelligence.company.enrich', context,
      (call) => this.provider.enrichCompany({ domain }, call), company);
  }

  searchPeople(request: PeopleSearchRequest, context: IntelligenceContext): Promise<IntelligenceResponse<PersonIntelligence>> {
    const companyDomain = nonblank(request.companyDomain, 'Company domain');
    const query = nonblank(request.query, 'People query');
    return this.#execute('intelligence.people.search', context,
      (call) => this.provider.searchPeople({ companyDomain, query }, call), person);
  }

  async qualifyAccount(
    request: CompanyEnrichmentRequest,
    context: IntelligenceContext
  ): Promise<readonly AccountQualificationEvidence[]> {
    const snapshot = { ...context };
    const response = await this.enrichCompany(request, snapshot);
    const evidence = response.items.map((item, index) => mapAccountQualification({
      id: `${snapshot.usageEventId}:qualification:${index}`,
      tenantId: snapshot.tenantId,
      source: response.source,
      observedAt: snapshot.occurredAt,
      company: item
    })).filter((item): item is AccountQualificationEvidence => item !== undefined);
    const recorded: AccountQualificationEvidence[] = [];
    for (const item of evidence) recorded.push(await this.ledger.recordAccountQualification(item));
    return recorded;
  }

  async #execute<T>(
    capability: IntelligenceCapability,
    context: IntelligenceContext,
    invoke: (context: IntelligenceCallContext) => Promise<unknown>,
    parseItem: (value: unknown) => T
  ): Promise<IntelligenceResponse<T>> {
    const call = Object.freeze({
      tenantId: nonblank(context.tenantId, 'Tenant id'),
      runId: nonblank(context.runId, 'Run id'),
      usageEventId: nonblank(context.usageEventId, 'Usage id'),
      occurredAt: timestamp(context.occurredAt, 'Usage occurredAt'),
      capability,
      source: nonblank(this.provider.source, 'Provider source')
    });
    const usage: UsageEvent = {
      id: call.usageEventId,
      tenantId: call.tenantId,
      runId: call.runId,
      capability,
      quantity: 1,
      source: call.source,
      occurredAt: call.occurredAt
    };
    await this.ledger.recordUsage(usage);
    const data = object(await invoke(call), 'Intelligence response');
    const source = nonblank(data.source, 'Response source');
    if (source !== call.source) throw new Error('Response source must match usage provenance');
    const sourceReference = nonblank(data.sourceReference, 'Response source reference');
    const cost = data.cost === undefined ? undefined : this.#cost(data.cost, call, sourceReference);
    if (cost) {
      await this.ledger.recordCost({
        id: `${call.usageEventId}:cost`,
        tenantId: call.tenantId,
        runId: call.runId,
        usageEventId: call.usageEventId,
        provider: source,
        sourceReference: cost.sourceReference,
        amountCents: cost.amountCents,
        currency: cost.currency,
        occurredAt: call.occurredAt
      });
    }
    const items = array(data.items, 'Response items').map(parseItem);
    return { source, sourceReference, items, ...(cost ? { cost } : {}) };
  }

  #cost(value: unknown, call: IntelligenceCallContext, sourceReference: string): IntelligenceCost {
    const data = object(value, 'Provider cost');
    for (const key of ['tenantId', 'runId', 'usageEventId', 'capability', 'source'] as const) {
      if (data[key] !== call[key]) throw new Error(`Cost ${key} must match usage provenance`);
    }
    if (nonblank(data.sourceReference, 'Cost source reference') !== sourceReference) {
      throw new Error('Cost source reference must match response provenance');
    }
    const amountCents = data.amountCents;
    if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents) || amountCents < 0) {
      throw new Error('Cost amountCents must be a non-negative safe integer');
    }
    const currency = nonblank(data.currency, 'Cost currency');
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Cost currency must be ISO-like uppercase code');
    return {
      tenantId: call.tenantId,
      runId: call.runId,
      usageEventId: call.usageEventId,
      capability: call.capability,
      source: call.source,
      sourceReference,
      amountCents,
      currency
    };
  }
}
