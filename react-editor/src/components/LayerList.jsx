import { useMemo, useState } from 'react'

/**
 * Layers list with HTML5 drag-reorder (front of list = front of canvas).
 * Only calls api.reorderLayers — does not change other layer properties.
 */
export default function LayerList({
  layers = [],
  selectedId = null,
  api = null,
  emptyText = 'No layers',
  className = '',
}) {
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  // Snapshot layers are low→high z; show front-first for natural drag UX
  const display = useMemo(() => [...(layers || [])].reverse(), [layers])

  function applyOrder(nextFrontFirst) {
    if (!api?.reorderLayers) return
    api.reorderLayers(nextFrontFirst)
    setDragId(null)
    setOverId(null)
  }

  function moveDragTo(targetId) {
    if (!dragId || !targetId || dragId === targetId) return
    const ids = display.map((l) => l.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const next = [...ids]
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    applyOrder(next)
  }

  if (!display.length) {
    return <p className={`px-2 text-[11px] text-muted ${className}`}>{emptyText}</p>
  }

  return (
    <ul className={`space-y-0.5 ${className}`}>
      <li className="px-1 pb-1 text-[10px] text-muted">Drag to reorder · top = front</li>
      {display.map((layer) => {
        const selected = selectedId === layer.id
        const dragging = dragId === layer.id
        const over = overId === layer.id && dragId && dragId !== layer.id
        return (
          <li
            key={layer.id}
            draggable
            onDragStart={(e) => {
              setDragId(layer.id)
              try {
                e.dataTransfer.setData('text/plain', layer.id)
                e.dataTransfer.effectAllowed = 'move'
              } catch (_) {}
            }}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              try {
                e.dataTransfer.dropEffect = 'move'
              } catch (_) {}
              if (overId !== layer.id) setOverId(layer.id)
            }}
            onDragLeave={() => {
              if (overId === layer.id) setOverId(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              moveDragTo(layer.id)
            }}
            className={`rounded-md border transition-colors ${
              over ? 'border-blaze bg-blaze/10' : 'border-transparent'
            } ${dragging ? 'opacity-50' : ''}`}
          >
            <button
              type="button"
              onClick={() => api?.selectLayer?.(layer.id)}
              className={`flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] active:cursor-grabbing ${
                selected
                  ? 'bg-panel2 text-paper'
                  : 'text-dim hover:bg-inset hover:text-paper'
              }`}
            >
              <span
                className="shrink-0 select-none text-[11px] text-muted"
                title="Drag to reorder"
                aria-hidden
              >
                ⋮⋮
              </span>
              <span className="w-10 shrink-0 text-[10px] uppercase text-muted">
                {layer.type}
              </span>
              <span className="truncate">{layer.label}</span>
              {layer.locked ? (
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted">
                  Locked
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
