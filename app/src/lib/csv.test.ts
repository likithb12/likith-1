import { describe, expect, it } from 'vitest'
import {
  detectDelimiter,
  guessDateFormat,
  parseCsv,
  parseCsvAmount,
  parseDateWithFormat,
  toRecord,
} from './csv'

describe('parseCsv', () => {
  it('reads a simple file', () => {
    const result = parseCsv('Date,Amount,Description\n01/06/2026,-12.50,CAFE X')
    expect(result.headers).toEqual(['Date', 'Amount', 'Description'])
    expect(result.rows).toEqual([['01/06/2026', '-12.50', 'CAFE X']])
    expect(result.ragged).toBe(0)
  })

  it('handles quoted fields containing the delimiter', () => {
    const result = parseCsv('a,b\n"one, two",three')
    expect(result.rows[0]).toEqual(['one, two', 'three'])
  })

  it('handles escaped quotes', () => {
    const result = parseCsv('a\n"say ""hello"""')
    expect(result.rows[0]).toEqual(['say "hello"'])
  })

  it('handles newlines inside quoted fields', () => {
    const result = parseCsv('a,b\n"line one\nline two",x')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.[0]).toBe('line one\nline two')
  })

  it('handles CRLF line endings', () => {
    const result = parseCsv('a,b\r\n1,2\r\n3,4')
    expect(result.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('strips a UTF-8 BOM from the first header', () => {
    const result = parseCsv('﻿Date,Amount\n01/06/2026,1.00')
    expect(result.headers[0]).toBe('Date')
  })

  it('drops blank trailing lines', () => {
    const result = parseCsv('a,b\n1,2\n\n\n')
    expect(result.rows).toEqual([['1', '2']])
  })

  it('skips preamble rows', () => {
    const result = parseCsv('Account 123\nGenerated today\nDate,Amount\n01/06/2026,1.00', {
      skipRows: 2,
    })
    expect(result.headers).toEqual(['Date', 'Amount'])
    expect(result.rows).toEqual([['01/06/2026', '1.00']])
  })

  it('synthesises headers for a headerless file', () => {
    const result = parseCsv('01/06/2026,1.00', { hasHeader: false })
    expect(result.headers).toEqual(['column_1', 'column_2'])
    expect(result.rows).toEqual([['01/06/2026', '1.00']])
  })

  it('counts rows whose width disagrees with the header', () => {
    const result = parseCsv('a,b,c\n1,2,3\n4,5')
    expect(result.ragged).toBe(1)
  })

  it('names empty header cells rather than colliding on ""', () => {
    const result = parseCsv('Date,,Amount\n1,2,3')
    expect(result.headers).toEqual(['Date', 'column_2', 'Amount'])
  })

  it('returns nothing for an empty file', () => {
    expect(parseCsv('').rows).toEqual([])
    expect(parseCsv('   ').rows).toEqual([])
  })
})

describe('toRecord', () => {
  it('keys a row by header and trims', () => {
    expect(toRecord(['a', 'b'], [' 1 ', '2'])).toEqual({ a: '1', b: '2' })
  })

  it('fills missing trailing cells with empty strings', () => {
    expect(toRecord(['a', 'b', 'c'], ['1'])).toEqual({ a: '1', b: '', c: '' })
  })
})

describe('detectDelimiter', () => {
  it('finds commas, semicolons and tabs', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
  })

  it('is not fooled by commas inside a semicolon-delimited file', () => {
    expect(detectDelimiter('a;b\n"x, y";2\n"p, q";4')).toBe(';')
  })
})

describe('parseDateWithFormat', () => {
  it('reads day-first dates', () => {
    expect(parseDateWithFormat('03/04/2026', 'DD/MM/YYYY')).toBe('2026-04-03')
  })

  it('reads month-first dates when told to', () => {
    expect(parseDateWithFormat('03/04/2026', 'MM/DD/YYYY')).toBe('2026-03-04')
  })

  it('reads short month names', () => {
    expect(parseDateWithFormat('03-Apr-2026', 'DD-MMM-YYYY')).toBe('2026-04-03')
    expect(parseDateWithFormat('03-APR-26', 'DD-MMM-YY')).toBe('2026-04-03')
    expect(parseDateWithFormat('3 Sept 2026', 'DD MMM YYYY')).toBe('2026-09-03')
  })

  it('expands two-digit years either side of the pivot', () => {
    expect(parseDateWithFormat('01/01/26', 'DD/MM/YY')).toBe('2026-01-01')
    expect(parseDateWithFormat('01/01/85', 'DD/MM/YY')).toBe('1985-01-01')
  })

  it('accepts ISO regardless of the declared format', () => {
    expect(parseDateWithFormat('2026-04-03', 'DD/MM/YYYY')).toBe('2026-04-03')
  })

  it('rejects impossible dates rather than rolling them over', () => {
    // Date() would happily turn 31 February into 3 March.
    expect(parseDateWithFormat('31/02/2026', 'DD/MM/YYYY')).toBeNull()
    expect(parseDateWithFormat('32/01/2026', 'DD/MM/YYYY')).toBeNull()
    expect(parseDateWithFormat('13/01/2026', 'MM/DD/YYYY')).toBeNull()
    // The same digits read the other way round are a real date.
    expect(parseDateWithFormat('01/13/2026', 'MM/DD/YYYY')).toBe('2026-01-13')
  })

  it('accepts a real leap day and rejects a fake one', () => {
    expect(parseDateWithFormat('29/02/2028', 'DD/MM/YYYY')).toBe('2028-02-29')
    expect(parseDateWithFormat('29/02/2026', 'DD/MM/YYYY')).toBeNull()
  })

  it('returns null for junk', () => {
    expect(parseDateWithFormat('', 'DD/MM/YYYY')).toBeNull()
    expect(parseDateWithFormat('not a date', 'DD/MM/YYYY')).toBeNull()
  })
})

describe('guessDateFormat', () => {
  it('prefers a format that reads every sample', () => {
    expect(guessDateFormat(['2026-01-05', '2026-02-06'])).toBe('YYYY-MM-DD')
    expect(guessDateFormat(['25/12/2026', '26/12/2026'])).toBe('DD/MM/YYYY')
  })

  it('picks day-first for ambiguous samples, matching Australian exports', () => {
    // 03/04 and 05/06 parse under both; day-first is listed first and wins.
    expect(guessDateFormat(['03/04/2026', '05/06/2026'])).toBe('DD/MM/YYYY')
  })
})

describe('parseCsvAmount', () => {
  it('reads plain and signed amounts', () => {
    expect(parseCsvAmount('12.50')).toEqual({ amount: '12.50', negative: false })
    expect(parseCsvAmount('-12.50')).toEqual({ amount: '12.50', negative: true })
    expect(parseCsvAmount('+12.50')).toEqual({ amount: '12.50', negative: false })
  })

  it('strips currency symbols and thousands separators', () => {
    expect(parseCsvAmount('$1,234.56')).toEqual({ amount: '1234.56', negative: false })
    expect(parseCsvAmount('-$1,234.56')).toEqual({ amount: '1234.56', negative: true })
  })

  it('reads accounting parentheses as negative', () => {
    expect(parseCsvAmount('(1,234.56)')).toEqual({ amount: '1234.56', negative: true })
  })

  it('reads trailing DR and CR markers', () => {
    expect(parseCsvAmount('120.00 DR')).toEqual({ amount: '120.00', negative: true })
    expect(parseCsvAmount('120.00 CR')).toEqual({ amount: '120.00', negative: false })
  })

  it('returns null for blanks and junk', () => {
    expect(parseCsvAmount('')).toBeNull()
    expect(parseCsvAmount('   ')).toBeNull()
    expect(parseCsvAmount('n/a')).toBeNull()
  })
})
