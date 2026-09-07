import { useEffect, useRef, useState } from 'react'

/**
 * Smart crop for template image frames.
 * Frame aspect comes from the active template player box (e.g. 560×1017).
 * Drag to pan · zoom · optional ML background remove · Apply bakes fitted bitmap.
 */
export default function SmartCropModal({
  open,
  src,
  frameW = 560,
  frameH = 1017,
  slotLabel = 'Player image',
  onApply,
  onSkip,
  onClose,
  onRemoveBackground,
  cutoutBusy = false,
  cutoutDone = false,
}) {
  const fw = Math.max(1, Math.round(frameW) || 560)
  const fh = Math.max(1, Math.round(frameH) || 1017)
  const aspect = fw / fh

  const [zoom, setZoom] = useState(1)
  const [cropX, setCropX] = useState(0.5)
  const [cropY, setCropY] = useState(0.38)
  const [nat, setNat] = useState({ w: 0, h: 0 })
  const [busy, setBusy] = useState(false)
  const [previewSrc, setPreviewSrc] = useState(src)
  const dragRef = useRef(null)
  const applyBtnRef = useRef(null)

  useEffect(() => {
    if (!open || !src) return
    setPreviewSrc(src)
    setZoom(1)
    setCropX(0.5)
    setCropY(0.38)
    setBusy(false)
  }, [open, src])

  useEffect(() => {
    if (!previewSrc) return
    const img = new Image()
    img.onload = () => setNat({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 })
    img.src = previewSrc
  }, [previewSrc])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => applyBtnRef.current?.focus(), 40)
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open || !previewSrc) return null

  const stageH = 360
  const stageW = Math.min(320, Math.round(stageH * aspect))

  const nW = nat.w || fw
  const nH = nat.h || fh
  const base = Math.max(stageW / nW, stageH / nH)
  const s = base * zoom
  const dispW = nW * s
  const dispH = nH * s
  const left = (stageW - dispW) * cropX
  const top = (stageH - dispH) * cropY

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      cx: cropX,
      cy: cropY,
      overflowX: Math.max(0, dispW - stageW),
      overflowY: Math.max(0, dispH - stageH),
    }
  }

  function onPointerMove(e) {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    const nx = d.overflowX > 0 ? d.cx - dx / d.overflowX : 0.5
    const ny = d.overflowY > 0 ? d.cy - dy / d.overflowY : 0.5
    setCropX(Math.max(0, Math.min(1, nx)))
    setCropY(Math.max(0, Math.min(1, ny)))
  }

  function onPointerUp() {
    dragRef.current = null
  }

  async function handleApply() {
    if (busy || cutoutBusy) return
    setBusy(true)
    try {
      await onApply?.({ zoom, cropX, cropY, bake: true, src: previewSrc })
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveBg() {
    if (!onRemoveBackground || cutoutBusy || busy) return
    const next = await onRemoveBackground()
    if (next) setPreviewSrc(next)
  }

  const locked = busy || cutoutBusy

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose?.()
      }}
    >
      <div className="absolute inset-0 bg-[#0b1220]/55 backdrop-blur-[2px]" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-crop-title"
        className="relative z-[1] w-full max-w-[420px] overflow-hidden rounded-xl border border-line bg-panel shadow-[0_24px_64px_rgba(15,23,42,0.28)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-blaze">
              Smart crop
            </p>
            <h2 id="smart-crop-title" className="text-[15px] font-semibold text-paper">
              Fit {slotLabel.toLowerCase()} to frame
            </h2>
            <p className="mt-0.5 text-[11px] text-dim">
              Template frame {fw}×{fh}
              {nat.w ? ` · source ${nat.w}×${nat.h}` : ''}
              {cutoutDone ? ' · cutout' : ''}
            </p>
          </div>
          <button
            type="button"
            className="ui-icon-btn"
            aria-label="Close"
            disabled={locked}
            onClick={() => onClose?.()}
          >
            ×
          </button>
        </header>

        <div className="px-4 py-4">
          <div className="rounded-lg bg-[#121820] p-3 ring-1 ring-[#1e293b]">
            <div
              className="relative mx-auto touch-none overflow-hidden rounded-sm shadow-[inset_0_0_0_1px_rgba(56,189,248,0.35)]"
              style={{
                width: stageW,
                height: stageH,
                cursor: 'grab',
                // Checkerboard so PNG transparency is visible
                backgroundColor: '#1a222c',
                backgroundImage:
                  'linear-gradient(45deg,#2a3441 25%,transparent 25%),linear-gradient(-45deg,#2a3441 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a3441 75%),linear-gradient(-45deg,transparent 75%,#2a3441 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              role="img"
              aria-label="Crop preview. Drag to reposition."
            >
              <img
                src={previewSrc}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  width: dispW,
                  height: dispH,
                  left,
                  top,
                }}
              />
              <span className="pointer-events-none absolute left-1 top-1 h-3 w-3 border-l-2 border-t-2 border-blaze/90" />
              <span className="pointer-events-none absolute right-1 top-1 h-3 w-3 border-r-2 border-t-2 border-blaze/90" />
              <span className="pointer-events-none absolute bottom-1 left-1 h-3 w-3 border-b-2 border-l-2 border-blaze/90" />
              <span className="pointer-events-none absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-blaze/90" />
              {cutoutBusy ? (
                <div className="absolute inset-0 flex items-center justify-center bg-[#0b1220]/65 text-[11px] text-white">
                  Removing background…
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-center text-[10px] tracking-wide text-[#94a3b8]">
              Drag photo · frame locks to template ratio
            </p>
          </div>

          <label className="mt-4 block">
            <span className="mb-1 flex items-center justify-between text-[11px] text-dim">
              <span>Zoom</span>
              <span className="tabular-nums text-paper">{zoom.toFixed(2)}×</span>
            </span>
            <input
              type="range"
              className="ui-range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              aria-label="Zoom"
              disabled={locked}
              onChange={(e) => setZoom(+e.target.value)}
            />
          </label>

          {onRemoveBackground ? (
            <button
              type="button"
              className="ui-btn mt-3 w-full"
              disabled={locked || cutoutDone}
              onClick={handleRemoveBg}
            >
              {cutoutBusy
                ? 'Removing background…'
                : cutoutDone
                  ? 'Background removed'
                  : 'Remove background'}
            </button>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-inset/80 px-4 py-3">
          <button
            type="button"
            className="ui-btn"
            onClick={() => onSkip?.()}
            disabled={locked}
          >
            Use as-is
          </button>
          <button
            ref={applyBtnRef}
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={handleApply}
            disabled={locked}
          >
            {busy ? 'Fitting…' : 'Apply fit'}
          </button>
        </footer>
      </div>
    </div>
  )
}
