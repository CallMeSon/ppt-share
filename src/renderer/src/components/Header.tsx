import { BellRingingIcon, GearSixIcon, MoonIcon, SunIcon } from '@phosphor-icons/react'
import type { EventMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import type { Theme } from '../theme'
import { BrandMark } from './BrandMark'
import { EventTabs } from './EventTabs'
import type { Tally } from '../model'
import { OffAirButton } from './OffAirButton'
import { OutputMenu } from './OutputMenu'
import type { OutputSettingsState } from './useOutputSettings'

interface Props {
  events: EventMeta[]
  eventId: string | null
  openIds: string[]
  view: 'console' | 'home'
  airEvent: string | null
  airState: Tally
  onSelectEvent(eventId: string): void
  onCloseTab(eventId: string): void
  onHome(): void
  /** Opens the New event dialog. */
  onNewEvent(): void
  program: ProgramState
  output: OutputSettingsState
  theme: Theme
  onSetTheme(theme: Theme): void
  /** The on-air event's name, for the Off air question. */
  airName: string
  /** Takes the show off air; asked for first by the header's Off air button. */
  onOffAir(): void
  /** Opens the Settings dialog (Task 4). No handler yet: the gear stays out of the way. */
  onOpenSettings?(): void
  /** The update chip, shown beside Settings only when a newer version was announced. */
  updateChip?: { label: string } | null
  /** Reopens the update popover after it was closed with Later. */
  onUpdateChip?(): void
  /** The update popover, rendered under the header; never in the stage's flow. */
  children?: React.ReactNode
}

/** The brand: mark plus word. The word hides under 900px; the mark stays. */
function Brand(): React.JSX.Element {
  return (
    <span className="brand">
      <BrandMark size={28} />
      <span className="brand-word">Bridgecast</span>
    </span>
  )
}

/** Light / Dark, each with icon and label. There is no Auto here; Auto lives in Settings. */
export function ThemeSwitch({
  theme,
  onSet
}: {
  theme: Theme
  onSet(theme: Theme): void
}): React.JSX.Element {
  return (
    <div className="theme" role="group" aria-label="Theme">
      <button
        aria-pressed={theme === 'light'}
        aria-label="Light"
        title="Light"
        onClick={() => onSet('light')}
      >
        <SunIcon size={16} />
        <span className="theme-word">Light</span>
      </button>
      <button
        aria-pressed={theme === 'dark'}
        aria-label="Dark"
        title="Dark"
        onClick={() => onSet('dark')}
      >
        <MoonIcon size={16} />
        <span className="theme-word">Dark</span>
      </button>
    </div>
  )
}

export function Header(p: Props): React.JSX.Element {
  return (
    <header>
      <Brand />
      <EventTabs
        events={p.events}
        ids={p.openIds}
        current={p.eventId}
        view={p.view}
        airEvent={p.airEvent}
        airState={p.airState}
        onSelect={p.onSelectEvent}
        onClose={p.onCloseTab}
        onHome={p.onHome}
        onNew={p.onNewEvent}
      />
      <span className="grow" />
      <OutputMenu program={p.program} out={p.output} />
      {/* Console only: Home has its own Off air in the on-air banner. */}
      {p.view === 'console' && p.airState !== 'idle' && (
        <OffAirButton eventName={p.airName} onConfirm={p.onOffAir} testId="header-offair" popover />
      )}
      <ThemeSwitch theme={p.theme} onSet={p.onSetTheme} />
      {p.updateChip && (
        <button
          type="button"
          className="update-chip"
          data-testid="update-chip"
          data-update-ui
          title="Show update"
          onClick={p.onUpdateChip}
        >
          <BellRingingIcon size={12} aria-hidden="true" />
          {p.updateChip.label}
        </button>
      )}
      <button
        className="gear"
        aria-label="Settings"
        title="Settings"
        aria-haspopup="dialog"
        onClick={p.onOpenSettings}
        disabled={!p.onOpenSettings}
      >
        <GearSixIcon size={18} />
      </button>
      {p.children}
    </header>
  )
}
