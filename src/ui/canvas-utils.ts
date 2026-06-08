import { hostWindow } from '@/utils/host-window.js'

/** A drawable source: an HTMLCanvasElement (or similar) produced by RenderService. */
type DrawableSource = CanvasImageSource & { width?: number; height?: number }

interface SizedCanvas extends HTMLCanvasElement {
  __cssW?: number
  __cssH?: number
  __dpr?: number
}

/**
 * Size a canvas's backing store to its measurement target with DPR scaling, and
 * reset the 2D transform so subsequent drawing uses CSS pixels. Ported from the
 * shared sizing logic in the Vue FileThumbnail / SidePreview components.
 */
export function sizeCanvasToContainer(
  canvas: HTMLCanvasElement | null,
  target: HTMLElement | null,
): void {
  const c = canvas as SizedCanvas | null
  if (!c || !target) return

  const rect = target.getBoundingClientRect()
  const cssW = Math.max(1, rect.width)
  const cssH = Math.max(1, rect.height)
  const dpr = hostWindow.devicePixelRatio || 1

  c.width = Math.round(cssW * dpr)
  c.height = Math.round(cssH * dpr)
  c.style.width = `${cssW}px`
  c.style.height = `${cssH}px`
  c.__cssW = cssW
  c.__cssH = cssH
  c.__dpr = dpr

  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
}

/** Draw a source canvas/image centered & aspect-fit into the target canvas. */
export function drawSourceCentered(
  canvas: HTMLCanvasElement | null,
  src: DrawableSource | null,
): void {
  const c = canvas as SizedCanvas | null
  if (!c || !src) return
  const ctx = c.getContext('2d')
  if (!ctx) return

  const cssW = c.__cssW || parseFloat(c.style.width) || c.width
  const cssH = c.__cssH || parseFloat(c.style.height) || c.height

  ctx.clearRect(0, 0, cssW, cssH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const srcW = (src.width as number) || 1
  const srcH = (src.height as number) || 1
  const srcAspect = srcW / srcH
  const destAspect = cssW / cssH

  let destW: number
  let destH: number
  if (destAspect > srcAspect) {
    destH = cssH
    destW = destH * srcAspect
  } else {
    destW = cssW
    destH = destW / srcAspect
  }

  const dx = (cssW - destW) / 2
  const dy = (cssH - destH) / 2

  try {
    ctx.drawImage(src, 0, 0, srcW, srcH, dx, dy, destW, destH)
    c.style.display = 'block'
  } catch {
    /* drawImage can throw on some offscreen sources; ignore to avoid crashing */
  }
}
