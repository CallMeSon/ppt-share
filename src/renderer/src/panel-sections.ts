// Right panel state that survives a restart: the selected tab and which sections are open.
// Pure: the store is passed in (localStorage in the app, a map in tests).

export type PanelTab = 'controls' | 'info'
export type SectionId = 'transition' | 'deck-settings' | 'notes'

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const TAB_KEY = 'panel-tab'
const OPEN_KEY = 'panel-open'

export const DEFAULT_OPEN: Readonly<Record<SectionId, boolean>> = {
  transition: true,
  'deck-settings': true,
  notes: true
}

const IDS = Object.keys(DEFAULT_OPEN) as SectionId[]

function read(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function write(store: KeyValueStore, key: string, value: string): void {
  try {
    store.setItem(key, value)
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
}

export function loadPanelTab(store: KeyValueStore): PanelTab {
  const v = read(store, TAB_KEY)
  // Output moved to the header chips (2026-11-19): an old selection falls back to Controls.
  if (v === 'output') return 'controls'
  return v === 'info' || v === 'controls' ? v : 'controls'
}

export function savePanelTab(store: KeyValueStore, tab: PanelTab): void {
  write(store, TAB_KEY, tab)
}

export function loadOpenSections(store: KeyValueStore): Record<SectionId, boolean> {
  const out = { ...DEFAULT_OPEN }
  const raw = read(store, OPEN_KEY)
  if (!raw) return out
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return out
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out
  for (const id of IDS) {
    const v = (parsed as Record<string, unknown>)[id]
    if (typeof v === 'boolean') out[id] = v
  }
  // Old saved ids (output, network) are not in IDS and are ignored.
  return out
}

/** Saves one section's state and returns the new map. */
export function saveOpenSection(
  store: KeyValueStore,
  current: Record<SectionId, boolean>,
  id: SectionId,
  open: boolean
): Record<SectionId, boolean> {
  const next = { ...current, [id]: open }
  write(store, OPEN_KEY, JSON.stringify(next))
  return next
}
