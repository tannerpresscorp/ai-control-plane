import type { CompanyIntelligence, IntelligenceClaim, PersonIntelligence } from './contracts.js';

export function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function nonblank(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

export function timestamp(value: unknown, label: string): string {
  const result = nonblank(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be a valid timestamp`);
  return result;
}

export function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function claim(value: unknown, sourceReference: string): IntelligenceClaim {
  const data = object(value, 'Intelligence claim');
  const reference = nonblank(data.sourceReference, 'Claim source reference');
  if (reference !== sourceReference) throw new Error('Claim source reference must match its record');
  const confidence = data.confidence === undefined ? 0 : data.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('Claim confidence must be between 0 and 1');
  }
  return { value: nonblank(data.value, 'Claim value'), sourceReference: reference, confidence };
}

export function company(value: unknown): CompanyIntelligence {
  const data = object(value, 'Company intelligence');
  const sourceReference = nonblank(data.sourceReference, 'Company source reference');
  return {
    sourceReference,
    name: claim(data.name, sourceReference),
    fitReasons: array(data.fitReasons, 'Fit reasons').map((item) => claim(item, sourceReference)),
    riskSignals: array(data.riskSignals, 'Risk signals').map((item) => claim(item, sourceReference))
  };
}

export function person(value: unknown): PersonIntelligence {
  const data = object(value, 'Person intelligence');
  const sourceReference = nonblank(data.sourceReference, 'Person source reference');
  return {
    sourceReference,
    name: claim(data.name, sourceReference),
    companyName: claim(data.companyName, sourceReference),
    role: claim(data.role, sourceReference)
  };
}
