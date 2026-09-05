import { useCallback, useEffect, useRef, useState } from 'react'

const ENGINE_SRC = '/portal/index.html?embed=1'
const HEADLESS_SRC = '/portal/index.html?headless=1'

/**
 * Wait for window.__RENDER_API_V3__ inside an iframe.
 */
export function usePosterEngine({ headless = false } = {}) {
  const iframeRef = useRef(null)
  const [api, setApi] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const unsubRef = useRef(null)

  const src = headless ? HEADLESS_SRC : ENGINE_SRC

  const attach = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    const t0 = Date.now()
    const tick = () => {
      const a = win.__RENDER_API_V3__
      if (a?.listTemplates || a?.getEditorSnapshot || a?.setPayload) {
        setApi(a)
        setReady(true)
        setError(null)
        if (typeof a.subscribe === 'function') {
          unsubRef.current?.()
          unsubRef.current = a.subscribe((snap) => setSnapshot(snap))
        } else if (typeof a.getEditorSnapshot === 'function') {
          setSnapshot(a.getEditorSnapshot())
        }
        return
      }
      if (Date.now() - t0 > 25000) {
        setError('Poster engine failed to start')
        return
      }
      setTimeout(tick, 80)
    }
    tick()
  }, [])

  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const onLoad = useCallback(() => {
    attach()
  }, [attach])

  return { iframeRef, src, api, snapshot, setSnapshot, ready, error, onLoad }
}
