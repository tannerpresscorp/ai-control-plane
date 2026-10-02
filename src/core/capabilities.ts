import type { CapabilityDefinition } from './types.js';

export class CapabilityRegistry {
  readonly #capabilities = new Map<string, CapabilityDefinition>();

  register(capability: CapabilityDefinition): void {
    if (this.#capabilities.has(capability.name)) {
      throw new Error(`Capability already registered: ${capability.name}`);
    }
    this.#capabilities.set(capability.name, Object.freeze({ ...capability }));
  }

  resolve(name: string): CapabilityDefinition | undefined {
    return this.#capabilities.get(name);
  }

  list(): readonly CapabilityDefinition[] {
    return [...this.#capabilities.values()];
  }
}
