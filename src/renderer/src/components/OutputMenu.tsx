import { useEffect, useId, useRef, useState } from 'react'
import {
  BroadcastIcon,
  MonitorIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  WarningIcon
} from '@phosphor-icons/react'
import { pickDisplay } from '../../../shared/displays'
import { hasConnections, ndiBadge, netShortText, omtBadge } from '../../../shared/omt'
import type { ProgramState } from '../../../shared/program'
import { hdmiBadge, needsCanvasConfirm } from '../model'
import { AudioSection } from './AudioSection'
import { CanvasSetting } from './CanvasPicker'
import { HdmiSection } from './HdmiSection'
import { NdiSection } from './NdiSection'
import { NetworkSection } from './NetworkSection'
import { OmtSection } from './OmtSection'
import type { OutputSettingsState } from './useOutputSettings'

type ChipId = 'hdmi' | 'omt' | 'ndi' | 'sound' | 'canvas'

/**
 * The full status (`OMT · 2 receivers`) from 1600 px up; under it the short word (`OMT 2`, CSS
 * `.ind-full` / `.ind-short`). The full text stays in the page, visually hidden, for readers.
 */
function NetText({ full, short }: { full: string; short: string }): React.JSX.Element {
  return (
    <>
      <span className="ind-full">{full}</span>
      <span className="ind-short" aria-hidden="true">
        {short}
      </span>
    </>
  )
}

/**
 * Header output chips: HDMI (ok only while its window shows on the second display), OMT, NDI,
 * Sound and the canvas now in force. Each chip opens a popover under the header with its
 * settings (they used to live in the Output tab of the right panel). One popover at a time;
 * Esc or a click outside closes it and Esc returns focus to the chip. While one is open it
 * owns the keyboard, so typing a source name never reaches the Program shortcuts.
 */
