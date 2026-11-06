import type { RegistryInput } from '@/editor/registry';

/**
 * The real registry with a stub standing in for each family it does not have yet, and the
 * stub cards for kinds no real card covers. A family registered for real shows on `/next`
 * the moment it is, with nobody touching the stub.
 */
export function withStubs(real: RegistryInput, stub: RegistryInput): RegistryInput {
  const families = stub.families.map((f) => real.families.find((r) => r.id === f.id) ?? f);
  const extra = real.families.filter((r) => !families.includes(r));
  const kinds = new Set(real.cards.map((c) => c.kind));
  return {
    rail: real.rail,
    shared: real.shared,
    families: [...families, ...extra],
    cards: [...real.cards, ...stub.cards.filter((c) => !kinds.has(c.kind))],
  };
}
