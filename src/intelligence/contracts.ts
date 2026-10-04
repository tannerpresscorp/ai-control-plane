import type { AccountQualificationEvidence, CostEvent, UsageEvent } from '../commercial/types.js';

export type IntelligenceCapability =
  | 'intelligence.company.search'
  | 'intelligence.company.enrich'
  | 'intelligence.people.search';

export interface IntelligenceContext {
  readonly tenantId: string;
  readonly runId: string;
  readonly usageEventId: string;
  readonly occurredAt: string;
}

export interface IntelligenceCallContext extends IntelligenceContext {
  readonly capability: IntelligenceCapability;
  readonly source: string;
}

export interface CompanySearchRequest {
  readonly query: string;
}

export interface CompanyEnrichmentRequest {
  readonly domain: string;
}

export interface PeopleSearchRequest {
  readonly companyDomain: string;
  readonly query: string;
}

export interface IntelligenceClaim {
  readonly value: string;
  readonly sourceReference: string;
  readonly confidence: number;
}

export interface CompanyIntelligence {
  readonly sourceReference: string;
  readonly name: IntelligenceClaim;
  readonly fitReasons: readonly IntelligenceClaim[];
  readonly riskSignals: readonly IntelligenceClaim[];
}

export interface PersonIntelligence {
  readonly sourceReference: string;
  readonly name: IntelligenceClaim;
  readonly companyName: IntelligenceClaim;
  readonly role: IntelligenceClaim;
}

export interface IntelligenceCost {
  readonly tenantId: string;
  readonly runId: string;
  readonly usageEventId: string;
  readonly capability: IntelligenceCapability;
  readonly source: string;
  readonly sourceReference: string;
  readonly amountCents: number;
  readonly currency: string;
}

export interface IntelligenceResponse<T> {
  readonly source: string;
  readonly sourceReference: string;
  readonly items: readonly T[];
  readonly cost?: IntelligenceCost;
}

// Boundary responses are untrusted until the governed consumer validates them.
export interface IntelligenceOperations {
  searchCompanies(request: CompanySearchRequest, context: IntelligenceCallContext): Promise<unknown>;
  enrichCompany(request: CompanyEnrichmentRequest, context: IntelligenceCallContext): Promise<unknown>;
  searchPeople(request: PeopleSearchRequest, context: IntelligenceCallContext): Promise<unknown>;
}

export interface IntelligenceProvider extends IntelligenceOperations {
  readonly source: string;
}

export interface IntelligenceLedger {
  recordUsage(event: UsageEvent): Promise<UsageEvent>;
  recordCost(event: CostEvent): Promise<CostEvent>;
  recordAccountQualification(evidence: AccountQualificationEvidence): Promise<AccountQualificationEvidence>;
}

export interface AccountQualificationRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly source: string;
  readonly observedAt: string;
  readonly company: CompanyIntelligence;
}

export interface AccountQualificationMapper {
  mapAccountQualification(request: AccountQualificationRequest): AccountQualificationEvidence | undefined;
}
