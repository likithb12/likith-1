import type { CategorisationRule, MatchType } from '../types'

/**
 * Categorisation rules.
 *
 * Applied on import and re-runnable over already-imported uncategorised
 * transactions. Lowest `priority` wins; ties break on creation order, so the
 * result is deterministic rather than dependent on row order from the server.
 */

export interface RuleLike {
  id: string
  match_type: MatchType
  pattern: string
  category_id: string
  priority: number
}

/** A regex that fails to compile must not take the import down with it. */
function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

export function ruleMatches(rule: RuleLike, description: string): boolean {
  const haystack = (description ?? '').toLowerCase()
  const needle = (rule.pattern ?? '').toLowerCase()
  if (needle === '') return false

  switch (rule.match_type) {
    case 'contains':
      return haystack.includes(needle)
    case 'starts_with':
      return haystack.startsWith(needle)
    case 'regex': {
      const regex = safeRegex(rule.pattern)
      return regex ? regex.test(description ?? '') : false
    }
    default:
      return false
  }
}

/** Rules in the order they should be tried. */
export function orderRules<T extends RuleLike>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
}

/** The category the first matching rule assigns, or null. */
export function categoriseDescription<T extends RuleLike>(
  description: string,
  rules: T[],
  preOrdered = false,
): string | null {
  const ordered = preOrdered ? rules : orderRules(rules)
  for (const rule of ordered) {
    if (ruleMatches(rule, description)) return rule.category_id
  }
  return null
}

/** Which rule matched, for explaining the result in the UI. */
export function findMatchingRule<T extends RuleLike>(description: string, rules: T[]): T | null {
  for (const rule of orderRules(rules)) {
    if (ruleMatches(rule, description)) return rule
  }
  return null
}

export function isValidPattern(matchType: MatchType, pattern: string): boolean {
  if (pattern.trim() === '') return false
  if (matchType !== 'regex') return true
  return safeRegex(pattern) !== null
}

export type { CategorisationRule }
