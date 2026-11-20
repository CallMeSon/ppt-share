import { useLayoutEffect, useRef } from 'react'
import type { DeckMeta, SectionMeta } from '../../../shared/types'
import type { Action, ProgramState } from '../../../shared/program'
import { slideUrl } from '../../../shared/ipc'
import { currentDeck, nextStepText, nextView, webUpNext } from '../model'
import { posterWithVersion } from '../stream'
import type { WebStatus } from '../../../shared/web'
import { EndCard, VideoMark } from './Slide'
import { SlideLayers } from './SlideLayers'
import { Switch } from './Switch'
import { PanelSection } from './PanelSection'
import { StatusTag } from './StatusTag'
import type { PanelTab, SectionId } from '../panel-sections'
import { Segmented } from './Segmented'

const TABS: readonly { id: PanelTab; label: string }[] = [
  { id: 'controls', label: 'Controls' },
  { id: 'info', label: 'Info' }
]
const TRANSITIONS = [
  { value: 'cut', label: 'Cut' },
  { value: 'fade', label: 'Fade' }
] as const

/**
 * Right panel: underlined tabs Controls and Info. Up next stays above the tabs (it
 * never collapses). Controls holds Transition and Deck settings, Info holds Notes. All
 * panes stay mounted; the unselected one is hidden, so controls keep their state. Output
 * and network settings live in the header chips (OutputMenu).
 */
