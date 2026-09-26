import { memo, useId, useState, type MouseEvent } from 'react'
import { ActionIcon, Badge, Box, Button, FocusTrap, Group, Paper, Portal, Text, UnstyledButton, VisuallyHidden } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { hostWindow } from '@/utils/host-window.js'
import { ExternalAdapter } from '@/utils/external_adapters.js'
import { getFs, useFsSelector, type WardrobeOutfit } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { OVERLAY_Z_INDEX } from '@/ui/z-index'
import { FileThumbnail } from './FileThumbnail'

interface FileItemProps {
  item: WardrobeOutfit
  tagNames: string[]
  viewMode: 'card' | 'list'
  onEditTags: () => void
  onSelectOutfit?: (item: WardrobeOutfit) => void
}

interface MenuState {
  x: number
  y: number
}

export const FileItem = memo(function FileItem({ item, tagNames, viewMode, onEditTags, onSelectOutfit }: FileItemProps) {
  const { t } = useTranslation()
  const dialog = useDialog()
  const isPreviewLocked = useFsSelector((fs) => fs.lockedItem?.id === item.id)
  const isCloudSyncEnabled = useFsSelector(() => item.cloudSync !== false)
  const isLocalFork = !!item.vpwLocalFork && !isCloudSyncEnabled
  const localForkHintId = useId()
  const localForkHint = t('library.localForkHint')
  const thumbnailRefresh = useFsSelector(() => item.__thumbRefresh)
  const [menu, setMenu] = useState<MenuState | null>(null)
  void thumbnailRefresh

  const closeMenu = () => setMenu(null)
  const reportError = (error: unknown) => dialog.alert(t('library.operationFailed', {
    error: error instanceof Error ? error.message : String(error),
  }))

  const openContextMenu = (event: MouseEvent, fromButton = false) => {
    event.preventDefault()
    event.stopPropagation()
    const padding = 8
    const vw = hostWindow.innerWidth || 1024
    const vh = hostWindow.innerHeight || 768
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Math.min(fromButton ? bounds.left : event.clientX, vw - 196 - padding)
    const y = Math.min(fromButton ? bounds.bottom : event.clientY, vh - 256 - padding)
    setMenu({ x: Math.max(padding, x), y: Math.max(padding, y) })
  }

  const handleClick = () => {
    getFs().selectOutfit(item)
    onSelectOutfit?.(item)
  }

  const renameItem = async () => {
    closeMenu()
    const name = (await dialog.prompt(t('fileItem.promptNewName'), item.name))?.trim()
    if (!name || name === item.name) return
    try {
      if (!getFs().updateOutfit(item.id, { name })) await dialog.alert(t('library.itemUnavailable'))
    } catch (error) { await reportError(error) }
  }

  const deleteItem = async () => {
    closeMenu()
    if (!await dialog.confirm(t('library.deleteOutfitConfirm', { name: item.name }))) return
    try {
      if (!getFs().removeOutfit(item.id)) await dialog.alert(t('library.itemUnavailable'))
    } catch (error) { await reportError(error) }
  }

  const exportBcx = async () => {
    closeMenu()
    try {
      ExternalAdapter.exportOutfitAsBCX(item.name, item.data)
      await dialog.alert(t('wardrobeIO.bcxCopied'))
    } catch (error) { await reportError(error) }
  }

  const toggleCloudSync = async (event: MouseEvent) => {
    event.stopPropagation()
    try {
      if (!getFs().setOutfitCloudSync(item.id, !isCloudSyncEnabled)) await dialog.alert(t('library.itemUnavailable'))
    } catch (error) { await reportError(error) }
  }

  const isList = viewMode === 'list'
  return (
    <>
      <Paper withBorder radius="md" className="vpw-outfit-card" data-view={viewMode} data-selected={isPreviewLocked || undefined}
        onContextMenu={(event) => openContextMenu(event)}>
        <UnstyledButton className="vpw-outfit-select" data-outfit-id={item.id} onClick={handleClick}
          aria-label={t('library.previewOutfit', { name: item.name })} aria-pressed={isPreviewLocked}
          aria-describedby={isLocalFork ? localForkHintId : undefined}>
        {!isList && (
          <Box className="vpw-outfit-thumbnail">
            <Box style={{ position: 'absolute', inset: 0 }}><FileThumbnail item={item} /></Box>
            {isPreviewLocked && <Badge size="sm" variant="filled" color="teal" className="vpw-outfit-selected-badge">
              {t('library.selected', { defaultValue: 'Selected' })}
            </Badge>}
          </Box>
        )}
        <Box className="vpw-outfit-caption">
          <Group gap={6} wrap="nowrap" align="start">
            <Text size="sm" fw={600} className="vpw-outfit-name">{item.name}</Text>
            {isList && isPreviewLocked && <Badge size="xs" variant="light" color="teal" style={{ flexShrink: 0 }}>
              {t('library.selected', { defaultValue: '已选择' })}
            </Badge>}
          </Group>
          {isLocalFork && <>
            <Badge size="xs" variant="light" color="orange" mt={5} title={localForkHint} style={{ maxWidth: '100%' }}>
              {t('library.localFork')}
            </Badge>
            <VisuallyHidden id={localForkHintId}>{localForkHint}</VisuallyHidden>
          </>}
          {tagNames.length > 0 ? <Group gap={4} mt={5} aria-label={t('library.tags')}>
            {tagNames.map((name) => <Text component="span" key={name} className="vpw-outfit-tag">{name}</Text>)}
          </Group> : <Text size="xs" c="dimmed" mt={4}>{t('library.untagged')}</Text>}
        </Box>
        </UnstyledButton>
          <Group className="vpw-outfit-actions" justify="space-between" gap={4} wrap="nowrap">
            <UnstyledButton onClick={(event) => void toggleCloudSync(event)} onDoubleClick={(event) => event.stopPropagation()}
              title={t('library.cloudToggleTitle')} aria-pressed={isCloudSyncEnabled}
              style={{ fontSize: 11, lineHeight: 1.2, padding: '7px 6px', borderRadius: 6,
                border: '1px solid var(--vpw-color-default-border)',
                color: isCloudSyncEnabled ? 'var(--vpw-color-teal-6)' : 'var(--vpw-color-dimmed)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t(isCloudSyncEnabled ? 'library.cloudIncluded' : 'library.localOnly')}
            </UnstyledButton>
            <ActionIcon variant="subtle" size="md" onClick={(event) => openContextMenu(event, true)}
              onDoubleClick={(event) => event.stopPropagation()} aria-label={t('library.outfitActions', { name: item.name })} title={t('library.moreActions')}>
              ⋯
            </ActionIcon>
          </Group>
      </Paper>
      {menu && <Portal><ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}
        onRename={() => void renameItem()} onDelete={() => void deleteItem()}
        onExport={() => void exportBcx()} onEditTags={() => { closeMenu(); onEditTags() }} /></Portal>}
    </>
  )
})

interface ContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onRename: () => void
  onDelete: () => void
  onExport: () => void
  onEditTags: () => void
}

