import { useEffect, useRef, useState } from 'react'

const inputClass = 'ui-input'

function Field({ label, children }) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-1 block text-[11px] text-dim">{label}</span>
      {children}
    </label>
  )
}

function Seg({ value, options, onChange }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-line">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`flex-1 py-1.5 text-[11px] capitalize ${
            value === o.value ? 'bg-panel2 text-paper' : 'bg-inset text-dim hover:text-paper'
          }`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function clamp01(n) {
  return Math.min(1, Math.max(0, n))
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 255, g: 255, b: 255 }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function rgbToHex(r, g, b) {
  const to = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

function rgbToHsv(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

function hsvToRgb(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  }
}

function normalizeHexInput(raw) {
  let v = String(raw || '').trim()
  if (/^[0-9a-fA-F]{6}$/.test(v)) v = `#${v}`
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase()
  return null
}

/** In-panel HSV picker — stays inside Styles (no OS popup). */
function HexColorPicker({ hex, onHex }) {
  const safe = normalizeHexInput(hex) || '#ffffff'
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const svRef = useRef(null)
  const hsv0 = rgbToHsv(...Object.values(hexToRgb(safe)))
  const [h, setH] = useState(hsv0.h)
  const [s, setS] = useState(hsv0.s)
  const [v, setV] = useState(hsv0.v)
  const [draft, setDraft] = useState(safe)
  const hsvRef = useRef({ h: hsv0.h, s: hsv0.s, v: hsv0.v })

  useEffect(() => {
    const next = normalizeHexInput(hex) || '#ffffff'
    const hsv = rgbToHsv(...Object.values(hexToRgb(next)))
    setH(hsv.h)
    setS(hsv.s)
    setV(hsv.v)
    hsvRef.current = hsv
    setDraft(next)
  }, [hex])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function emit(nh, ns, nv) {
    hsvRef.current = { h: nh, s: ns, v: nv }
    const rgb = hsvToRgb(nh, ns, nv)
    const next = rgbToHex(rgb.r, rgb.g, rgb.b)
    setDraft(next)
    onHex(next)
  }

  function pickSv(clientX, clientY) {
    const el = svRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const ns = clamp01((clientX - rect.left) / rect.width)
    const nv = clamp01(1 - (clientY - rect.top) / rect.height)
    setS(ns)
    setV(nv)
    emit(hsvRef.current.h, ns, nv)
  }

  function startSvDrag(e) {
    e.preventDefault()
    const pt = e.touches?.[0] || e
    pickSv(pt.clientX, pt.clientY)
    const move = (ev) => {
      const p = ev.touches?.[0] || ev
      pickSv(p.clientX, p.clientY)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', up)
  }

  const hueColor = (() => {
    const rgb = hsvToRgb(h, 1, 1)
    return rgbToHex(rgb.r, rgb.g, rgb.b)
  })()

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          title="Open colour picker"
          className="h-9 w-9 shrink-0 rounded-md border border-line"
          style={{ background: safe }}
          onClick={() => setOpen((o) => !o)}
        />
        <input
          className={`${inputClass} min-w-0 flex-1 font-mono text-[12px]`}
          value={draft}
          spellCheck={false}
          placeholder="#RRGGBB"
          onChange={(e) => {
            setDraft(e.target.value)
            const n = normalizeHexInput(e.target.value)
            if (n) onHex(n)
          }}
          onBlur={() => {
            const n = normalizeHexInput(draft)
            if (n) {
              setDraft(n)
              onHex(n)
            } else setDraft(safe)
          }}
        />
      </div>
      {open ? (
        <div className="absolute left-0 right-0 z-40 mt-2 rounded-md border border-line bg-panel2 p-2 shadow-lg">
          <div
            ref={svRef}
            className="relative mb-2 h-28 w-full cursor-crosshair overflow-hidden rounded"
            style={{
              background: `
                linear-gradient(to top, #000, transparent),
                linear-gradient(to right, #fff, ${hueColor})
              `,
            }}
            onMouseDown={startSvDrag}
            onTouchStart={startSvDrag}
          >
            <span
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
            />
          </div>
          <label className="mb-2 block">
            <span className="mb-1 block text-[10px] text-dim">Hue</span>
            <input
              type="range"
              min={0}
              max={360}
              value={Math.round(h)}
              className="ui-hue w-full"
              onChange={(e) => {
                const nh = +e.target.value
                setH(nh)
                emit(nh, s, v)
              }}
            />
          </label>
          <div className="flex items-center gap-2">
            <span
              className="h-7 w-7 shrink-0 rounded border border-line"
              style={{ background: safe }}
            />
            <span className="font-mono text-[11px] text-dim">{safe}</span>
            <button
              type="button"
              className="ml-auto text-[11px] text-paper underline decoration-line underline-offset-2"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ColorFields({ role, hex, roles, onRole, onHex }) {
  const roleVal = roles.some((r) => r.value === role) ? role : '__custom__'

  return (
    <div className="space-y-2">
      <Field label="Color role">
        <select
          className={inputClass}
          value={roleVal}
          onChange={(e) => {
            const v = e.target.value
            if (v === '__custom__') return
            onRole(v)
          }}
        >
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
          <option value="__custom__">Custom hex</option>
        </select>
      </Field>
      <Field label="Colour">
        <HexColorPicker hex={hex} onHex={onHex} />
      </Field>
    </div>
  )
}

function SizeStepper({ value, draft, onDraft, onPreview, onCommit, onNudge }) {
  const shown = draft !== '' && draft != null ? draft : String(value || 30)
  return (
    <div className="space-y-2">
      <input
        type="range"
        min={10}
        max={380}
        value={Math.min(380, Math.max(10, Number(shown) || value || 30))}
        className="ui-range w-full"
        onChange={(e) => {
          const px = +e.target.value
          onDraft(String(px))
          onPreview?.(px)
        }}
        onMouseUp={(e) => onCommit(+e.target.value)}
        onTouchEnd={(e) => onCommit(+e.currentTarget.value)}
        onKeyUp={(e) => onCommit(+e.target.value)}
      />
      <div className="grid grid-cols-[36px_1fr_36px] items-center gap-1.5">
        <button
          type="button"
          className="ui-step-btn"
          title="Decrease"
          onClick={() => onNudge(-1)}
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          className={`${inputClass} ui-num text-center tabular-nums`}
          value={shown}
          onFocus={() => onDraft(String(shown))}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d]/g, '')
            onDraft(raw)
            const n = Math.round(Number(raw))
            if (Number.isFinite(n) && n >= 8 && n <= 400 && String(n) === raw) {
              onPreview?.(n)
            }
          }}
          onBlur={(e) => onCommit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />
        <button
          type="button"
          className="ui-step-btn"
          title="Increase"
          onClick={() => onNudge(1)}
        >
          +
        </button>
      </div>
    </div>
  )
}

function SliderStepper({ label, value, min, max, step = 1, onChange }) {
  const v = Number.isFinite(+value) ? +value : min
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-dim">{label}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="ui-icon-btn h-6 w-6 px-0 text-[11px]"
            onClick={() => onChange(Math.max(min, v - step))}
          >
            −
          </button>
          <input
            type="number"
            className={`${inputClass} w-14 py-0.5 text-center text-[11px]`}
            value={v}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(+e.target.value)}
          />
          <button
            type="button"
            className="ui-icon-btn h-6 w-6 px-0 text-[11px]"
            onClick={() => onChange(Math.min(max, v + step))}
          >
            +
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, v))}
        className="w-full accent-blaze"
        onChange={(e) => onChange(+e.target.value)}
      />
    </div>
  )
}

