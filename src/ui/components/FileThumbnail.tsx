import { useEffect, useRef, useState } from 'react'
import { Loader } from '@mantine/core'
import { hostWindow } from '@/utils/host-window.js'
import { getFs, type FileNode } from '@/stores/hooks'
import { drawSourceCentered, sizeCanvasToContainer } from '@/ui/canvas-utils'

interface FileThumbnailProps {
  item: FileNode
}

/** Subscribe to BC render updates only while the thumbnail is near the viewport. */
export function FileThumbnail({ item }: FileThumbnailProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const fs = getFs()
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return

    let inViewport = false
    let disposed = false
    let source: HTMLCanvasElement | null = null
    let unsubscribe: (() => void) | null = null
    let subscriptionId = 0
    canvas.style.display = 'none'
    setLoading(false)

    const draw = () => {
      sizeCanvasToContainer(canvas, root)
      if (source) drawSourceCentered(canvas, source)
      else canvas.style.display = 'none'
    }

    const stop = () => {
      subscriptionId += 1
      unsubscribe?.()
      unsubscribe = null
      source = null
      canvas.style.display = 'none'
      canvas.width = 1
      canvas.height = 1
      // Recompute the backing size when this thumbnail becomes visible again.
      delete (canvas as HTMLCanvasElement & { __cssW?: number }).__cssW
      root.removeAttribute('aria-busy')
      if (!disposed) setLoading(false)
    }

    const start = () => {
      if (disposed || unsubscribe) return
      const currentId = ++subscriptionId
      draw()
      unsubscribe = fs.renderer.observe(item, (
        nextSource: HTMLCanvasElement | null,
        status: { state: string },
      ) => {
        if (disposed || !inViewport || currentId !== subscriptionId) return
        source = nextSource
        setLoading(status.state === 'loading')
        root.setAttribute('aria-busy', String(status.state === 'loading'))
        draw()
      })
    }

    let io: IntersectionObserver | null = null
    if (typeof hostWindow.IntersectionObserver === 'function') {
      io = new hostWindow.IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          inViewport = !!(entry && (entry.isIntersecting || entry.intersectionRatio > 0))
          if (inViewport) start()
          else stop()
        },
        { root: null, rootMargin: '180px 0px', threshold: 0.01 },
      )
      io.observe(root)
    } else {
      inViewport = true
      start()
    }

    let ro: ResizeObserver | null = null
    let roRaf = 0
    if (canvas.parentElement && typeof hostWindow.ResizeObserver === 'function') {
      ro = new hostWindow.ResizeObserver(() => {
        // Defer to the next frame to avoid a synchronous ResizeObserver loop.
        if (roRaf) hostWindow.cancelAnimationFrame(roRaf)
        roRaf = hostWindow.requestAnimationFrame(() => {
          roRaf = 0
          if (inViewport) draw()
        })
      })
      ro.observe(canvas.parentElement)
    }

    return () => {
      disposed = true
      stop()
      if (roRaf) hostWindow.cancelAnimationFrame(roRaf)
      io?.disconnect()
      ro?.disconnect()
    }
  }, [item, item.__thumbRefresh])

  return (
    <div
      ref={rootRef}
      className="vpw-thumbnail"
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <canvas
        ref={canvasRef}
        width={80}
        height={160}
        style={{ width: '100%', height: '100%', display: 'none' }}
      />
      {loading && <Loader size="xs" aria-hidden style={{ position: 'absolute', right: 6, bottom: 6, pointerEvents: 'none' }} />}
    </div>
  )
}
