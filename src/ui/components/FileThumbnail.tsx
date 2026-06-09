import { useEffect, useRef } from 'react'
import { hostWindow } from '@/utils/host-window.js'
import { getFs, type FileNode } from '@/stores/hooks'
import { drawSourceCentered, sizeCanvasToContainer } from '@/ui/canvas-utils'

interface FileThumbnailProps {
  item: FileNode
}

/**
 * Canvas outfit thumbnail. Lazily renders when scrolled into view
 * (IntersectionObserver) and re-fits on container resize (ResizeObserver),
 * pulling the rendered canvas from the store's RenderService. Ported from
 * FileThumbnail.vue.
 */
export function FileThumbnail({ item }: FileThumbnailProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const fs = getFs()
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return

    let inViewport = false
    let rendering = false
    let rerenderPending = false
    let disposed = false

    const render = async () => {
      if (disposed || !inViewport || rendering) {
        if (inViewport) rerenderPending = true
        return
      }
      rendering = true
      try {
        fs.startThumbnailGeneration(item)
        sizeCanvasToContainer(canvas, canvas.parentElement)
        let src: HTMLCanvasElement | null = null
        try {
          src = await fs.renderer.getCanvas(item, { timeout: 20000 })
        } catch {
          src = fs.renderer._getCanvas?.(item) ?? null
        }
        if (disposed) return
        if (src) drawSourceCentered(canvas, src)
        else canvas.style.display = 'none'
      } finally {
        rendering = false
        if (rerenderPending && inViewport && !disposed) {
          rerenderPending = false
          void render()
        }
      }
    }

    let io: IntersectionObserver | null = null
    if (typeof hostWindow.IntersectionObserver === 'function') {
      io = new hostWindow.IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          inViewport = !!(entry && (entry.isIntersecting || entry.intersectionRatio > 0))
          if (inViewport) void render()
        },
        { root: null, rootMargin: '180px 0px', threshold: 0.01 },
      )
      io.observe(root)
    } else {
      inViewport = true
      void render()
    }

    let ro: ResizeObserver | null = null
    let roRaf = 0
    if (canvas.parentElement && typeof hostWindow.ResizeObserver === 'function') {
      ro = new hostWindow.ResizeObserver(() => {
        // Defer to the next frame to avoid a synchronous ResizeObserver loop.
        if (roRaf) hostWindow.cancelAnimationFrame(roRaf)
        roRaf = hostWindow.requestAnimationFrame(() => {
          roRaf = 0
          if (sizeCanvasToContainer(canvas, canvas.parentElement) && inViewport) void render()
        })
      })
      ro.observe(canvas.parentElement)
    }

    return () => {
      disposed = true
      if (roRaf) hostWindow.cancelAnimationFrame(roRaf)
      io?.disconnect()
      ro?.disconnect()
    }
  }, [item, item.__thumbRefresh])

  return (
    <div
      ref={rootRef}
      className="vpw-thumbnail"
      style={{ width: '100%', height: '100%' }}
    >
      <canvas
        ref={canvasRef}
        width={80}
        height={160}
        style={{ width: '100%', height: '100%', display: 'none' }}
      />
    </div>
  )
}