function EffectPreset({ id, label, active, previewStyle, onClick }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-lg border p-2 ${
        active ? 'border-blaze bg-panel2' : 'border-line bg-inset hover:border-blaze/40'
      }`}
    >
      <span
        className="flex h-10 w-12 items-center justify-center rounded bg-[#0f172a] text-[18px] font-bold text-white"
        style={{ textShadow: previewStyle, fontFamily: 'Georgia, serif' }}
      >
        Ag
      </span>
      <span className="text-[10px] text-dim">{label}</span>
    </button>
  )
}

function FontPicker({ fonts, value, onCommit, onPreview, onPreviewEnd }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const current = fonts.find((f) => f.value === value) || fonts[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        onPreviewEnd?.()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onPreviewEnd])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        className={`${inputClass} flex w-full items-center justify-between gap-2 text-left`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate" style={{ fontFamily: value || 'inherit' }}>
          {current?.label || 'Font'}
        </span>
        <span className="text-[10px] text-muted">{open ? '▲' : '▼'}</span>
      </button>
      {open ? (
        <ul
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-line bg-panel2 shadow-lg"
          onMouseLeave={() => onPreviewEnd?.()}
        >
          {fonts.map((f) => (
            <li key={f.value}>
              <button
                type="button"
                className={`block w-full truncate px-2 py-2 text-left text-[13px] ${
                  f.value === value
                    ? 'bg-inset text-paper'
                    : 'text-dim hover:bg-inset hover:text-paper'
                }`}
                style={{ fontFamily: f.value }}
                onMouseEnter={() => onPreview?.(f.value)}
                onClick={() => {
                  onCommit?.(f.value)
                  setOpen(false)
                }}
              >
                {f.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Full layer properties: geometry, font, size, color, stroke, image crop, shape fill.
 */
export default function PropertiesPanel({ api, selected, snapshot }) {
  const [fonts, setFonts] = useState([])
  const [roles, setRoles] = useState([])
  const [styles, setStyles] = useState([])
  const [sizeDraft, setSizeDraft] = useState('')
  const [sizeFocused, setSizeFocused] = useState(false)

  useEffect(() => {
    if (!api) return
    try {
      if (api.listFontOptions) setFonts(api.listFontOptions() || [])
      if (api.listColorRoles) setRoles(api.listColorRoles() || [])
      if (api.listTextStylePresets) setStyles(api.listTextStylePresets() || [])
    } catch (_) {}
  }, [api])

  useEffect(() => {
    if (sizeFocused) return
    const px = selected?.geo?.size ?? selected?.geo?.baseSize ?? 30
    setSizeDraft(String(Math.round(+px || 30)))
  }, [selected?.id, selected?.geo?.size, selected?.geo?.baseSize, sizeFocused])

  if (!selected) {
    return <p className="text-sm text-dim">Select a layer on the canvas or in the list.</p>
  }

  const g = selected.geo || {}
  const patch = (p) => api?.patchLayerStyle?.(selected.id, p) || api?.setLayerGeometry?.(selected.id, p)

  function commitFontSize(raw) {
    const n = Math.round(Number(String(raw).trim()))
    if (!Number.isFinite(n)) {
      setSizeDraft(String(Math.round(g.size || 30)))
      return
    }
    const px = Math.max(8, Math.min(400, n))
    setSizeDraft(String(px))
    patch({ size: px })
  }

  return (
    <div className="space-y-1">
      {/* Geometry */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        {['x', 'y', 'w', 'h'].map((k) => (
          <Field key={k} label={k.toUpperCase()}>
            <input
              type="number"
              className={inputClass}
              value={Math.round(g[k] ?? 0)}
              onChange={(e) => patch({ [k]: +e.target.value })}
            />
          </Field>
        ))}
      </div>

      <Field label={`Rotation: ${Math.round((((g.rotate || 0) % 360) + 360) % 360)}°`}>
        <div className="mb-1 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={(((g.rotate || 0) % 360) + 360) % 360}
            className="ui-range min-w-0 flex-1"
            aria-label="Rotation degrees"
            onChange={(e) => patch({ rotate: +e.target.value })}
          />
          <input
            type="number"
            min={0}
            max={360}
            className={`${inputClass} w-16 shrink-0`}
            value={Math.round((((g.rotate || 0) % 360) + 360) % 360)}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              patch({ rotate: n })
            }}
          />
        </div>
        <div className="mb-2 flex gap-1">
          <button
            type="button"
            className="ui-btn flex-1 py-1 text-[11px]"
            onClick={() => patch({ rotate: ((((g.rotate || 0) % 360) + 360) % 360) - 15 })}
          >
            −15°
          </button>
          <button
            type="button"
            className="ui-btn flex-1 py-1 text-[11px]"
            onClick={() => patch({ rotate: 0 })}
          >
            Reset
          </button>
          <button
            type="button"
            className="ui-btn flex-1 py-1 text-[11px]"
            onClick={() => patch({ rotate: ((((g.rotate || 0) % 360) + 360) % 360) + 15 })}
          >
            +15°
          </button>
        </div>
        <p className="mb-2 text-[10px] text-muted">
          Drag the rotate handle under the selection, or set 0–360° here. Hold Shift while
          dragging to snap to 15°.
        </p>
      </Field>

      <Field label={`Opacity: ${Math.round((g.opacity ?? 1) * 100)}%`}>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round((g.opacity ?? 1) * 100)}
          className="w-full accent-blaze"
          onChange={(e) => patch({ opacity: +e.target.value / 100 })}
        />
      </Field>

      {/* Text content */}
      {selected.isText && selected.bind && selected.bind !== 'footer' && selected.kind !== 'stat' && (
        <>
          {selected.bind === 'playerMeta' ? (
            <>
              <Field label="Class / Year">
                <input
                  className={inputClass}
                  value={selected.playerClass ?? ''}
                  onChange={(e) => api?.setTextValue?.('playerClass', e.target.value)}
                />
              </Field>
              <Field label="Position">
                <input
                  className={inputClass}
                  value={selected.position ?? ''}
                  onChange={(e) => api?.setTextValue?.('position', e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field label={`Text (${selected.bind})`}>
              <textarea
                className={`${inputClass} min-h-[64px]`}
                value={selected.text ?? ''}
                onChange={(e) => api?.setTextValue?.(selected.bind, e.target.value)}
              />
            </Field>
          )}
        </>
      )}

      {/* Text style presets */}
      {selected.isText && (
        <>
          <Field label="Text style">
            <div className="grid grid-cols-2 gap-1">
              {styles.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`rounded-md border px-2 py-1.5 text-[11px] font-medium ${
                    selected.textStyle === s.id
                      ? 'border-line bg-panel2 text-paper'
                      : 'border-line bg-inset text-dim hover:text-paper'
                  }`}
                  onClick={() => api?.applyTextStyle?.(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </Field>

          {!selected.lockFonts && fonts.length > 0 && (
            <Field label="Font">
              <FontPicker
                fonts={fonts}
                value={g.font || ''}
                onPreview={(font) => api?.previewTextStyle?.({ font })}
                onPreviewEnd={() => api?.cancelTextStylePreview?.()}
                onCommit={(font) => {
                  // Commit keeps the previewed face (patch clears preview without restore)
                  patch({ font })
                }}
              />
            </Field>
          )}

          <Field label={`Font size: ${g.size || 30}px`}>
            <SizeStepper
              value={g.size || 30}
              draft={sizeDraft}
              onDraft={(v) => {
                setSizeFocused(true)
                setSizeDraft(v)
              }}
              onPreview={(px) => api?.previewTextStyle?.({ size: px })}
              onCommit={(raw) => {
                setSizeFocused(false)
                commitFontSize(raw)
              }}
              onNudge={(delta) => {
                const next = Math.max(8, Math.min(400, Math.round(+(g.size || 30) + delta)))
                setSizeDraft(String(next))
                patch({ size: next })
              }}
            />
            {g.fitSize != null && g.fitSize < g.size ? (
              <p className="mt-1 text-[10px] text-dim">
                Set {g.size}px — using {g.fitSize}px to fit the box.
              </p>
            ) : (
              <p className="mt-1 text-[10px] text-dim">Autofit shrinks long text inside the fixed box.</p>
            )}
          </Field>

          <Field label="Weight">
            <select
              className={inputClass}
              value={g.weight || 700}
              onChange={(e) => patch({ weight: +e.target.value })}
            >
              {[300, 400, 600, 700, 800, 900].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </Field>

          <ColorFields
            role={g.color}
            hex={g.colorHex}
            roles={roles}
            onRole={(v) => patch({ color: v })}
            onHex={(v) => patch({ color: v })}
          />

          <div className="mb-2 flex gap-3">
            <label className="flex items-center gap-1.5 text-sm text-dim">
              <input
                type="checkbox"
                checked={!!g.bold || (g.weight || 0) >= 700}
                onChange={(e) => patch({ bold: e.target.checked })}
              />
              Bold
            </label>
            <label className="flex items-center gap-1.5 text-sm text-dim">
              <input
                type="checkbox"
                checked={!!g.italic}
                onChange={(e) => patch({ italic: e.target.checked })}
              />
              Italics
            </label>
            <label className="flex items-center gap-1.5 text-sm text-dim">
              <input
                type="checkbox"
                checked={!!g.underline}
                onChange={(e) => patch({ underline: e.target.checked })}
              />
              Underline
            </label>
          </div>

          <Field label="Text transform">
            <Seg
              value={g.textTransform || 'none'}
              options={[
                { value: 'none', label: 'None' },
                { value: 'uppercase', label: 'UPPER' },
                { value: 'lowercase', label: 'lower' },
                { value: 'capitalize', label: 'Title' },
              ]}
              onChange={(v) => patch({ textTransform: v === 'none' ? null : v })}
            />
          </Field>

          <Field label={`Letter spacing: ${g.ls || 0}`}>
            <input
              type="range"
              min={0}
              max={14}
              value={g.ls || 0}
              className="w-full accent-blaze"
              onChange={(e) => patch({ ls: +e.target.value })}
            />
          </Field>

          <div className="my-3 border-t border-line pt-3">
            <h3 className="mb-2 text-[11px] font-semibold text-dim">Text effects</h3>

            <label className="mb-2 flex items-center gap-2 text-sm text-dim">
              <input
                type="checkbox"
                checked={!!g.bgOn}
                onChange={(e) => patch({ bgOn: e.target.checked })}
              />
              Text background
            </label>
            {g.bgOn && (
              <>
                <ColorFields
                  role={g.bg}
                  hex={g.bgHex}
                  roles={roles}
                  onRole={(v) => patch({ bg: v })}
                  onHex={(v) => patch({ bg: v })}
                />
                <Field label="Padding">
                  <input
                    className={inputClass}
                    value={g.pad || '8px 14px'}
                    placeholder="8px 14px"
                    onChange={(e) => patch({ pad: e.target.value })}
                  />
                </Field>
                <Field label={`Chip radius: ${g.radius || 6}`}>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={g.radius || 6}
                    className="w-full accent-blaze"
                    onChange={(e) => patch({ radius: +e.target.value })}
                  />
                </Field>
              </>
            )}

            <label className="mb-2 flex items-center gap-2 text-sm text-dim">
              <input
                type="checkbox"
                checked={!!g.textBorderOn}
                onChange={(e) => patch({ textBorderOn: e.target.checked })}
              />
              Text border (box)
            </label>
            {g.textBorderOn && (
              <>
                <Field label={`Border width: ${g.textBorderW || 2}px`}>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={g.textBorderW || 2}
                    className="w-full accent-blaze"
                    onChange={(e) => patch({ textBorderW: +e.target.value })}
                  />
                </Field>
                <ColorFields
                  role={g.textBorderColor}
                  hex={g.textBorderHex}
                  roles={roles}
                  onRole={(v) => patch({ textBorderColor: v })}
                  onHex={(v) => patch({ textBorderColor: v })}
                />
              </>
            )}

            <label className="mb-2 flex items-center gap-2 text-sm text-dim">
              <input
                type="checkbox"
                checked={!!g.strokeOn}
                onChange={(e) => patch({ strokeOn: e.target.checked })}
              />
              Text outline (glyph stroke)
            </label>
            {g.strokeOn && (
              <>
                <Field label={`Stroke width: ${g.strokeW || 2}px`}>
                  <input
                    type="range"
                    min={1}
                    max={24}
                    value={g.strokeW || 2}
                    className="w-full accent-blaze"
                    onChange={(e) => patch({ strokeW: +e.target.value })}
                  />
                </Field>
                <ColorFields
                  role={g.stroke}
                  hex={g.strokeHex}
                  roles={roles}
                  onRole={(v) => patch({ stroke: v })}
                  onHex={(v) => patch({ stroke: v })}
                />
              </>
            )}

            <div className="mt-3 border-t border-line pt-3">
              <h3 className="mb-2 text-[11px] font-semibold text-dim">Effects</h3>
              <div className="mb-3 grid grid-cols-3 gap-1.5">
                <EffectPreset
                  id="drop"
                  label="Drop"
                  active={!!g.shadow && (g.shadowEffect || 'drop') === 'drop'}
                  previewStyle="3px 3px 4px rgba(0,0,0,.55)"
                  onClick={() => patch({ shadowEffect: 'drop' })}
                />
                <EffectPreset
                  id="glow"
                  label="Glow"
                  active={!!g.shadow && g.shadowEffect === 'glow'}
                  previewStyle="0 0 6px #fff, 0 0 12px #fff"
                  onClick={() => patch({ shadowEffect: 'glow' })}
                />
                <EffectPreset
                  id="echo"
                  label="Echo"
                  active={!!g.shadow && g.shadowEffect === 'echo'}
                  previewStyle="3px 3px 0 rgba(0,0,0,.9), 6px 6px 0 rgba(0,0,0,.7), 9px 9px 0 rgba(0,0,0,.5)"
                  onClick={() => patch({ shadowEffect: 'echo' })}
                />
              </div>
              {g.shadow && (
                <>
                  {(g.shadowEffect || 'drop') !== 'glow' && (
                    <>
                      <SliderStepper
                        label="Direction"
                        value={g.shadowDir ?? -45}
                        min={-180}
                        max={180}
                        onChange={(v) => patch({ shadowDir: v })}
                      />
                      <SliderStepper
                        label="Offset"
                        value={g.shadowOffset ?? 12}
                        min={0}
                        max={80}
                        onChange={(v) => patch({ shadowOffset: v })}
                      />
                    </>
                  )}
                  {(g.shadowEffect || 'drop') !== 'echo' && (
                    <SliderStepper
                      label="Blur"
                      value={g.shadowBlur ?? 8}
                      min={0}
                      max={60}
                      onChange={(v) => patch({ shadowBlur: v })}
                    />
                  )}
                  <SliderStepper
                    label="Transparency"
                    value={g.shadowTransparency ?? Math.round(100 * (g.shadowOpacity ?? 0.55))}
                    min={0}
                    max={100}
                    onChange={(v) => patch({ shadowTransparency: v })}
                  />
                  <div className="mb-2">
                    <span className="mb-1 block text-[11px] text-dim">Colour</span>
                    <HexColorPicker
                      hex={
                        /^#[0-9a-fA-F]{6}$/.test(g.shadowHex || '')
                          ? g.shadowHex
                          : '#000000'
                      }
                      onHex={(v) => patch({ shadowColor: v })}
                    />
                  </div>
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary mt-1 w-full"
                    onClick={() => patch({ shadowEffect: 'none' })}
                  >
                    Remove effect
                  </button>
                </>
              )}
            </div>
          </div>

          <Field label="Align">
            <Seg
              value={g.align || 'left'}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(v) => patch({ align: v })}
            />
          </Field>
          <Field label="Vertical align">
            <Seg
              value={g.vAlign || 'middle'}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'middle', label: 'Middle' },
                { value: 'bottom', label: 'Bottom' },
              ]}
              onChange={(v) => patch({ vAlign: v })}
            />
          </Field>
        </>
      )}

      {/* Shape / block fill */}
      {selected.isBlock && (
        <>
          {selected.shape && (
            <p className="mb-2 text-xs text-dim">
              Shape: <b className="text-paper">{selected.shape}</b>
            </p>
          )}
          <Field label="Fill">
            <Seg
              value={g.gradient ? 'gradient' : 'solid'}
              options={[
                { value: 'solid', label: 'Solid' },
                { value: 'gradient', label: 'Gradient' },
              ]}
              onChange={(v) => {
                if (v === 'solid') {
                  patch({ gradient: null })
                } else {
                  patch({
                    gradient: {
                      type: g.gradient?.type || 'linear',
                      from: g.fill || g.color || 'primary',
                      to: g.gradient?.to || 'secondary',
                      angle: g.gradient?.angle ?? 135,
                    },
                  })
                }
              }}
            />
          </Field>
          <ColorFields
            role={g.gradient?.from || g.fill || g.color}
            hex={g.fillHex || g.colorHex}
            roles={roles}
            onRole={(v) =>
              g.gradient
                ? patch({ fill: v, gradient: { ...g.gradient, from: v } })
                : patch({ fill: v, color: v })
            }
            onHex={(v) =>
              g.gradient
                ? patch({ fill: v, gradient: { ...g.gradient, from: v } })
                : patch({ fill: v, color: v })
            }
          />
          {g.gradient ? (
            <>
              <p className="mb-1 mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                Gradient to
              </p>
              <ColorFields
                role={g.gradient.to || 'secondary'}
                hex={g.fillToHex || '#C5B358'}
                roles={roles}
                onRole={(v) => patch({ fillTo: v, gradient: { ...g.gradient, to: v } })}
                onHex={(v) => patch({ fillTo: v, gradient: { ...g.gradient, to: v } })}
              />
              <Field label="Type">
                <Seg
                  value={g.gradient.type || 'linear'}
                  options={[
                    { value: 'linear', label: 'Linear' },
                    { value: 'radial', label: 'Radial' },
                  ]}
                  onChange={(v) => patch({ gradient: { ...g.gradient, type: v } })}
                />
              </Field>
              {(g.gradient.type || 'linear') === 'linear' ? (
                <Field label={`Angle: ${Math.round(g.gradient.angle ?? 135)}°`}>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={g.gradient.angle ?? 135}
                    className="w-full accent-blaze"
                    onChange={(e) =>
                      patch({ gradient: { ...g.gradient, angle: +e.target.value } })
                    }
                  />
                </Field>
              ) : null}
            </>
          ) : null}
          {!g.hasClip && (
            <Field label={`Corner radius: ${g.radius || 0}`}>
              <input
                type="range"
                min={0}
                max={500}
                value={Math.min(500, g.radius || 0)}
                className="w-full accent-blaze"
                onChange={(e) => patch({ radius: +e.target.value })}
              />
            </Field>
          )}
          <label className="mb-2 flex items-center gap-2 text-sm text-dim">
            <input
              type="checkbox"
              checked={!!g.lockAspect}
              onChange={(e) => patch({ lockAspect: e.target.checked })}
            />
            Lock aspect ratio
          </label>
        </>
      )}

      {/* Image */}
      {selected.isImage && (
        <>
          <Field label="Fit">
            <Seg
              value={g.fit || 'contain'}
              options={[
                { value: 'cover', label: 'cover' },
                { value: 'contain', label: 'contain' },
                { value: 'fill', label: 'fill' },
              ]}
              onChange={(v) => patch({ fit: v })}
            />
          </Field>
          <button
            type="button"
            className={`mb-2 w-full rounded-md py-2 text-xs font-medium ${
              selected.cropping ? 'ui-btn-primary' : 'ui-btn'
            }`}
            onClick={() => patch({ cropping: !selected.cropping })}
          >
            {selected.cropping ? 'Done cropping' : 'Crop / reposition'}
          </button>
          <Field label={`Zoom: ${Math.round((g.zoom || 1) * 100)}%`}>
            <input
              type="range"
              min={100}
              max={400}
              value={Math.round((g.zoom || 1) * 100)}
              className="w-full accent-blaze"
              onChange={(e) => patch({ zoom: +e.target.value / 100 })}
            />
          </Field>
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className="rounded border border-line bg-inset py-1.5 text-xs text-dim hover:text-paper"
              onClick={() => patch({ flipH: !g.flipH })}
            >
              Flip H
            </button>
            <button
              type="button"
              className="rounded border border-line bg-inset py-1.5 text-xs text-dim hover:text-paper"
              onClick={() => patch({ flipV: !g.flipV })}
            >
              Flip V
            </button>
            <button
              type="button"
              className="col-span-2 rounded border border-line bg-inset py-1.5 text-xs text-dim hover:text-paper"
              onClick={() => patch({ resetCrop: true })}
            >
              Reset crop
            </button>
          </div>
          <Field label={`Corner radius: ${g.radius || 0}`}>
            <input
              type="range"
              min={0}
              max={200}
              value={g.radius || 0}
              className="w-full accent-blaze"
              onChange={(e) => patch({ radius: +e.target.value })}
            />
          </Field>
          <label className="mb-2 flex items-center gap-2 text-sm text-dim">
            <input
              type="checkbox"
              checked={!!g.lockAspect}
              onChange={(e) => patch({ lockAspect: e.target.checked })}
            />
            Lock aspect ratio
          </label>
          <label className="mb-2 flex items-center gap-2 text-sm text-dim">
            <input
              type="checkbox"
              checked={!!g.borderOn}
              onChange={(e) => patch({ borderOn: e.target.checked })}
            />
            Border
          </label>
          {g.borderOn && (
            <>
              <Field label={`Border width: ${g.borderW || 6}`}>
                <input
                  type="range"
                  min={1}
                  max={40}
                  value={g.borderW || 6}
                  className="w-full accent-blaze"
                  onChange={(e) => patch({ borderW: +e.target.value })}
                />
              </Field>
              <Field label="Border color">
                <select
                  className={inputClass}
                  value={g.borderColor || 'primary'}
                  onChange={(e) => patch({ borderColor: e.target.value })}
                >
                  {['primary', 'secondary', 'white', 'black'].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </>
      )}

      <label className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-sm text-dim">
        <input
          type="checkbox"
          checked={!!snapshot?.lockTemplateFonts}
          onChange={(e) => api?.setLockTemplateFonts?.(e.target.checked)}
        />
        Lock template fonts
      </label>
    </div>
  )
}
