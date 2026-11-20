import { useEffect, useRef, useState } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react'
import type { Settings } from '../../../shared/settings'
import { NETWORK_CHANGE_CONFIRM, hasConnections, type NetStatus } from '../../../shared/omt'
import { errorMessage } from '../model'
import { Segmented } from './Segmented'
import { Switch } from './Switch'

interface Props {
  fps: 30 | 60
  sendContentOnly: boolean
  omtStatus: NetStatus | null
  ndiStatus: NetStatus | null
  onSaved(s: Settings): void
  /**
   * `shared` renders the box labelled "Shared by OMT and NDI" shown in both the OMT and
   * NDI header popovers (same state). `standalone` keeps the "Network" section title for the
   * old Output panel (no longer used, kept for compatibility).
   */
  variant?: 'shared' | 'standalone'
}

const FPS = [
  { value: 30, label: '30' },
  { value: 60, label: '60' }
] as const

/**
 * Settings every network output (OMT, NDI) shares: frame rate and "Send content only".
 * Changing the frame rate restarts the streams, so with receivers connected on any of
 * them it asks first. In the header popovers it is shown in both the OMT and NDI popovers
 * as the "Shared by OMT and NDI" box (`variant="shared"`).
 */
export function NetworkSection({
  fps,
  sendContentOnly,
  omtStatus,
  ndiStatus,
  onSaved,
  variant = 'standalone'
}: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingFps, setPendingFps] = useState<30 | 60 | null>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const fpsBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pendingFps !== null) cancel.current?.focus()
  }, [pendingFps])

  const focusChosen = (): void => {
    // The group was inert while asking: focus returns to the chosen rate.
    requestAnimationFrame(() =>
      fpsBox.current?.querySelector<HTMLElement>('[role=radio][aria-checked=true]')?.focus()
    )
  }

  const saveWith = async (call: () => Promise<Settings>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onSaved(await call())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const save = (next: 30 | 60): Promise<void> => saveWith(() => window.api.setNetworkFps(next))

  const chooseFps = (next: 30 | 60): void => {
    if (next === fps) return
    if (hasConnections(omtStatus, ndiStatus)) setPendingFps(next)
    else void save(next)
  }
  const dismiss = (): void => {
    setPendingFps(null)
    focusChosen()
  }

  const body = (
    <>
      <div className="field" ref={fpsBox}>
        <span className="row-label" id="network-fps-title">
          Frame rate
        </span>
        {/* inert while asking: the question is the only thing to answer. */}
        <div inert={pendingFps !== null}>
          <Segmented
            label="Frame rate"
            value={fps}
            options={FPS}
            disabled={busy}
            testId="network-fps"
            onChange={chooseFps}
          />
        </div>
        <span className="hint">Frames per second, for OMT and NDI. Use 30 if 60 drops frames.</span>
      </div>
      {pendingFps !== null && (
        <div
          className="canvas-confirm"
          role="group"
          aria-label="Confirm frame rate change"
          data-no-shortcuts
          data-testid="network-confirm"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            dismiss()
          }}
        >
          <WarningCircleIcon className="ph" size={20} />
          <p>
            <strong>{NETWORK_CHANGE_CONFIRM}</strong>
            <span>
              New frame rate: <span className="num">{pendingFps}</span>
            </span>
          </p>
          <span className="actions">
            <button
              className="btn sm danger"
              data-testid="network-confirm-yes"
              onClick={() => {
                const next = pendingFps
                setPendingFps(null)
                void save(next).then(focusChosen)
              }}
            >
              Change frame rate
            </button>
            <button ref={cancel} className="btn sm" onClick={dismiss}>
              Cancel
            </button>
          </span>
        </div>
      )}

      <div className="field">
        <div className="pop-head">
          <span className="row-label" id="network-content-title">
            Send content only
          </span>
          <Switch
            id="network-content-switch"
            labelledBy="network-content-title"
            checked={sendContentOnly}
            disabled={busy}
            describedBy="network-content-hint"
            testId="network-content-switch"
            onChange={(on) => void saveWith(() => window.api.setNetworkContentOnly(on))}
          />
        </div>
        <span className="hint" id="network-content-hint">
          NDI and OMT send the slide without black bars. Turn off if your receiver does not handle
          size changes.
        </span>
      </div>

      {error && (
        <p className="pop-error" role="alert" data-testid="network-error">
          {error}
        </p>
      )}
    </>
  )

  if (variant === 'shared') {
    return (
      <div className="shared" data-testid="network-shared">
        <div className="t">Shared by OMT and NDI</div>
        {body}
      </div>
    )
  }

  return (
    <section className="pop-section" aria-labelledby="network-title" data-testid="network-section">
      <div className="pop-head">
        <h3 className="pop-title" id="network-title">
          Network
        </h3>
      </div>
      {body}
    </section>
  )
}
