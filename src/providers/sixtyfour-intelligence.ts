import type {
  CompanyEnrichmentRequest,
  CompanySearchRequest,
  IntelligenceCallContext,
  IntelligenceOperations,
  IntelligenceProvider,
  PeopleSearchRequest
} from '../intelligence/contracts.js';

// A normalized application boundary, not a contract for a live Sixtyfour SDK.
export interface SixtyfourBoundary extends IntelligenceOperations {}

export class SixtyfourIntelligenceAdapter implements IntelligenceProvider {
  readonly source = 'sixtyfour';

  constructor(private readonly boundary: SixtyfourBoundary) {}

  searchCompanies(request: CompanySearchRequest, context: IntelligenceCallContext): Promise<unknown> {
    return this.boundary.searchCompanies(request, context);
  }

  enrichCompany(request: CompanyEnrichmentRequest, context: IntelligenceCallContext): Promise<unknown> {
    return this.boundary.enrichCompany(request, context);
  }

  searchPeople(request: PeopleSearchRequest, context: IntelligenceCallContext): Promise<unknown> {
    return this.boundary.searchPeople(request, context);
  }
}