export function NextPanel({
  decks,
  sections,
  state,
  webStatuses,
  versions,
  onAction,
  tab,
  onTab,
  isOpen,
  onToggle,
  navigation,
  deckSettings
}: {
  tab: PanelTab
  onTab(tab: PanelTab): void
  isOpen(id: SectionId): boolean
  onToggle(id: SectionId, open: boolean): void
  /** Section and deck buttons, shown under Up next. */
  navigation: React.ReactNode
  /** Body of the Deck settings section. */
  deckSettings: React.ReactNode
  decks: DeckMeta[]
  sections: SectionMeta[]
  state: ProgramState
  /** Load state of the web deck pages (a web deck that is not ready cannot be taken). */
  webStatuses: Record<string, WebStatus>
  /** Per deck: bumped when its images may have been rewritten under the same names. */
  versions: Record<string, number>
  onAction(a: Action): void
}): React.JSX.Element {
  const deck = currentDeck(decks, state)
  const nx = nextView(decks, state, sections)
  // Notes of the slide on the panel: the preview while frozen, else the operator position.
  const notes = nx.kind === 'slide' && nx.held ? nx.notes : (deck?.slides[state.index]?.notes ?? '')

  const held = nx.kind === 'slide' && nx.held === true
  // A web snapshot or an edited deck's images are rewritten under the same names: the version reloads them.
  const snapshotUrl = (deckId: string, file: string): string =>
    posterWithVersion(slideUrl(deckId, file), versions[deckId] ?? 0)
  // A live native slide with animation steps left: Next plays the next step, not the next slide.
  const stepText = nextStepText(state, decks)
  const shown = state.shown
  // Web deck copy: Next goes to the live page, or the next take is a page that is not ready.
  const webText = webUpNext(state, decks, webStatuses)
  let card: React.JSX.Element
  let cap: React.ReactNode = ''
  // Position of the slide Next takes, e.g. "3 / 9"; empty at the end of a deck.
  let nextPos = ''
  if (stepText !== null && shown) {
    card = (
      <div className="slide next-slide">
        <SlideLayers
          media={{ kind: 'image', url: snapshotUrl(shown.deckId, shown.file), fit: 'fit' }}
          fade={false}
          muted
          layerClass="next-layer"
          imgAttrs={() => ({ alt: `Slide ${shown.index + 1}, the slide on air` })}
        />
      </div>
    )
    cap = stepText
  } else if (nx.kind === 'slide') {
    // Layers keep the previous slide on screen until the new image has decoded (no black frame).
    // A video slide shows its poster only; the card never plays video.
    card = (
      <div className="slide next-slide">
        <SlideLayers
          media={{
            kind: 'image',
            url: snapshotUrl(nx.deckId, nx.file),
            fit: 'fit'
          }}
          fade={false}
          muted
          layerClass="next-layer"
          imgAttrs={() => ({ alt: `Slide ${nx.index + 1}` })}
        />
        {nx.video && <VideoMark />}
      </div>
    )
    cap = nx.held
      ? `Frozen: the audience still sees slide ${(shown?.index ?? 0) + 1}.` +
        (nx.index === shown?.index ? '' : ` This is slide ${nx.index + 1}.`)
      : `Space or → takes slide ${nx.index + 1} to air.`
    nextPos = deck ? `${nx.index + 1} / ${deck.slides.length}` : ''
  } else if (nx.kind === 'end') {
    card = <EndCard title="End of deck" />
    if (!nx.nextDeck) cap = 'No next deck'
    else if (nx.auto) cap = `Next deck: ${nx.nextDeck}`
    // Auto advance off: Next stops here; the operator picks the next deck.
    else
      cap = (
        <>
          Next stops here. Choose <strong>{nx.nextDeck}</strong> to continue.
        </>
      )
  } else if (nx.kind === 'sectionEnd') {
    if (nx.nextSection === null) card = <EndCard title="End of event" />
    else {
      card = <EndCard title="End of section" />
      cap = `Next section: ${nx.nextSection}. Press N.`
    }
  } else {
    card = <EndCard title="No slides yet" />
  }

  if (webText !== null) {
    // The live page shows its snapshot; a not-ready page keeps the card of the normal view.
    if (deck?.source === 'web' && nx.kind !== 'slide') {
      card = (
        <div className="slide next-slide">
          <SlideLayers
            media={{
              kind: 'image',
              url: snapshotUrl(deck.id, deck.slides[0].file),
              fit: 'fit'
            }}
            fade={false}
            muted
            layerClass="next-layer"
            imgAttrs={() => ({ alt: `Web page ${deck.name}` })}
          />
        </div>
      )
      nextPos = ''
    }
    cap = webText
  }

  // The underline glides: its position and width come from the selected tab (see app.css).
  const tabsRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const bar = tabsRef.current
    if (!bar) return
    const place = (): void => {
      const on = bar.querySelector<HTMLElement>('[aria-selected=true]')
      if (!on) return
      bar.style.setProperty('--tab-x', `${on.offsetLeft}px`)
      bar.style.setProperty('--tab-w', `${on.offsetWidth}px`)
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [tab])

  const onTabKey = (e: React.KeyboardEvent): void => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    // Handled here: the window-level Prev/Next shortcut must not also fire.
    e.stopPropagation()
    const to = TABS[(TABS.findIndex((t) => t.id === tab) + dir + TABS.length) % TABS.length].id
    onTab(to)
    requestAnimationFrame(() => document.getElementById(`ptab-${to}`)?.focus())
  }

  return (
    <aside className="right" aria-label="Info and controls" data-testid="right-panel">
      <div
        ref={tabsRef}
        className="tabs"
        role="tablist"
        aria-label="Right panel"
        onKeyDown={onTabKey}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`ptab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`ppane-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="props">
        {/* Visible on both tabs: the preview of what Next takes does not belong to one tab. */}
        <section className="sec static" aria-label={held ? 'Preview' : 'Up next'}>
          <div className="sb up-next">
            <h2 className="ptl">{held ? 'Preview' : 'Up next'}</h2>
            <div
              className="next-card"
              data-testid="next-card"
              data-kind={nx.kind}
              data-web={webText ?? undefined}
              data-held={held || undefined}
              data-step={stepText !== null || undefined}
              data-video={(nx.kind === 'slide' && nx.video) || undefined}
            >
              {card}
              <div className="nextmeta">
                {nx.kind === 'slide' && !held && <StatusTag kind="next" size="sm" />}
                <span className="t" title={deck?.name}>
                  {deck?.name ?? ''}
                </span>
                <span className="next-pos" data-testid="next-pos">
                  {nextPos}
                </span>
              </div>
              <div className="cap">
                <span>{cap}</span>
              </div>
            </div>
            {navigation}
          </div>
        </section>
        <div
          className="pane"
          id="ppane-info"
          role="tabpanel"
          aria-labelledby="ptab-info"
          hidden={tab !== 'info'}
        >
          <PanelSection
            title="Notes"
            open={isOpen('notes')}
            onToggle={(o) => onToggle('notes', o)}
            testId="notes-section"
          >
            <div className="notes">
              <p>{deck ? notes : ''}</p>
            </div>
          </PanelSection>
        </div>
        <div
          className="pane"
          id="ppane-controls"
          role="tabpanel"
          aria-labelledby="ptab-controls"
          hidden={tab !== 'controls'}
        >
          <PanelSection
            title="Transition"
            open={isOpen('transition')}
            onToggle={(o) => onToggle('transition', o)}
            testId="transition-section"
            summary={state.transition === 'fade' ? 'Fade' : 'Cut'}
          >
            <Segmented<'cut' | 'fade'>
              label="Transition"
              value={state.transition}
              options={TRANSITIONS}
              onChange={(transition) => onAction({ type: 'setTransition', transition })}
            />
            <div className="row">
              <label className="k" id="auto-advance-label" htmlFor="auto-advance">
                Continue to next deck
              </label>
              <Switch
                id="auto-advance"
                labelledBy="auto-advance-label"
                checked={state.autoAdvance}
                testId="auto-advance"
                onChange={(on) => onAction({ type: 'setAutoAdvance', on })}
              />
            </div>
          </PanelSection>
          <PanelSection
            title="Deck settings"
            open={isOpen('deck-settings')}
            onToggle={(o) => onToggle('deck-settings', o)}
            testId="deck-settings-section"
          >
            {deckSettings}
          </PanelSection>
        </div>
      </div>
    </aside>
  )
}
