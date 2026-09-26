import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Box, Button, CloseButton, Group, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useFsSelector } from '@/stores/hooks'
import { useIsMobile } from '@/ui/hooks/useIsMobile'
import { hostWindow } from '@/utils/host-window.js'
import { FileManager } from './FileManager'
import { OutfitAdjustmentsDialog, OutfitAdjustmentsPage } from './OutfitAdjustmentsDialog'
import { ApplyOutfitButton, SidePreview } from './SidePreview'
import styles from './wardrobe-workspace.css?inline'

export function WardrobeWorkspace({ onMobileDetailChange }: { onMobileDetailChange?: (active: boolean) => void }) {
  const { t } = useTranslation()
  const selected = useFsSelector((fs) => fs.lockedItem)
  const isMobile = useIsMobile()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const browsingRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewBackRef = useRef<HTMLButtonElement>(null)
  const showPreview = previewOpen && !!selected

  useLayoutEffect(() => {
    onMobileDetailChange?.(isMobile && showPreview)
    return () => onMobileDetailChange?.(false)
  }, [isMobile, showPreview, onMobileDetailChange])

  useEffect(() => {
    if (isMobile && showPreview) previewBackRef.current?.focus({ preventScroll: true })
  }, [isMobile, showPreview])

  useEffect(() => {
    if (!selected) {
      setPreviewOpen(false)
      setAdjusting(false)
    }
  }, [selected])

  const closePreview = () => {
    setPreviewOpen(false)
    setAdjusting(false)
    hostWindow.requestAnimationFrame(() => {
      browsingRef.current?.querySelector<HTMLElement>('[aria-pressed="true"][data-outfit-id]')?.focus({ preventScroll: true })
    })
  }

  const closeAdjustments = () => {
    setAdjusting(false)
    if (isMobile) hostWindow.requestAnimationFrame(() => {
      previewRef.current?.querySelector<HTMLButtonElement>('.vpw-preview-actions button')?.focus({ preventScroll: true })
    })
  }

  const onPreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return
    const target = event.nativeEvent.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement)
    if (target?.closest('[role="listbox"], [role="menu"], [aria-haspopup][aria-controls], [aria-expanded="true"][aria-haspopup]')) return
    event.stopPropagation()
    event.preventDefault()
    closePreview()
  }

  const preview = (
    <Box ref={previewRef} className="vpw-preview-pane">
      <Group justify="space-between" wrap="nowrap" gap="xs" className="vpw-preview-heading">
        <Box style={{ minWidth: 0 }}>
          {!isMobile && <Text size="xs" c="dimmed">{t('outfitFlow.previewTitle', { defaultValue: '试穿预览' })}</Text>}
          <Text size="sm" fw={700} truncate>{selected?.name}</Text>
        </Box>
        {!isMobile && <CloseButton onClick={closePreview} aria-label={t('outfitFlow.closePreview', { defaultValue: '收起预览' })} />}
      </Group>
      <Box className="vpw-preview-canvas"><SidePreview /></Box>
      <Box className="vpw-preview-actions">
        <Button fullWidth variant="default" aria-haspopup={isMobile ? undefined : 'dialog'} onClick={() => setAdjusting(true)}>
          {t('outfitFlow.openAdjustments', { defaultValue: '微调部位' })}
        </Button>
        <Text size="xs" c="dimmed">{t('outfitFlow.applyHint')}</Text>
        <ApplyOutfitButton />
      </Box>
    </Box>
  )

  return (
    <Box className="vpw-workspace">
      <style>{styles}</style>
      <Box className="vpw-workspace-columns" data-preview-open={showPreview && !isMobile || undefined}
        style={{ display: isMobile && showPreview ? 'none' : undefined }}>
        <Box ref={browsingRef} className="vpw-workspace-browse">
          <FileManager onSelectOutfit={() => setPreviewOpen(true)} />
        </Box>
        {showPreview && !isMobile && (
          <Box component="aside" aria-label={t('outfitFlow.previewTitle', { defaultValue: '试穿预览' })} className="vpw-workspace-preview">
            {preview}
          </Box>
        )}
      </Box>
      {showPreview && isMobile && <>
        <Box component="section" aria-label={t('outfitFlow.previewTitle')} className="vpw-mobile-preview-page"
          onKeyDownCapture={onPreviewKeyDown}
          onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }}
          style={{ display: adjusting ? 'none' : undefined }}>
          <Group wrap="nowrap" gap="xs" className="vpw-mobile-page-header">
            <Button ref={previewBackRef} variant="subtle" size="compact-sm" leftSection={<span aria-hidden>←</span>} onClick={closePreview}>
              {t('outfitFlow.backToLibrary')}
            </Button>
            <Text fw={600} size="sm" truncate>{t('outfitFlow.previewTitle')}</Text>
          </Group>
          <Box className="vpw-mobile-preview-content">{preview}</Box>
        </Box>
        {adjusting && <OutfitAdjustmentsPage onBack={closeAdjustments} />}
      </>}
      {!isMobile && <OutfitAdjustmentsDialog opened={showPreview && adjusting} onClose={closeAdjustments} />}
    </Box>
  )
}
