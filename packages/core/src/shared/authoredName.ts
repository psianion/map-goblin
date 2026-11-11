import type { AnyChild } from './types';

/**
 * The next free `"{prefix} {n}"` on a layer.
 *
 * Counting how many already exist gets this wrong the moment one is deleted:
 * place two, delete the first, place again and the count says 2 — a second
 * "Single 2", and now the layers panel and the DM's own notes name two
 * different doors the same thing. Reading the highest number actually in use
 * instead means a name is only ever handed out once per layer.
 */
export function nextAuthoredName(children: readonly Pick<AnyChild, 'name'>[], prefix: string): string {
  const pattern = new RegExp(`^${prefix} (\\d+)$`);
  let highest = 0;
  for (const child of children) {
    // NaN when the name is not `"{prefix} {digits}"` at all, and NaN > n is false.
    const n = Number(pattern.exec(child.name)?.[1]);
    if (n > highest) highest = n;
  }
  return `${prefix} ${highest + 1}`;
}
