import { describe, expect, it } from 'vitest'
import { categoriseDescription, findMatchingRule, isValidPattern, orderRules, ruleMatches } from './rules'
import type { RuleLike } from './rules'

const rule = (overrides: Partial<RuleLike> & { id: string }): RuleLike => ({
  match_type: 'contains',
  pattern: 'x',
  category_id: 'cat',
  priority: 100,
  ...overrides,
})

describe('ruleMatches', () => {
  it('matches "contains" case-insensitively', () => {
    const r = rule({ id: '1', pattern: 'woolworths' })
    expect(ruleMatches(r, 'EFTPOS WOOLWORTHS 1234')).toBe(true)
    expect(ruleMatches(r, 'COLES')).toBe(false)
  })

  it('matches "starts_with" only at the start', () => {
    const r = rule({ id: '1', match_type: 'starts_with', pattern: 'eftpos' })
    expect(ruleMatches(r, 'EFTPOS WOOLWORTHS')).toBe(true)
    expect(ruleMatches(r, 'CARD EFTPOS')).toBe(false)
  })

  it('matches regex patterns', () => {
    const r = rule({ id: '1', match_type: 'regex', pattern: '^UBER\\s*(EATS)?' })
    expect(ruleMatches(r, 'UBER EATS SYDNEY')).toBe(true)
    expect(ruleMatches(r, 'UBERTRIP')).toBe(true)
    expect(ruleMatches(r, 'LYFT')).toBe(false)
  })

  it('treats an uncompilable regex as no match instead of throwing', () => {
    // A user can type anything into the pattern field; a broken one must not
    // take the whole import down.
    const r = rule({ id: '1', match_type: 'regex', pattern: '[unclosed' })
    expect(() => ruleMatches(r, 'anything')).not.toThrow()
    expect(ruleMatches(r, 'anything')).toBe(false)
  })

  it('never matches on an empty pattern', () => {
    expect(ruleMatches(rule({ id: '1', pattern: '' }), 'anything')).toBe(false)
    expect(ruleMatches(rule({ id: '1', pattern: '   ' }), 'anything')).toBe(false)
  })
})

describe('rule ordering', () => {
  it('applies the lowest priority number first', () => {
    const rules = [
      rule({ id: 'b', pattern: 'coffee', category_id: 'general', priority: 50 }),
      rule({ id: 'a', pattern: 'coffee', category_id: 'specific', priority: 10 }),
    ]
    expect(categoriseDescription('MORNING COFFEE', rules)).toBe('specific')
  })

  it('breaks ties deterministically rather than by input order', () => {
    const rules = [
      rule({ id: 'zzz', pattern: 'x', category_id: 'z', priority: 10 }),
      rule({ id: 'aaa', pattern: 'x', category_id: 'a', priority: 10 }),
    ]
    expect(categoriseDescription('x', rules)).toBe('a')
    expect(categoriseDescription('x', [...rules].reverse())).toBe('a')
  })

  it('orderRules does not mutate its input', () => {
    const rules = [rule({ id: 'b', priority: 2 }), rule({ id: 'a', priority: 1 })]
    const copy = [...rules]
    orderRules(rules)
    expect(rules).toEqual(copy)
  })
})

describe('categoriseDescription', () => {
  const rules = [
    rule({ id: '1', pattern: 'woolworths', category_id: 'groceries', priority: 10 }),
    rule({ id: '2', pattern: 'uber', category_id: 'transport', priority: 20 }),
  ]

  it('returns the matching category', () => {
    expect(categoriseDescription('WOOLWORTHS 1234', rules)).toBe('groceries')
    expect(categoriseDescription('UBER TRIP', rules)).toBe('transport')
  })

  it('returns null when nothing matches', () => {
    expect(categoriseDescription('MYSTERY MERCHANT', rules)).toBeNull()
  })

  it('handles an empty rule set and empty descriptions', () => {
    expect(categoriseDescription('anything', [])).toBeNull()
    expect(categoriseDescription('', rules)).toBeNull()
  })
})

describe('findMatchingRule', () => {
  it('reports which rule was responsible', () => {
    const rules = [rule({ id: 'r1', pattern: 'coles', category_id: 'groceries', priority: 5 })]
    expect(findMatchingRule('COLES EXPRESS', rules)?.id).toBe('r1')
    expect(findMatchingRule('NOTHING', rules)).toBeNull()
  })
})

describe('isValidPattern', () => {
  it('rejects empty patterns', () => {
    expect(isValidPattern('contains', '')).toBe(false)
    expect(isValidPattern('contains', '  ')).toBe(false)
  })

  it('accepts any non-empty literal', () => {
    expect(isValidPattern('contains', '[unclosed')).toBe(true)
  })

  it('rejects a regex that will not compile', () => {
    expect(isValidPattern('regex', '[unclosed')).toBe(false)
    expect(isValidPattern('regex', '^valid$')).toBe(true)
  })
})
