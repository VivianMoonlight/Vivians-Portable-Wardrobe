/**
 * Composable for draggable/resizable window behavior
 * Handles position, size, and pointer events for floating windows
 */
import { ref, computed } from 'vue'
import { hostWindow, doc } from '@/utils/host-window.js'

export function useDraggableWindow(options = {}) {
  const {
    initialWidth = 1920,
    initialHeight = 1080,
    minWidth = 720,
    minHeight = 420,
    margin = 12
  } = options

  const pos = ref({ x: null, y: null })
  const size = ref({ w: initialWidth, h: initialHeight })
  const dragging = ref(false)
  const resizing = ref(false)
  const resizeDir = ref(null)
  const pointerStart = ref({ x: 0, y: 0 })
  const startRect = ref({ x: 0, y: 0, w: 0, h: 0 })

  const panelStyle = computed(() => {
    const currentMargin = margin
    const maxW = hostWindow.innerWidth - currentMargin * 2
    const maxH = hostWindow.innerHeight - currentMargin * 2

    const left = pos.value.x !== null
      ? pos.value.x
      : Math.max(currentMargin, Math.round((hostWindow.innerWidth - size.value.w) / 2))
    const top = pos.value.y !== null
      ? pos.value.y
      : Math.max(currentMargin, Math.round((hostWindow.innerHeight - size.value.h) / 2))

    return {
      left: left + 'px',
      top: top + 'px',
      width: Math.min(size.value.w, maxW) + 'px',
      height: Math.min(size.value.h, maxH) + 'px',
      maxHeight: `calc(var(--dvh-safe, 100dvh) - ${currentMargin * 2}px)`,
      position: 'fixed',
      zIndex: 10060
    }
  })

  function startDrag(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.target.closest('button')) return

    dragging.value = true
    pointerStart.value = { x: e.clientX, y: e.clientY }
    const currentMargin = margin
    const computedLeft = pos.value.x !== null
      ? pos.value.x
      : Math.max(currentMargin, Math.round((hostWindow.innerWidth - size.value.w) / 2))
    const computedTop = pos.value.y !== null
      ? pos.value.y
      : Math.max(currentMargin, Math.round((hostWindow.innerHeight - size.value.h) / 2))
    startRect.value = { x: computedLeft, y: computedTop, w: size.value.w, h: size.value.h }
    doc.body.style.userSelect = 'none'
    e.target?.setPointerCapture?.(e.pointerId)
  }

  function startResize(dir, e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    resizing.value = true
    resizeDir.value = dir
    pointerStart.value = { x: e.clientX, y: e.clientY }
    const currentMargin = margin
    const computedLeft = pos.value.x !== null
      ? pos.value.x
      : Math.max(currentMargin, Math.round((hostWindow.innerWidth - size.value.w) / 2))
    const computedTop = pos.value.y !== null
      ? pos.value.y
      : Math.max(currentMargin, Math.round((hostWindow.innerHeight - size.value.h) / 2))
    startRect.value = { x: computedLeft, y: computedTop, w: size.value.w, h: size.value.h }
    doc.body.style.userSelect = 'none'
    e.target?.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e) {
    const dx = e.clientX - pointerStart.value.x
    const dy = e.clientY - pointerStart.value.y

    if (dragging.value) {
      let nx = startRect.value.x + dx
      let ny = startRect.value.y + dy
      nx = Math.max(6, Math.min(nx, hostWindow.innerWidth - startRect.value.w - 6))
      ny = Math.max(6, Math.min(ny, hostWindow.innerHeight - startRect.value.h - 6))
      pos.value.x = nx
      pos.value.y = ny
    } else if (resizing.value) {
      const dir = resizeDir.value || ''
      let nx = startRect.value.x
      let ny = startRect.value.y
      let nw = startRect.value.w
      let nh = startRect.value.h

      if (dir.includes('left')) {
        nw = Math.max(minWidth, startRect.value.w - dx)
        nx = startRect.value.x + (startRect.value.w - nw)
      }
      if (dir.includes('right')) nw = Math.max(minWidth, startRect.value.w + dx)
      if (dir.includes('top')) {
        nh = Math.max(minHeight, startRect.value.h - dy)
        ny = startRect.value.y + (startRect.value.h - nh)
      }
      if (dir.includes('bottom')) nh = Math.max(minHeight, startRect.value.h + dy)

      nx = Math.max(6, Math.min(nx, hostWindow.innerWidth - 64))
      ny = Math.max(6, Math.min(ny, hostWindow.innerHeight - 64))
      nw = Math.min(nw, hostWindow.innerWidth - nx - 6)
      nh = Math.min(nh, hostWindow.innerHeight - ny - 6)

      pos.value.x = nx
      pos.value.y = ny
      size.value.w = nw
      size.value.h = nh
    }
  }

  function onPointerUp() {
    if (dragging.value || resizing.value) {
      dragging.value = false
      resizing.value = false
      resizeDir.value = null
      doc.body.style.userSelect = ''
    }
  }

  function resetPosition() {
    pos.value.x = null
    pos.value.y = null
  }

  return {
    pos,
    size,
    dragging,
    resizing,
    resizeDir,
    panelStyle,
    startDrag,
    startResize,
    onPointerMove,
    onPointerUp,
    resetPosition
  }
}
