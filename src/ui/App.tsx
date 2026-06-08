import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { hostWindow } from '@/utils/host-window.js'
import logo from '@/assets/logo.png'
import { FileManagerPanel } from './components/FileManagerPanel'

interface AppProps {
  rootEl: HTMLElement
}

const LAUNCHER_STORAGE_KEY = 'vpw-launcher-position-v1'
const DRAG_THRESHOLD = 6
const LAUNCHER_MIN_SIZE = 44
const LAUNCHER_MAX_SIZE = 104

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Root wardrobe UI: a draggable floating launcher that toggles the main panel. */
export function App(_props: AppProps) {
  const [showPanel, setShowPanel] = useState(false)
  const [pos, setPos] = useState({ x: 20, y: 100 })
  const [size, setSize] = useState(64)
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)

  const drag = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0, moved: false })
  const resize = useRef({ active: false, startX: 0, baseSize: 64, moved: false })
  const latestSize = useRef(size)
  const suppressClick = useRef(false)
  const hasCustomPos = useRef(false)
  const hasCustomSize = useRef(false)

  const adaptiveSize = useCallback(() => {
    const shortEdge = Math.min(hostWindow.innerWidth, hostWindow.innerHeight)
    return clamp(Math.round(shortEdge * 0.09), 52, 72)
  }, [])

  useEffect(() => {
    latestSize.current = size
  }, [size])

  const bounds = useCallback((s: number) => {
    const margin = 12
    return {
      minX: margin,
      maxX: Math.max(margin, hostWindow.innerWidth - s - margin),
      minY: margin,
      maxY: Math.max(margin, hostWindow.innerHeight - s - margin),
    }
  }, [])

  // Load persisted position once.
  useEffect(() => {
    let loadedSize: number | null = null
    try {
      const raw = hostWindow.localStorage.getItem(LAUNCHER_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          setPos({ x: parsed.x, y: parsed.y })
          hasCustomPos.current = true
        }
        if (typeof parsed?.size === 'number') {
          loadedSize = clamp(parsed.size, LAUNCHER_MIN_SIZE, LAUNCHER_MAX_SIZE)
          setSize(loadedSize)
          hasCustomSize.current = true
        }
      }
    } catch {
      /* ignore */
    }
    const s = loadedSize ?? adaptiveSize()
    setSize(s)
    if (!hasCustomPos.current) {
      const b = bounds(s)
      setPos({ x: b.minX + 8, y: b.maxY - 72 })
    }
  }, [adaptiveSize, bounds])

  // Keep launcher inside the viewport on resize.
  useEffect(() => {
    const onResize = () => {
      const s = hasCustomSize.current ? size : adaptiveSize()
      setSize(s)
      setPos((p) => {
        if (!hasCustomPos.current) {
          const b = bounds(s)
          return { x: b.minX + 8, y: b.maxY - 72 }
        }
        const b = bounds(s)
        return { x: clamp(p.x, b.minX, b.maxX), y: clamp(p.y, b.minY, b.maxY) }
      })
    }
    hostWindow.addEventListener('resize', onResize)
    return () => hostWindow.removeEventListener('resize', onResize)
  }, [adaptiveSize, bounds, size])

  const onPointerMove = useCallback(
    (event: globalThis.PointerEvent) => {
      if (!drag.current.active) return
      const dx = event.clientX - drag.current.startX
      const dy = event.clientY - drag.current.startY
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) drag.current.moved = true
      const b = bounds(size)
      setPos({
        x: clamp(drag.current.baseX + dx, b.minX, b.maxX),
        y: clamp(drag.current.baseY + dy, b.minY, b.maxY),
      })
    },
    [bounds, size],
  )

  const onResizeMove = useCallback(
    (event: globalThis.PointerEvent) => {
      if (!resize.current.active) return
      const dx = event.clientX - resize.current.startX
      if (Math.abs(dx) > DRAG_THRESHOLD) resize.current.moved = true
      const maxFromViewport = Math.min(LAUNCHER_MAX_SIZE, hostWindow.innerWidth - pos.x - 12, hostWindow.innerHeight - pos.y - 12)
      setSize(clamp(resize.current.baseSize + dx, LAUNCHER_MIN_SIZE, Math.max(LAUNCHER_MIN_SIZE, maxFromViewport)))
    },
    [pos.x, pos.y],
  )

  const onPointerUp = useCallback(() => {
    const wasDragging = drag.current.active
    const wasResizing = resize.current.active
    if (!wasDragging && !wasResizing) return
    drag.current.active = false
    resize.current.active = false
    setDragging(false)
    setResizing(false)
    hostWindow.removeEventListener('pointermove', onPointerMove)
    hostWindow.removeEventListener('pointermove', onResizeMove)
    hostWindow.removeEventListener('pointerup', onPointerUp)
    if (drag.current.moved || resize.current.moved) {
      suppressClick.current = true
      hasCustomPos.current = true
      if (resize.current.moved) hasCustomSize.current = true
      setPos((p) => {
        try {
          hostWindow.localStorage.setItem(LAUNCHER_STORAGE_KEY, JSON.stringify({ ...p, size: latestSize.current }))
        } catch {
          /* ignore */
        }
        return p
      })
    }
  }, [onPointerMove, onResizeMove, size])

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    drag.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      baseX: pos.x,
      baseY: pos.y,
      moved: false,
    }
    setDragging(true)
    hostWindow.addEventListener('pointermove', onPointerMove)
    hostWindow.addEventListener('pointerup', onPointerUp)
  }

  const onResizePointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    resize.current = {
      active: true,
      startX: event.clientX,
      baseSize: size,
      moved: false,
    }
    setResizing(true)
    hostWindow.addEventListener('pointermove', onResizeMove)
    hostWindow.addEventListener('pointerup', onPointerUp)
  }

  const togglePanel = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    setShowPanel((v) => !v)
  }

  return (
    <>
      <button
        type="button"
        onClick={togglePanel}
        onPointerDown={onPointerDown}
        aria-pressed={showPanel}
        title="Vivian's Portable Wardrobe"
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: size,
          height: size,
          borderRadius: '50%',
          border: 'none',
          padding: 0,
          cursor: dragging ? 'grabbing' : resizing ? 'nwse-resize' : 'pointer',
          background: 'linear-gradient(135deg, #ffffff 0%, #cfcfcf 55%, #e5e5e5 100%)',
          boxShadow: '0 10px 30px rgba(7, 33, 58, 0.18)',
          zIndex: 2147483647,
          touchAction: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img src={logo} alt="" style={{ width: '56%', height: '56%', objectFit: 'contain', pointerEvents: 'none' }} />
        <span
          aria-hidden
          onPointerDown={onResizePointerDown}
          style={{
            position: 'absolute',
            right: 4,
            bottom: 4,
            width: Math.max(10, size * 0.18),
            height: Math.max(10, size * 0.18),
            borderRadius: '50%',
            background: 'rgba(20, 85, 140, 0.58)',
            border: '1px solid rgba(255,255,255,0.85)',
            cursor: 'nwse-resize',
            touchAction: 'none',
          }}
        />
      </button>

      <FileManagerPanel opened={showPanel} onClose={() => setShowPanel(false)} />
    </>
  )
}