function ContextMenu(props: ContextMenuProps) {
  const { t } = useTranslation()
  const items = [
    { key: 'tags', label: t('library.editTags'), action: props.onEditTags },
    { key: 'rename', label: t('fileItem.rename'), action: props.onRename },
    { key: 'export', label: t('fileItem.exportBCX'), action: props.onExport },
    { key: 'delete', label: t('fileItem.delete'), action: props.onDelete, color: 'red' },
    { key: 'cancel', label: t('fileItem.cancel'), action: props.onClose, color: 'gray' },
  ]
  return (
    <>
      <Box onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); props.onClose() }}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); props.onClose() }}
        style={{ position: 'fixed', inset: 0, zIndex: OVERLAY_Z_INDEX }} />
      <FocusTrap><Paper withBorder shadow="md" radius="md" role="menu"
        onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => { if (event.key === 'Escape') props.onClose() }}
        style={{ position: 'fixed', left: props.x, top: props.y, zIndex: OVERLAY_Z_INDEX + 1, minWidth: 188, padding: 6 }}>
        {items.map((item) => <Button key={item.key} role="menuitem" variant="subtle" color={item.color} size="sm"
          fullWidth justify="flex-start" radius="sm" onClick={item.action}
          styles={{ root: { height: 34, paddingInline: 10 }, label: { fontWeight: 500 } }}>
          {item.label}
        </Button>)}
      </Paper></FocusTrap>
    </>
  )
}
