import type { AccountQualificationEvidence } from '../commercial/types.js';
import type { AccountQualificationRequest } from './contracts.js';
import { company, nonblank, timestamp } from './validation.js';

export function mapAccountQualification(request: AccountQualificationRequest): AccountQualificationEvidence | undefined {
  const id = nonblank(request.id, 'Qualification id');
  const tenantId = nonblank(request.tenantId, 'Tenant id');
  const source = nonblank(request.source, 'Qualification source');
  const observedAt = timestamp(request.observedAt, 'Qualification observedAt');
  const record = company(request.company);
  if (record.fitReasons.length === 0) return undefined;
  const confidence = Math.min(record.name.confidence, ...record.fitReasons.map((reason) => reason.confidence));
  if (confidence < 0.5) return undefined;
  return {
    id,
    tenantId,
    source,
    sourceReference: record.sourceReference,
    targetAccountName: record.name.value,
    confidence,
    fitReasons: record.fitReasons.map((reason) => reason.value),
    riskSignals: record.riskSignals.map((signal) => signal.value),
    observedAt
  };
}
