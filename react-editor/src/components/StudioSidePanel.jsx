import { useEffect, useState } from 'react'
import { STAGE_H, STAGE_W } from './ContextToolbar.jsx'

function PanelHeader({ title, onClose }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3.5">
      <h2 className="text-[15px] font-semibold text-paper">{title}</h2>
      <button
        type="button"
        className="ui-icon-btn text-lg leading-none"
        title="Close"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  )
}

function EffectCard({ label, active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 transition ${
        active
          ? 'border-blaze bg-[#f3e8ff] ring-1 ring-blaze/30'
          : 'border-line bg-inset hover:border-blaze/40'
      }`}
    >
      <span className="flex h-14 w-full items-center justify-center rounded-lg bg-[#111827] text-[22px] font-bold text-white">
        {children}
      </span>
      <span className="text-[11px] text-dim">{label}</span>
    </button>
  )
}

function AlignBtn({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="ui-btn flex flex-col items-center gap-1 py-2 text-[11px] disabled:opacity-40"
    >
      <span className="text-base opacity-70">▦</span>
      {label}
    </button>
  )
}

/**
 * Canva-style left flyout: Font | Effects | Position | Color.
 * Same engine patches as Styles panel — layout only.
 */
export default function StudioSidePanel({
  mode,
  onClose,
  api,
  selected,
  layers = [],
}) {
  const [fonts, setFonts] = useState([])
  const [filter, setFilter] = useState('')
  const [pickError, setPickError] = useState('')

  useEffect(() => {
    if (!api?.listFontOptions) return
    const refresh = () => {
      try {
        setFonts(api.listFontOptions() || [])
      } catch (_) {}
    }
    refresh()
    let unsub = null
    try {
      unsub = api.subscribe?.((_snap, reason) => {
        if (!reason || reason === 'remote-fonts' || reason === 'subscribe') refresh()
      })
    } catch (_) {}
    const iv = setInterval(refresh, 1500)
    const stop = setTimeout(() => clearInterval(iv), 12000)
    return () => {
      clearInterval(iv)
      clearTimeout(stop)
      try {
        unsub?.()
      } catch (_) {}
    }
  }, [api, mode])

  if (!mode || !selected) return null

  const g = selected.geo || {}
  const locked = !!g.locked
  const patch = (p, { undo = true } = {}) => {
    if (undo) api?.pushUndo?.()
    return api?.patchLayerStyle?.(selected.id, p) || api?.setLayerGeometry?.(selected.id, p)
  }

  const title =
    mode === 'font'
      ? 'Font'
      : mode === 'effects'
        ? 'Effects'
        : mode === 'position'
          ? 'Position'
          : 'Color'

  function alignPage(edge) {
    if (locked) return
    const w = Math.round(g.w || 0)
    const h = Math.round(g.h || 0)
    const next = {}
    if (edge === 'left') next.x = 0
    if (edge === 'right') next.x = STAGE_W - w
    if (edge === 'center') next.x = Math.round((STAGE_W - w) / 2)
    if (edge === 'top') next.y = 0
    if (edge === 'bottom') next.y = STAGE_H - h
    if (edge === 'middle') next.y = Math.round((STAGE_H - h) / 2)
    patch(next)
  }

  function order(kind) {
    if (locked) return
    const zs = layers.map((l) => l.geo?.z ?? 10)
    const cur = g.z ?? 10
    if (kind === 'forward') patch({ z: cur + 1 })
    if (kind === 'backward') patch({ z: cur - 1 })
    if (kind === 'front') patch({ z: (zs.length ? Math.max(...zs) : cur) + 1 })
    if (kind === 'back') patch({ z: (zs.length ? Math.min(...zs) : cur) - 1 })
  }

  const filtered = fonts.filter((f) =>
    !filter.trim()
      ? true
      : String(f.label || '')
          .toLowerCase()
          .includes(filter.trim().toLowerCase()),
  )

  const colorHex =
    /^#[0-9a-fA-F]{6}$/i.test(g.colorHex || '')
      ? g.colorHex
      : /^#[0-9a-fA-F]{6}$/i.test(g.fillHex || '')
        ? g.fillHex
        : '#111827'

  const eyeDropperOk =
    typeof window.EyeDropper === 'function' && !!window.isSecureContext

  async function pickWithEyeDropper() {
    setPickError('')
    // EyeDropper MUST open in the same user-gesture turn — no setState before .open()
    if (typeof window.EyeDropper !== 'function') {
      setPickError('Eyedropper needs Chrome or Edge')
      return
    }
    if (!window.isSecureContext) {
      setPickError(
        'Eyedropper needs http://localhost or HTTPS (not a LAN IP like http://192.168…)',
      )
      return
    }
    try {
      const result = await new window.EyeDropper().open()
      const hex = String(result?.sRGBHex || '').toLowerCase()
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
        setPickError('No colour returned')
        return
      }
      patch(
        selected.isText
          ? { color: hex, gradient: null }
          : { fill: hex, color: hex, gradient: null },
      )
    } catch (e) {
      if (e?.name === 'AbortError') return
      const msg = e?.message || 'Pick failed'
      if (/secure|NotAllowed|gesture|activation/i.test(msg)) {
        setPickError(
          'Eyedropper blocked — open the app on http://localhost in Chrome/Edge, then try again',
        )
      } else {
        setPickError(msg)
      }
    }
  }

  const shadowOn = !!g.shadow
  const effect = shadowOn ? g.shadowEffect || 'drop' : null

  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden border-r border-line bg-panel shadow-[4px_0_24px_rgba(15,23,42,.06)]">
      <PanelHeader title={title} onClose={onClose} />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5">
        {mode === 'font' && (
          <>
            <input
              className="ui-input mb-3"
              placeholder="Search fonts"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-dim">
              Document fonts
            </div>
            <ul className="space-y-0.5">
              {filtered.map((f) => {
                const on = f.value === g.font
                return (
                  <li key={f.value}>
                    <button
                      type="button"
                      disabled={locked || selected.lockFonts}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[14px] disabled:opacity-40 ${
                        on
                          ? 'bg-[#f3e8ff] text-blaze'
                          : 'text-paper hover:bg-panel2'
                      }`}
                      style={{ fontFamily: f.value }}
                      onMouseEnter={() => api?.previewTextStyle?.({ font: f.value })}
                      onMouseLeave={() => api?.cancelTextStylePreview?.()}
                      onClick={() => {
                        api?.cancelTextStylePreview?.()
                        patch({ font: f.value })
                      }}
                    >
                      <span className="truncate">{f.label}</span>
                      {on ? <span className="text-blaze">✓</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {mode === 'effects' && selected.isText && (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <EffectCard
                label="None"
                active={!shadowOn && !g.hollow && !g.bgOn}
                onClick={() =>
                  patch({
                    shadowEffect: 'none',
                    hollow: false,
                    bgOn: false,
                  })
                }
              >
                <span className="opacity-90">Ag</span>
              </EffectCard>
              <EffectCard
                label="Shadow"
                active={effect === 'drop'}
                onClick={() => patch({ shadowEffect: 'drop', hollow: false })}
              >
                <span style={{ textShadow: '3px 3px 4px rgba(0,0,0,.55)' }}>Ag</span>
              </EffectCard>
              <EffectCard
                label="Lift"
                active={effect === 'glow'}
                onClick={() => patch({ shadowEffect: 'glow', hollow: false })}
              >
                <span style={{ textShadow: '0 0 8px #fff, 0 0 14px #fff' }}>Ag</span>
              </EffectCard>
              <EffectCard
                label="Hollow"
                active={!!g.hollow}
                onClick={() =>
                  patch({
                    hollow: !g.hollow,
                    shadowEffect: 'none',
                    strokeOn: !g.hollow ? true : undefined,
                  })
                }
              >
                <span
                  style={{
                    WebkitTextStroke: '1.5px #fff',
                    color: 'transparent',
                  }}
                >
                  Ag
                </span>
              </EffectCard>
              <EffectCard
                label="Echo"
                active={effect === 'echo'}
                onClick={() => patch({ shadowEffect: 'echo', hollow: false })}
              >
                <span
                  style={{
                    textShadow:
                      '3px 3px 0 rgba(0,0,0,.9), 6px 6px 0 rgba(0,0,0,.55)',
                  }}
                >
                  Ag
                </span>
              </EffectCard>
              <EffectCard
                label="Background"
                active={!!g.bgOn}
                onClick={() => patch({ bgOn: !g.bgOn })}
              >
                <span className="rounded bg-blaze px-1.5 py-0.5 text-[16px]">Ag</span>
              </EffectCard>
            </div>

            {shadowOn ? (
              <div className="mt-2 space-y-2 border-t border-line pt-3">
                <label className="block text-[11px] text-dim">
                  Blur {g.shadowBlur ?? 8}
                  <input
                    type="range"
                    className="ui-range mt-1"
                    min={0}
                    max={60}
                    value={g.shadowBlur ?? 8}
                    onPointerDown={() => api?.pushUndo?.()}
                    onChange={(e) => patch({ shadowBlur: +e.target.value }, { undo: false })}
                  />
                </label>
                <label className="block text-[11px] text-dim">
                  Offset {g.shadowOffset ?? 12}
                  <input
                    type="range"
                    className="ui-range mt-1"
                    min={0}
                    max={80}
                    value={g.shadowOffset ?? 12}
                    onPointerDown={() => api?.pushUndo?.()}
                    onChange={(e) => patch({ shadowOffset: +e.target.value }, { undo: false })}
                  />
                </label>
                <button
                  type="button"
                  className="ui-btn ui-btn-primary w-full"
                  onClick={() => patch({ shadowEffect: 'none' })}
                >
                  Remove effect
                </button>
              </div>
            ) : null}
          </>
        )}

        {mode === 'effects' && !selected.isText && (
          <p className="text-sm text-dim">Effects are available for text layers.</p>
        )}

        {mode === 'position' && (
          <>
            <div className="mb-1 text-[12px] font-semibold text-paper">Layer order</div>
            <div className="mb-4 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                className="ui-btn py-2 text-[12px]"
                disabled={locked}
                onClick={() => order('forward')}
              >
                Forward
              </button>
              <button
                type="button"
                className="ui-btn py-2 text-[12px]"
                disabled={locked}
                onClick={() => order('backward')}
              >
                Backward
              </button>
              <button
                type="button"
                className="ui-btn py-2 text-[12px]"
                disabled={locked}
                onClick={() => order('front')}
              >
                To front
              </button>
              <button
                type="button"
                className="ui-btn py-2 text-[12px]"
                disabled={locked}
                onClick={() => order('back')}
              >
                To back
              </button>
            </div>

            <div className="mb-1 text-[12px] font-semibold text-paper">Align to page</div>
            <div className="mb-4 grid grid-cols-3 gap-1.5">
              <AlignBtn label="Top" disabled={locked} onClick={() => alignPage('top')} />
              <AlignBtn label="Left" disabled={locked} onClick={() => alignPage('left')} />
              <AlignBtn label="Middle" disabled={locked} onClick={() => alignPage('middle')} />
              <AlignBtn label="Centre" disabled={locked} onClick={() => alignPage('center')} />
              <AlignBtn label="Bottom" disabled={locked} onClick={() => alignPage('bottom')} />
              <AlignBtn label="Right" disabled={locked} onClick={() => alignPage('right')} />
            </div>

            <div className="mb-1 text-[12px] font-semibold text-paper">Advanced</div>
            <div className="grid grid-cols-2 gap-2">
              {['w', 'h', 'x', 'y'].map((k) => (
                <label key={k} className="block text-[11px] text-dim">
                  {k.toUpperCase()}
                  <input
                    type="number"
                    className="ui-input mt-1"
                    disabled={locked}
                    value={Math.round(g[k] ?? 0)}
                    onChange={(e) => patch({ [k]: +e.target.value })}
                  />
                </label>
              ))}
              <label className="col-span-2 block text-[11px] text-dim">
                Rotate
                <input
                  type="number"
                  className="ui-input mt-1"
                  disabled={locked}
                  min={0}
                  max={360}
                  value={Math.round((((g.rotate || 0) % 360) + 360) % 360)}
                  onChange={(e) => patch({ rotate: +e.target.value })}
                />
              </label>
            </div>
          </>
        )}

        {mode === 'color' && (
          <>
            <label className="mb-3 block text-[11px] text-dim">
              Custom colour
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-white p-0.5"
                  value={colorHex}
                  onChange={(e) =>
                    patch(
                      selected.isText
                        ? { color: e.target.value, gradient: null }
                        : { fill: e.target.value, color: e.target.value, gradient: null },
                    )
                  }
                />
                <input
                  className="ui-input font-mono uppercase"
                  value={colorHex}
                  onChange={(e) => {
                    const v = e.target.value.trim()
                    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return
                    patch(
                      selected.isText
                        ? { color: v, gradient: null }
                        : { fill: v, color: v, gradient: null },
                    )
                  }}
                />
              </div>
            </label>

            <button
              type="button"
              className="ui-btn mb-2 w-full py-2.5 text-[13px]"
              onClick={pickWithEyeDropper}
            >
              Eyedropper
            </button>
            {pickError ? (
              <p className="mb-2 text-[11px] text-red-600">{pickError}</p>
            ) : null}
            <p className="text-[11px] text-muted">
              {eyeDropperOk
                ? 'Opens the browser eyedropper — sample any pixel on screen. Esc cancels.'
                : typeof window.EyeDropper !== 'function'
                  ? 'This browser has no Eyedropper — use Chrome or Edge.'
                  : 'Open via http://localhost (HTTPS also works). LAN IPs block Eyedropper.'}
            </p>
          </>
        )}
      </div>
    </aside>
  )
}
