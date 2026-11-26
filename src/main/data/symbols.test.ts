import { describe, expect, it } from 'vitest'
import { secidForCode, secidForIndex, tencentSymbolForIndex } from './symbols'

describe('market symbol mapping', () => {
  it('maps stock secids by board', () => {
    expect(secidForCode('600519')).toBe('1.600519')
    expect(secidForCode('300750')).toBe('0.300750')
    expect(secidForCode('688981')).toBe('1.688981')
  })

  it('maps index secids by exchange, not by stock prefix rules', () => {
    expect(secidForIndex('000002')).toBe('1.000002')
    expect(secidForIndex('000680')).toBe('1.000680')
    expect(secidForIndex('399107')).toBe('0.399107')
    expect(tencentSymbolForIndex('000002')).toBe('sh000002')
    expect(tencentSymbolForIndex('399102')).toBe('sz399102')
  })
})
