import { useEffect, useState } from 'react'

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

function ColorFields({ role, hex, roles, onRole, onHex }) {
  const safeHex = /^#[0-9a-fA-F]{6}$/.test(hex || '') ? hex : '#ffffff'
  const roleVal = roles.some((r) => r.value === role) ? role : '__custom__'
  return (
    <>
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
      <div className="mb-2 flex gap-2">
        <Field label="Hex">
          <input
            className={inputClass}
            value={hex || ''}
            spellCheck={false}
            onChange={(e) => onHex(e.target.value)}
            onBlur={(e) => {
              let v = e.target.value.trim()
              if (/^[0-9a-fA-F]{6}$/.test(v)) v = `#${v}`
              if (/^#[0-9a-fA-F]{6}$/.test(v)) onHex(v)
            }}
          />
        </Field>
        <Field label="Swatch">
          <input
            type="color"
            className="h-9 w-full cursor-pointer rounded border border-line bg-inset"
            value={safeHex}
            onChange={(e) => onHex(e.target.value)}
          />
        </Field>
      </div>
    </>
  )
}

/**
 * Full layer properties: geometry, font, size, color, stroke, image crop, shape fill.
 */
export default function PropertiesPanel({ api, selected, snapshot }) {
  const [fonts, setFonts] = useState([])
  const [roles, setRoles] = useState([])
  const [styles, setStyles] = useState([])

  useEffect(() => {
    if (!api) return
    try {
      if (api.listFontOptions) setFonts(api.listFontOptions() || [])
      if (api.listColorRoles) setRoles(api.listColorRoles() || [])
      if (api.listTextStylePresets) setStyles(api.listTextStylePresets() || [])
    } catch (_) {}
  }, [api])

  if (!selected) {
    return <p className="text-sm text-dim">Select a layer on the canvas or in the list.</p>
  }

  const g = selected.geo || {}
  const patch = (p) => api?.patchLayerStyle?.(selected.id, p) || api?.setLayerGeometry?.(selected.id, p)

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

      <Field label={`Rotation: ${g.rotate || 0}°`}>
        <input
          type="range"
          min={selected.isText ? -90 : -180}
          max={selected.isText ? 90 : 180}
          value={g.rotate || 0}
          className="w-full accent-blaze"
          onChange={(e) => patch({ rotate: +e.target.value })}
        />
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
              <select
                className={inputClass}
                value={g.font || ''}
                onChange={(e) => patch({ font: e.target.value })}
              >
                {fonts.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label={`Font size: ${g.size || 30}px`}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={10}
                max={380}
                value={g.size || 30}
                className="min-w-0 flex-1 accent-blaze"
                onChange={(e) => patch({ size: +e.target.value })}
              />
              <input
                type="number"
                min={8}
                max={400}
                className={`${inputClass} w-16 shrink-0`}
                value={g.size || 30}
                onChange={(e) => patch({ size: +e.target.value })}
              />
            </div>
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

            <label className="mb-2 flex items-center gap-2 text-sm text-dim">
              <input
                type="checkbox"
                checked={!!g.shadow}
                onChange={(e) => patch({ shadow: e.target.checked })}
              />
              Text shadow
            </label>
            {g.shadow && (
              <>
                <ColorFields
                  role={g.shadowColor}
                  hex={g.shadowHex}
                  roles={roles}
                  onRole={(v) => patch({ shadowColor: v })}
                  onHex={(v) => patch({ shadowColor: v })}
                />
                <Field label={`Blur: ${g.shadowBlur ?? 8}px`}>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={g.shadowBlur ?? 8}
                    className="w-full accent-blaze"
                    onChange={(e) => patch({ shadowBlur: +e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Offset X">
                    <input
                      type="number"
                      className={inputClass}
                      value={g.shadowX ?? 0}
                      onChange={(e) => patch({ shadowX: +e.target.value })}
                    />
                  </Field>
                  <Field label="Offset Y">
                    <input
                      type="number"
                      className={inputClass}
                      value={g.shadowY ?? 3}
                      onChange={(e) => patch({ shadowY: +e.target.value })}
                    />
                  </Field>
                </div>
              </>
            )}
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
          <ColorFields
            role={g.fill || g.color}
            hex={g.fillHex || g.colorHex}
            roles={roles}
            onRole={(v) => patch({ fill: v, color: v })}
            onHex={(v) => patch({ fill: v, color: v })}
          />
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
