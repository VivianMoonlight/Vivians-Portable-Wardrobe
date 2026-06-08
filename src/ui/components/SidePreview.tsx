import { useEffect, useRef } from 'react'
import { Box, Button, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { hostWindow } from '@/utils/host-window.js'
import { getFs, useFs } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { drawSourceCentered, sizeCanvasToContainer } from '@/ui/canvas-utils'

interface SidePreviewProps {
  /** Show the primary "apply to character" action below the preview. */
  showApply?: boolean
}

/**
 * Character preview canvas for the currently active/previewed outfit.
 * Re-renders on previewItem change and on container resize. Ported from
 * SidePreview.vue.
 *
 * When `showApply` is set, a primary "apply to character" button is rendered
 * here so the core action stays reachable even when the Filter panel (its
 * previous home) is hidden.
 */
export function SidePreview({ showApply = false }: SidePreviewProps) {
  const { t } = useTranslation()
  const fs = useFs()
  const dialog = useDialog()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const previewItem = fs.previewItem
  const hasItem = !!previewItem
  const itemName = previewItem?.name ?? ''

  const applyCurrent = async () => {
    const ok = getFs().applyCurrentPreviewToCharacter()
    if (!ok) await dialog.alert(t('filterManager.applyFailed'))
  }
  // Re-run the draw effect whenever the preview payload identity changes.
  const previewData = previewItem?.data

  useEffect(() => {
    const store = getFs()
    const canvas = canvasRef.current
    if (!canvas) return
    const target = canvas.parentElement

    let disposed = false

    const update = async () => {
      const item = store.previewItem
      if (!item) {
        canvas.style.display = 'none'
        return
      }
      const renderer = store.renderer
      if (!renderer) return
      sizeCanvasToContainer(canvas, target)
      let src: HTMLCanvasElement | null = null
      try {
        renderer.startThumbFor?.(item)
        if (typeof renderer.getThumbCanvas === 'function') {
          src = await renderer.getThumbCanvas(item, { timeout: 3000 })
        } else if (typeof renderer.getCanvas === 'function') {
          src = await renderer.getCanvas(item, { timeout: 3000 })
        } else {
          src = renderer._getCanvas?.(item) ?? null
        }
      } catch {
        src = renderer._getCanvas?.(item) ?? null
      }
      if (disposed) return
      if (src) drawSourceCentered(canvas, src)
      else canvas.style.display = 'none'
    }

    let ro: ResizeObserver | null = null
    if (target && typeof hostWindow.ResizeObserver === 'function') {
      ro = new hostWindow.ResizeObserver(() => {
        sizeCanvasToContainer(canvas, target)
        void update()
      })
      ro.observe(target)
    }
    void update()

    return () => {
      disposed = true
      ro?.disconnect()
    }
  }, [previewData])

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        height: '100%',
        minHeight: 'clamp(180px, 40vh, 320px)',
        padding: 8,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          flex: '1 1 auto',
          minHeight: 180,
          borderRadius: 10,
          display: 'block',
        }}
      />
      {hasItem ? (
        <Text size="sm" fw={600} truncate w="100%" ta="center">
          {itemName}
        </Text>
      ) : (
        <Text size="sm" c="dimmed" ta="center">
          {t('sidePreview.hint')}
        </Text>
      )}

      {showApply && (
        <Button fullWidth disabled={!hasItem} onClick={applyCurrent}>
          {t('filterManager.applyCurrent')}
        </Button>
      )}
    </Box>
  )
}
