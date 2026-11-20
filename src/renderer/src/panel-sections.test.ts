import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPEN,
  loadOpenSections,
  loadPanelTab,
  saveOpenSection,
  savePanelTab,
  type KeyValueStore
} from './panel-sections'

function memory(initial: Record<string, string> = {}): KeyValueStore & {
  data: Record<string, string>
} {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    }
  }
}

describe('panel tab', () => {
  it('defaults to controls when storage is empty, corrupt or unknown', () => {
    expect(loadPanelTab(memory())).toBe('controls')
    expect(loadPanelTab(memory({ 'panel-tab': 'nope' }))).toBe('controls')
  })
  it('maps an old saved "output" tab to controls', () => {
    expect(loadPanelTab(memory({ 'panel-tab': 'output' }))).toBe('controls')
  })
  it('round-trips every tab', () => {
    for (const tab of ['controls', 'info'] as const) {
      const s = memory()
      savePanelTab(s, tab)
      expect(loadPanelTab(s)).toBe(tab)
    }
  })
  it('survives a storage that throws', () => {
    const bad: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(loadPanelTab(bad)).toBe('controls')
    expect(() => savePanelTab(bad, 'info')).not.toThrow()
    expect(loadOpenSections(bad)).toEqual(DEFAULT_OPEN)
  })
})

describe('open sections', () => {
  it('defaults: transition, deck settings and notes open', () => {
    expect(loadOpenSections(memory())).toEqual({
      transition: true,
      'deck-settings': true,
      notes: true
    })
  })
  it('corrupt JSON or wrong shapes fall back to the defaults', () => {
    expect(loadOpenSections(memory({ 'panel-open': '{oops' }))).toEqual(DEFAULT_OPEN)
    expect(loadOpenSections(memory({ 'panel-open': '[1]' }))).toEqual(DEFAULT_OPEN)
    // Old saved ids (output, network) and unknown keys are ignored without error.
    expect(
      loadOpenSections(memory({ 'panel-open': '{"network":"yes","bogus":false,"output":false}' }))
    ).toEqual(DEFAULT_OPEN)
  })
  it('saveOpenSection round-trips and returns the new map', () => {
    const s = memory()
    const next = saveOpenSection(s, DEFAULT_OPEN, 'transition', false)
    expect(next.transition).toBe(false)
    expect(next.notes).toBe(true)
    expect(loadOpenSections(s)).toEqual(next)
    expect(saveOpenSection(s, next, 'notes', false).notes).toBe(false)
    expect(loadOpenSections(s).notes).toBe(false)
  })
})