export function OutputMenu({
  program,
  out
}: {
  program: ProgramState
  out: OutputSettingsState
}): React.JSX.Element {
  const { hdmi, audio, canvas, omt, ndi, sendContentOnly, displays } = out
  const [open, setOpen] = useState<ChipId | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLButtonElement | null>(null)
  const baseId = useId()

  // Reread the saved settings and the screens whenever a popover opens (main may re-save the HDMI
  // display id, or the Settings dialog may have changed the sound).
  const { reload } = out
  useEffect(() => {
    if (open) reload()
  }, [open, reload])

  useEffect(() => {
    if (!open) return
    // Capture on window: runs before Home's and the console's bubbling key listeners.
    const keys = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') return
      // A section inside (canvas or frame-rate question) handles its own Esc first.
      if (e.key !== 'Escape') {
        e.stopPropagation()
        return
      }
      if ((e.target as HTMLElement | null)?.closest?.('[role=group][data-no-shortcuts]')) return
      e.stopPropagation()
      e.preventDefault()
      setOpen(null)
      restore.current?.focus()
    }
    const away = (e: PointerEvent): void => {
      if (root.current?.contains(e.target as Node)) return
      setOpen(null)
    }
    addEventListener('keydown', keys, true)
    addEventListener('pointerdown', away, true)
    return () => {
      removeEventListener('keydown', keys, true)
      removeEventListener('pointerdown', away, true)
    }
  }, [open])

  if (!hdmi || !audio || !omt || !ndi || sendContentOnly === null || !canvas) {
    return (
      <div className="output-menu">
        <span className="output-chip" data-tone="off">
          <MonitorIcon size={16} />
          <span>HDMI</span>
        </span>
      </div>
    )
  }

  const badge = hdmiBadge(out.status, hdmi)
  const omtTone = omtBadge(out.omtStatus)
  const ndiTone = ndiBadge(out.ndiStatus)
  const StatusIcon = badge.tone === 'warn' || badge.tone === 'error' ? WarningIcon : MonitorIcon
  const target = badge.tone === 'ok' ? displays.find((d) => d.id === hdmi.displayId) : undefined
  const canvasText = `${program.canvas.width}×${program.canvas.height}`

  const toggle =
    (id: ChipId) =>
    (e: React.MouseEvent<HTMLButtonElement>): void => {
      restore.current = e.currentTarget
      setOpen((cur) => (cur === id ? null : id))
    }

  const renderChip = (
    id: ChipId,
    c: {
      tone?: string
      label?: string
      title?: string
      children: React.ReactNode
      testId: string
    }
  ): React.JSX.Element => (
    <button
      type="button"
      className="output-chip"
      data-testid={c.testId}
      data-tone={c.tone}
      title={c.title}
      aria-label={c.label}
      aria-haspopup="dialog"
      aria-expanded={open === id}
      aria-controls={open === id ? `${baseId}-${id}` : undefined}
      onClick={toggle(id)}
    >
      {c.children}
    </button>
  )

  const pop = (id: ChipId, label: string, body: React.ReactNode): React.JSX.Element | null =>
    open === id ? (
      <div
        className="popover output-pop"
        id={`${baseId}-${id}`}
        role="dialog"
        aria-label={label}
        data-no-shortcuts
        data-testid="output-popover"
        data-popover={id}
      >
        {body}
      </div>
    ) : null

  const shared = (
    <NetworkSection
      variant="shared"
      fps={omt.fps}
      sendContentOnly={sendContentOnly}
      omtStatus={out.omtStatus}
      ndiStatus={out.ndiStatus}
      onSaved={(s) => {
        out.setOmt(s.omt)
        out.setNdi(s.ndi)
        out.setSendContentOnly(s.sendContentOnly)
      }}
    />
  )

  return (
    <div className="output-menu" ref={root} role="group" aria-label="Output">
      <div className="output-slot">
        {renderChip('hdmi', {
          testId: 'output-chip-hdmi',
          tone: badge.tone,
          title: target
            ? `${target.label}, ${target.width}x${target.height}`
            : 'HDMI output settings',
          children: (
            <span className="ind" data-testid="hdmi-status" data-tone={badge.tone}>
              <StatusIcon size={16} />
              <span>{badge.text}</span>
            </span>
          )
        })}
        {pop(
          'hdmi',
          'HDMI output',
          <HdmiSection
            hdmi={hdmi}
            displays={displays}
            status={out.status}
            onSaved={(s) => {
              out.setHdmi(s.hdmi)
              out.setAudio(s.audio)
              out.setCanvas(s.canvas)
            }}
          />
        )}
      </div>

      <div className="output-slot">
        {renderChip('omt', {
          testId: 'output-chip-omt',
          tone: omtTone.tone,
          title: omtTone.text,
          label: omtTone.text,
          children: (
            <span className="ind" data-testid="omt-status" data-tone={omtTone.tone}>
              {omtTone.tone === 'error' ? <WarningIcon size={16} /> : <BroadcastIcon size={16} />}
              <NetText full={omtTone.text} short={netShortText('OMT', out.omtStatus)} />
            </span>
          )
        })}
        {pop(
          'omt',
          'OMT output',
          <>
            <OmtSection
              omt={omt}
              status={out.omtStatus}
              onSaved={(s) => {
                out.setOmt(s.omt)
                out.setAudio(s.audio)
                out.setCanvas(s.canvas)
              }}
            />
            {shared}
          </>
        )}
      </div>

      <div className="output-slot">
        {renderChip('ndi', {
          testId: 'output-chip-ndi',
          tone: ndiTone.tone,
          title: ndiTone.text,
          label: ndiTone.text,
          children: (
            <span className="ind" data-testid="ndi-status" data-tone={ndiTone.tone}>
              {ndiTone.tone === 'error' ? <WarningIcon size={16} /> : <BroadcastIcon size={16} />}
              <NetText full={ndiTone.text} short={netShortText('NDI', out.ndiStatus)} />
            </span>
          )
        })}
        {pop(
          'ndi',
          'NDI output',
          <>
            <NdiSection
              ndi={ndi}
              status={out.ndiStatus}
              onSaved={(s) => {
                out.setNdi(s.ndi)
                out.setAudio(s.audio)
                out.setCanvas(s.canvas)
              }}
            />
            {shared}
          </>
        )}
      </div>

      <div className="output-slot">
        {renderChip('sound', {
          testId: 'output-chip-sound',
          tone: audio.muted ? 'off' : undefined,
          title: audio.muted ? 'Sound settings (muted)' : 'Sound settings',
          label: audio.muted ? 'Sound settings, muted' : 'Sound settings',
          children: audio.muted ? (
            <SpeakerSlashIcon size={16} />
          ) : (
            <SpeakerHighIcon size={16} />
          )
        })}
        {pop(
          'sound',
          'Sound',
          <AudioSection audio={audio} onSaved={(s) => out.setAudio(s.audio)} />
        )}
      </div>

      <div className="output-slot">
        {renderChip('canvas', {
          testId: 'output-chip-canvas',
          title: `Canvas ${canvasText}`,
          label: `Canvas ${canvasText}`,
          children: (
            <span className="canvas-tag" data-testid="canvas-badge">
              {canvasText}
            </span>
          )
        })}
        {pop(
          'canvas',
          'Canvas',
          <section className="pop-section canvas-section" data-testid="canvas-section">
            <div className="pop-head">
              <h3 className="pop-title">Canvas</h3>
            </div>
            <span className="hint">
              Default size for events without their own. Set one for this event under Deck
              settings.
            </span>
            <CanvasSetting
              value={canvas}
              allowDefault={false}
              hdmiDisplay={pickDisplay(displays, hdmi.displayId)}
              confirm={needsCanvasConfirm(program)}
              networkReceivers={hasConnections(out.omtStatus, out.ndiStatus)}
              apply={async (c) => {
                // allowDefault is false: the picker never hands over null here.
                if (c) out.setCanvas((await window.api.setDefaultCanvas(c)).canvas)
              }}
            />
          </section>
        )}
      </div>
    </div>
  )
}
