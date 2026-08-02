import { describe, expect, it } from 'vitest'
import { AU_BANK_PROFILES, mapRows, parseWithProfile, suggestMapping, type MappingProfile } from './importer'

const cba: MappingProfile = AU_BANK_PROFILES[0]!
const westpac: MappingProfile = AU_BANK_PROFILES[3]!

function run(text: string, profile: MappingProfile) {
  return mapRows(parseWithProfile(text, profile), profile)
}

describe('single signed amount column', () => {
  const csv = ['Date,Amount,Description', '01/06/2026,-12.50,CAFE X', '02/06/2026,2500.00,SALARY'].join('\n')

  it('reads money out as a debit and money in as a credit', () => {
    const { drafts, errors } = run(csv, cba)
    expect(errors).toHaveLength(0)
    expect(drafts).toHaveLength(2)

    expect(drafts[0]).toMatchObject({
      txn_date: '2026-06-01',
      amount: '12.50',
      direction: 'debit',
      description_raw: 'CAFE X',
    })
    expect(drafts[1]).toMatchObject({
      txn_date: '2026-06-02',
      amount: '2500.00',
      direction: 'credit',
    })
  })

  it('stores the amount as a positive magnitude', () => {
    const { drafts } = run(csv, cba)
    expect(drafts.every((draft) => !draft.amount.startsWith('-'))).toBe(true)
  })
})

describe('separate debit and credit columns', () => {
  const csv = [
    'Date,Narrative,Debit Amount,Credit Amount',
    '01/06/2026,COLES,84.20,',
    '02/06/2026,REFUND,,19.99',
    '03/06/2026,ZERO IN DEBIT,0.00,55.00',
  ].join('\n')

  it('picks whichever column carries the value', () => {
    const { drafts, errors } = run(csv, westpac)
    expect(errors).toHaveLength(0)
    expect(drafts.map((d) => [d.amount, d.direction])).toEqual([
      ['84.20', 'debit'],
      ['19.99', 'credit'],
      ['55.00', 'credit'],
    ])
  })
})

describe('rows that cannot be read', () => {
  it('reports an unreadable date instead of dropping the row', () => {
    const csv = ['Date,Amount,Description', 'not-a-date,-1.00,X', '01/06/2026,-2.00,Y'].join('\n')
    const { drafts, errors } = run(csv, cba)

    expect(drafts).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.reason).toContain('Could not read')
    expect(errors[0]?.rowIndex).toBe(0)
  })

  it('reports a missing amount', () => {
    const csv = ['Date,Amount,Description', '01/06/2026,,X'].join('\n')
    const { drafts, errors } = run(csv, cba)
    expect(drafts).toHaveLength(0)
    expect(errors[0]?.reason).toContain('amount')
  })

  it('accounts for every row', () => {
    const csv = ['Date,Amount,Description', '01/06/2026,-1.00,A', 'bad,-2.00,B', '03/06/2026,,C'].join('\n')
    const { drafts, errors, parsed } = run(csv, cba)
    expect(drafts.length + errors.length).toBe(parsed.rows.length)
  })
})

describe('descriptions', () => {
  it('joins several description columns', () => {
    const profile: MappingProfile = {
      ...cba,
      description_columns: ['Transaction Details', 'Merchant Name'],
    }
    const csv = [
      'Date,Amount,Transaction Details,Merchant Name',
      '01/06/2026,-5.00,EFTPOS PURCHASE,CAFE X',
    ].join('\n')

    expect(run(csv, profile).drafts[0]?.description_raw).toBe('EFTPOS PURCHASE CAFE X')
  })

  it('skips empty description columns rather than leaving gaps', () => {
    const profile: MappingProfile = { ...cba, description_columns: ['A', 'B'] }
    const csv = ['Date,Amount,A,B', '01/06/2026,-5.00,,ONLY B'].join('\n')
    expect(run(csv, profile).drafts[0]?.description_raw).toBe('ONLY B')
  })
})

describe('profile options', () => {
  it('skips preamble rows before the header', () => {
    const profile: MappingProfile = { ...cba, skip_rows: 2 }
    const csv = ['Statement for 123', '', 'Date,Amount,Description', '01/06/2026,-1.00,X'].join('\n')
    expect(run(csv, profile).drafts).toHaveLength(1)
  })

  it('honours a non-comma delimiter', () => {
    const profile: MappingProfile = { ...cba, delimiter: ';' }
    const csv = ['Date;Amount;Description', '01/06/2026;-1.00;X'].join('\n')
    expect(run(csv, profile).drafts[0]?.amount).toBe('1.00')
  })

  it('reads NAB style short-month dates', () => {
    const nab = AU_BANK_PROFILES[1]!
    const csv = ['Date,Amount,Transaction Details,Merchant Name', '05-Jun-26,-10.00,PURCHASE,SHOP'].join('\n')
    expect(run(csv, nab).drafts[0]?.txn_date).toBe('2026-06-05')
  })
})

describe('suggestMapping', () => {
  it('detects a single signed amount column', () => {
    const suggestion = suggestMapping(['Date', 'Amount', 'Description'])
    expect(suggestion.amount_convention).toBe('single_signed')
    expect(suggestion.amount_column).toBe('Amount')
    expect(suggestion.date_column).toBe('Date')
    expect(suggestion.description_columns).toEqual(['Description'])
  })

  it('prefers separate columns when both are present', () => {
    const suggestion = suggestMapping(['Date', 'Narrative', 'Debit Amount', 'Credit Amount'])
    expect(suggestion.amount_convention).toBe('separate_debit_credit')
    expect(suggestion.debit_column).toBe('Debit Amount')
    expect(suggestion.credit_column).toBe('Credit Amount')
    expect(suggestion.amount_column).toBeNull()
  })

  it('recognises alternative wording', () => {
    const suggestion = suggestMapping(['Processed Date', 'Particulars', 'Money Out', 'Money In'])
    expect(suggestion.amount_convention).toBe('separate_debit_credit')
    expect(suggestion.debit_column).toBe('Money Out')
    expect(suggestion.date_column).toBe('Processed Date')
  })

  it('falls back to the first column for the date', () => {
    const suggestion = suggestMapping(['col_a', 'col_b'])
    expect(suggestion.date_column).toBe('col_a')
  })
})

describe('seeded bank profiles', () => {
  it('every profile declares the columns its convention needs', () => {
    for (const profile of AU_BANK_PROFILES) {
      expect(profile.date_column).not.toBe('')
      if (profile.amount_convention === 'single_signed') {
        expect(profile.amount_column).toBeTruthy()
      } else {
        expect(profile.debit_column).toBeTruthy()
        expect(profile.credit_column).toBeTruthy()
      }
      expect(profile.description_columns.length).toBeGreaterThan(0)
    }
  })
})
