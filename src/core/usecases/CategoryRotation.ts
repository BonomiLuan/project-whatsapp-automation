import type { RotationCursor } from '../ports/RotationStore.js'

/**
 * Pure function: advances the round-robin index and returns the next category
 * along with the updated cursor. Does not mutate inputs.
 *
 * @param cursor - Current rotation state (roundRobinIndex, lastSource)
 * @param allCategories - The full ordered list of categories to cycle through
 * @returns The category at the current index and an updated cursor with the incremented index
 */
export function nextCategory(
  cursor: RotationCursor,
  allCategories: string[]
): { nextCursor: RotationCursor; category: string } {
  const index = cursor.roundRobinIndex % allCategories.length
  const category = allCategories[index]
  const nextCursor: RotationCursor = {
    roundRobinIndex: cursor.roundRobinIndex + 1,
    lastSource: cursor.lastSource,
  }
  return { nextCursor, category }
}

/**
 * Pure function: given a list of deal candidates and the last sent source,
 * returns a filtered list preferring candidates from a different source.
 *
 * - If lastSource is null, returns candidates unchanged.
 * - If at least one candidate has a different marketplace than lastSource, returns only those.
 * - If ALL candidates share the same marketplace as lastSource, returns the original list.
 *
 * @param candidates - Array of objects with a `marketplace` property
 * @param lastSource - The marketplace of the last sent deal, or null
 */
export function preferDifferentSource<T extends { marketplace: string }>(
  candidates: T[],
  lastSource: string | null
): T[] {
  if (lastSource === null) return candidates

  const alternatives = candidates.filter(c => c.marketplace !== lastSource)
  if (alternatives.length > 0) return alternatives

  // All candidates share the same source — no viable alternative, return original
  return candidates
}
