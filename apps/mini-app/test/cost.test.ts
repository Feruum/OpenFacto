import { describe, expect, it } from 'vitest'
import { formatCost } from '../src/workspace'

describe('cost display', () => {
  it('distinguishes unknown cost from measured zero', () => {
    expect(formatCost(null, 'en')).toBe('—')
    expect(formatCost(undefined, 'en')).toBe('—')
    expect(formatCost(0, 'en')).toBe('$0.00')
  })

  it('preserves existing numeric values and locale formatting', () => {
    for (const locale of ['en', 'ru', 'kk'] as const) {
      expect(formatCost(1250, locale)).toBe(new Intl.NumberFormat(locale, {
        style: 'currency', currency: 'USD', maximumFractionDigits: 6,
      }).format(0.00125))
    }
  })
})
