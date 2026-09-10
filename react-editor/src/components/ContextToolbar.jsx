import { useEffect, useRef, useState } from 'react'

const STAGE_W = 1080
const STAGE_H = 1350

function ToolBtn({ active, title, children, onClick, disabled }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-[13px] font-semibold transition ${
        active
          ? 'bg-[#f3e8ff] text-blaze'
          : 'text-paper hover:bg-panel2 disabled:opacity-40'
      }`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden />
}

/**
 * Canva-style context bar above the canvas. Opens Font / Effects / Position / Color panels.
 * Wires existing patchLayerStyle — no new paint features.
 */
export default function ContextToolbar({
  api,
  selected,
  layers = [],
  studioMode,
  onStudioMode,
}) {
  const [fonts, setFonts] = useState([])
  const [sizeDraft, setSizeDraft] = useState('30')
  const [sizeFocused, setSizeFocused] = useState(false)
  const fontRef = useRef(null)

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
  }, [api])

  const g = selected?.geo || {}
  useEffect(() => {
    if (sizeFocused) return
    setSizeDraft(String(Math.round(+(g.size ?? g.baseSize ?? 30) || 30)))
  }, [selected?.id, g.size, g.baseSize, sizeFocused])

  if (!selected) {
    return (
      <div className="flex h-12 shrink-0 items-center border-b border-line bg-panel px-3 text-[12px] text-dim">
        Select a layer to edit
      </div>
    )
  }

  const patch = (p) => {
    api?.pushUndo?.()
    return api?.patchLayerStyle?.(selected.id, p) || api?.setLayerGeometry?.(selected.id, p)
  }

  const locked = !!g.locked
  const isText = !!selected.isText
  const fontLabel =
    fonts.find((f) => f.value === (g.font || ''))?.label ||
    fonts[0]?.label ||
    'Font'
  const bold = (g.weight ?? 700) >= 700
  const align = g.align || 'left'
  const rot = Math.round((((g.rotate || 0) % 360) + 360) % 360)

  function commitSize(raw) {
    const n = Math.round(Number(String(raw).trim()))
    if (!Number.isFinite(n)) {
      setSizeDraft(String(Math.round(g.size || 30)))
      return
    }
    const px = Math.max(8, Math.min(400, n))
    setSizeDraft(String(px))
    patch({ size: px })
  }

  function nudgeSize(delta) {
    const cur = Math.round(+(g.size ?? 30) || 30)
    const next = Math.max(8, Math.min(400, cur + delta))
    setSizeDraft(String(next))
    patch({ size: next })
  }

  function togglePanel(mode) {
    onStudioMode?.(studioMode === mode ? null : mode)
  }

  const colorHex =
    /^#[0-9a-fA-F]{6}$/i.test(g.colorHex || '')
      ? g.colorHex
      : /^#[0-9a-fA-F]{6}$/i.test(g.fillHex || '')
        ? g.fillHex
        : '#111827'

  return (
    <div className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-panel px-2 shadow-[0_1px_0_rgba(15,23,42,.04)]">
      {isText && !selected.lockFonts ? (
        <>
          <button
            ref={fontRef}
            type="button"
            className={`inline-flex h-9 max-w-[160px] items-center gap-1 rounded-lg px-2.5 text-[13px] ${
              studioMode === 'font' ? 'bg-[#f3e8ff] text-blaze' : 'hover:bg-panel2'
            }`}
            title="Font"
            onClick={() => togglePanel('font')}
          >
            <span className="truncate" style={{ fontFamily: g.font || 'inherit' }}>
              {fontLabel.replace(/\s*[—–-].*$/, '')}
            </span>
            <span className="text-[10px] text-muted">▾</span>
          </button>

          <div className="mx-0.5 flex items-center rounded-lg border border-line bg-inset">
            <ToolBtn title="Smaller" disabled={locked} onClick={() => nudgeSize(-2)}>
              −
            </ToolBtn>
            <input
              className="w-12 border-0 bg-transparent py-1 text-center text-[13px] outline-none"
              value={sizeDraft}
              disabled={locked}
              onFocus={() => setSizeFocused(true)}
              onBlur={() => {
                setSizeFocused(false)
                commitSize(sizeDraft)
              }}
              onChange={(e) => setSizeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              aria-label="Font size"
            />
            <ToolBtn title="Larger" disabled={locked} onClick={() => nudgeSize(2)}>
              +
            </ToolBtn>
          </div>

          <Divider />

          <ToolBtn
            title="Text color"
            active={studioMode === 'color'}
            onClick={() => togglePanel('color')}
          >
            <span className="relative font-serif text-[15px] leading-none">
              A
              <span
                className="absolute inset-x-0 -bottom-0.5 mx-auto h-[3px] w-4 rounded-full"
                style={{
                  background:
                    'linear-gradient(90deg,#ef4444,#eab308,#22c55e,#3b82f6,#a855f7)',
                }}
              />
            </span>
          </ToolBtn>

          <ToolBtn
            title="Bold"
            active={bold}
            disabled={locked}
            onClick={() => patch({ bold: !bold })}
          >
            B
          </ToolBtn>
          <ToolBtn
            title="Italic"
            active={!!g.italic}
            disabled={locked}
            onClick={() => patch({ italic: !g.italic })}
          >
            <span className="italic">I</span>
          </ToolBtn>
          <ToolBtn
            title="Underline"
            active={!!g.underline}
            disabled={locked}
            onClick={() => patch({ underline: !g.underline })}
          >
            <span className="underline">U</span>
          </ToolBtn>
          <ToolBtn
            title="Uppercase / none"
            active={g.textTransform === 'uppercase'}
            disabled={locked}
            onClick={() =>
              patch({
                textTransform: g.textTransform === 'uppercase' ? null : 'uppercase',
              })
            }
          >
            aA
          </ToolBtn>

          <Divider />

          <ToolBtn
            title="Align left"
            active={align === 'left'}
            disabled={locked}
            onClick={() => patch({ align: 'left' })}
          >
            L
          </ToolBtn>
          <ToolBtn
            title="Align center"
            active={align === 'center'}
            disabled={locked}
            onClick={() => patch({ align: 'center' })}
          >
            C
          </ToolBtn>
          <ToolBtn
            title="Align right"
            active={align === 'right'}
            disabled={locked}
            onClick={() => patch({ align: 'right' })}
          >
            R
          </ToolBtn>

          <Divider />

          <ToolBtn
            title="Effects"
            active={studioMode === 'effects'}
            onClick={() => togglePanel('effects')}
          >
            Effects
          </ToolBtn>
        </>
      ) : null}

      {!isText ? (
        <>
          <ToolBtn
            title="Fill color"
            active={studioMode === 'color'}
            onClick={() => togglePanel('color')}
          >
            <span
              className="h-5 w-5 rounded-full border border-line"
              style={{ background: colorHex }}
            />
          </ToolBtn>
          <span className="px-1 text-[12px] text-dim capitalize">{selected.type}</span>
          <Divider />
        </>
      ) : null}

      <ToolBtn
        title="Position"
        active={studioMode === 'position'}
        onClick={() => togglePanel('position')}
      >
        Position
      </ToolBtn>

      <ToolBtn
        title={locked ? 'Unlock' : 'Lock'}
        active={locked}
        onClick={() => patch({ locked: !locked })}
      >
        {locked ? 'Unlock' : 'Lock'}
      </ToolBtn>

      <div className="ml-auto flex items-center gap-1 pr-1 text-[11px] text-muted">
        <span className="hidden sm:inline">{rot}°</span>
        <span className="hidden md:inline">
          {Math.round(g.w || 0)}×{Math.round(g.h || 0)}
        </span>
      </div>
    </div>
  )
}

export { STAGE_W, STAGE_H }
