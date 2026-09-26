import { useEffect, useRef, useState } from 'react'
import { Box, Button, Group, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useFsSelector } from '@/stores/hooks'
import { FileManager } from './FileManager'
import { FilterManager } from './FilterManager'
import { ApplyOutfitButton, SidePreview } from './SidePreview'
import styles from './wardrobe-workspace.css?inline'

export function WardrobeWorkspace() {
  const { t } = useTranslation()
  const selected = useFsSelector((fs) => fs.lockedItem)
  const [editing, setEditing] = useState(false)
  const headingRef = useRef<HTMLParagraphElement>(null)
  const browsingRef = useRef<HTMLDivElement>(null)
  const showPreview = editing && !!selected

  useEffect(() => {
    if (showPreview) headingRef.current?.focus()
  }, [showPreview])

  const backToLibrary = () => {
    setEditing(false)
    requestAnimationFrame(() => {
      browsingRef.current?.querySelector<HTMLElement>('[aria-pressed="true"][data-outfit-id], [data-outfit-id] button, input')?.focus({ preventScroll: true })
    })
  }

  return (
    <Box className="vpw-workspace">
      <style>{styles}</style>
      <Box ref={browsingRef} className="vpw-workspace-browse" style={{ display: showPreview ? 'none' : 'block' }}>
        <FileManager onSelectOutfit={() => setEditing(true)} />
      </Box>
      {showPreview && (
        <Box className="vpw-workspace-edit">
          <Group gap="sm" wrap="nowrap" className="vpw-workspace-heading">
            <Button variant="subtle" size="compact-sm" onClick={backToLibrary}>
              ← {t('outfitFlow.backToLibrary')}
            </Button>
            <Box style={{ minWidth: 0 }}>
              <Text ref={headingRef} tabIndex={-1} fw={700} size="sm" truncate style={{ outline: 'none' }}>
                {selected.name || t('outfitFlow.previewAndAdjust')}
              </Text>
              <Text size="xs" c="dimmed">{t('outfitFlow.previewAndAdjust')}</Text>
            </Box>
          </Group>
          <Box className="vpw-workspace-body">
            <Box className="vpw-workspace-preview"><SidePreview /></Box>
            <Box className="vpw-workspace-adjustments"><FilterManager /></Box>
          </Box>
          <Box className="vpw-workspace-footer">
            <Text size="xs" c="dimmed" className="vpw-workspace-hint">{t('outfitFlow.applyHint')}</Text>
            <Box className="vpw-workspace-apply"><ApplyOutfitButton /></Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}
