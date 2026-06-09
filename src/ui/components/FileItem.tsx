import { memo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import { Box, Button, Paper, Portal, Text, UnstyledButton } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { hostWindow } from '@/utils/host-window.js'
import { ExternalAdapter } from '@/utils/external_adapters.js'
import { getFs, useFsSelector, type FileNode } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { OVERLAY_Z_INDEX } from '@/ui/z-index'
import { FileThumbnail } from './FileThumbnail'

interface FileItemProps {
  item: FileNode
  viewMode: 'large' | 'small' | 'list'
  onOpenFolder: () => void
  onRemove: () => void
  onRename: (newName: string) => void
}

interface MenuState {
  visible: boolean
  x: number
  y: number
}

function canUseHover(): boolean {
  return !!(hostWindow.matchMedia && hostWindow.matchMedia('(hover: hover) and (pointer: fine)').matches)
}

export const FileItem = memo(function FileItem({ item, viewMode, onOpenFolder, onRemove, onRename }: FileItemProps) {
  const { t } = useTranslation()
  const dialog = useDialog()
  const isPreviewLocked = useFsSelector((fs) => fs.lockedItem === item)
  const isCloudSyncEnabled = useFsSelector(() => item.cloudSync !== false)
  const thumbnailRefresh = useFsSelector(() => item.__thumbRefresh)
  const rootRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<MenuState>({ visible: false, x: 0, y: 0 })
  void thumbnailRefresh

  const isFolder = item.type === 'folder'

  const closeMenu = () => setMenu((m) => ({ ...m, visible: false }))

  const openContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    const padding = 8
    const vw = hostWindow.innerWidth || 1024
    const vh = hostWindow.innerHeight || 768
    const x = Math.min(event.clientX, vw - 180 - padding)
    const y = Math.min(event.clientY, vh - 220 - padding)
    setMenu({ visible: true, x: Math.max(padding, x), y: Math.max(padding, y) })
  }

  // ---- interactions ----
  const handleClick = () => {
    if (isFolder) {
      onOpenFolder()
      return
    }
    getFs().togglePreviewLock(item)
  }

  const applyToCharacter = () => {
    closeMenu()
    const data = item.data
    if (!Array.isArray(data) || data.length === 0) return
    try {
      getFs().applyFilteredOutfitToCharacter({ outfitData: data })
    } catch (e) {
      console.error('apply outfit failed', e)
    }
  }

  const handleDoubleClick = () => {
    if (isFolder) {
      onOpenFolder()
      return
    }
    applyToCharacter()
  }

  const handleMouseEnter = () => {
    const fs = getFs()
    if (fs.lockedItem || !canUseHover()) return
    fs.setActiveItem(item)
  }
  const handleMouseLeave = () => {
    const fs = getFs()
    if (fs.lockedItem || !canUseHover()) return
    fs.setActiveItem(-1)
  }

  const renameItem = async () => {
    closeMenu()
    const next = await dialog.prompt(t('fileItem.promptNewName'), item.name)
    if (next === null) return
    const trimmed = next.trim()
    if (trimmed) onRename(trimmed)
  }

  const deleteItem = async () => {
    closeMenu()
    const ok = await dialog.confirm(t('fileItem.confirmDelete'))
    if (ok) onRemove()
  }

  const exportBcx = async () => {
    closeMenu()
    if (isFolder) return
    try {
      // Returns the BCX code and copies it to the clipboard.
      ExternalAdapter.exportOutfitAsBCX(item.name, Array.isArray(item.data) ? item.data : [])
      await dialog.alert(t('wardrobeIO.bcxCopied'))
    } catch (e) {
      console.error('exportBCX failed', e)
    }
  }

  const toggleCloudSync = (event: MouseEvent) => {
    event.stopPropagation()
    getFs().setNodeCloudSync(item, !isCloudSyncEnabled, { recursive: isFolder })
  }

  // ---- drag & drop (move into folders / breadcrumb) ----
  const onDragStart = (event: DragEvent) => {
    const payload = { name: item.name, fromPath: getFs().currentPath, type: item.type || 'file' }
    try {
      event.dataTransfer.setData('application/json', JSON.stringify(payload))
    } catch {
      event.dataTransfer.setData('text/plain', JSON.stringify(payload))
    }
    event.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (event: DragEvent) => {
    if (!isFolder) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }
  const onDrop = (event: DragEvent) => {
    if (!isFolder) return
    event.preventDefault()
    let payload: { name?: string; fromPath?: string[] } | null = null
    try {
      payload = JSON.parse(
        event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain'),
      )
    } catch {
      return
    }
    if (!payload?.name) return
    const store = getFs()
    const targetPath = [...store.currentPath, item.name]
    store.moveFile(payload.name, payload.fromPath ?? store.currentPath, targetPath)
  }

  const isList = viewMode === 'list'
  const isSmall = viewMode === 'small'
  const isCard = !isList
  // Card height is content-driven (thumbnail aspect-ratio + name). Do NOT put
  // aspect-ratio on the card itself: as a direct grid item it doesn't reliably
  // contribute to `auto` row sizing and the cards end up overlapping.
  const cardStyle: CSSProperties = {
    display: 'flex',
    flexDirection: isList ? 'row' : 'column',
    alignItems: isList ? 'center' : 'stretch',
    gap: isList ? 10 : 6,
    padding: isList ? '8px 10px' : 6,
    cursor: 'pointer',
    borderColor: isPreviewLocked ? 'var(--mantine-color-teal-5)' : undefined,
    minHeight: isList ? 64 : undefined,
    width: isCard ? '100%' : undefined,
    overflow: 'hidden',
  }
  const thumbSize = isList ? 44 : undefined

  const thumbInner = isFolder ? (
    <Text size="xl" aria-hidden>
      📁
    </Text>
  ) : (
    <FileThumbnail item={item} />
  )

  return (
    <>
      <Paper
      ref={rootRef}
      withBorder
      radius="md"
      shadow="xs"
      style={cardStyle}
      tabIndex={0}
      draggable
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={openContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {isList ? (
        <Box
          style={{
            width: thumbSize,
            aspectRatio: '9 / 16',
            flex: '0 0 auto',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--mantine-color-default-hover)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {thumbInner}
        </Box>
      ) : (
        // Card mode: percentage padding-top reserves a 9:16 box. Unlike CSS
        // `aspect-ratio`, this contributes a reliable height during CSS Grid
        // auto-row sizing, so cards never overlap their neighbours.
        <Box
          style={{
            position: 'relative',
            width: '100%',
            paddingTop: '177.78%',
            flex: '0 0 auto',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--mantine-color-default-hover)',
          }}
        >
          <Box
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {thumbInner}
          </Box>
        </Box>
      )}

      <Box
        style={{
          display: 'flex',
          flexDirection: isList ? 'row' : 'column',
          alignItems: isList ? 'center' : 'stretch',
          gap: isList ? 8 : 3,
          flex: isList ? 1 : '0 0 auto',
          minWidth: 0,
          width: '100%',
          paddingTop: isList ? 0 : 5,
          textAlign: isList ? 'left' : 'center',
        }}
      >
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text
            size={isSmall ? 'xs' : 'sm'}
            fw={500}
            truncate
            title={item.name}
            style={{ display: 'block', maxWidth: '100%' }}
          >
            {item.name}
          </Text>
        </Box>

        <UnstyledButton
          onClick={toggleCloudSync}
          title={isFolder ? t('fileItem.cloudToggleFolderTitle') : t('fileItem.cloudToggleFileTitle')}
          style={{
            alignSelf: isList ? 'auto' : 'center',
            fontSize: isSmall ? 10 : 11,
            lineHeight: 1.1,
            padding: isSmall ? '2px 5px' : '3px 8px',
            borderRadius: 6,
            border: '1px solid var(--mantine-color-default-border)',
            color: isCloudSyncEnabled ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-dimmed)',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {isCloudSyncEnabled ? t('fileItem.cloudOn') : t('fileItem.cloudOff')}
        </UnstyledButton>
      </Box>

      </Paper>
      {menu.visible && (
        <Portal>
          <ContextMenu
            x={menu.x}
            y={menu.y}
            isFolder={isFolder}
            onClose={closeMenu}
            onOpen={() => {
              closeMenu()
              if (isFolder) onOpenFolder()
            }}
            onRename={renameItem}
            onDelete={deleteItem}
            onApply={applyToCharacter}
            onExport={exportBcx}
          />
        </Portal>
      )}
    </>
  )
}, (prev, next) => prev.item === next.item && prev.viewMode === next.viewMode)

interface ContextMenuProps {
  x: number
  y: number
  isFolder: boolean
  onClose: () => void
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
  onApply: () => void
  onExport: () => void
}

function ContextMenu(props: ContextMenuProps) {
  const { t } = useTranslation()
  const items: Array<{ key: string; label: string; action: () => void; kind?: 'danger' | 'muted' }> = []
  if (props.isFolder) items.push({ key: 'open', label: t('fileItem.open'), action: props.onOpen })
  items.push({ key: 'rename', label: t('fileItem.rename'), action: props.onRename })
  if (!props.isFolder) {
    items.push({ key: 'apply', label: t('fileItem.apply'), action: props.onApply })
    items.push({ key: 'export', label: t('fileItem.exportBCX'), action: props.onExport })
  }
  items.push({ key: 'delete', label: t('fileItem.delete'), action: props.onDelete, kind: 'danger' })
  items.push({ key: 'cancel', label: t('fileItem.cancel'), action: props.onClose, kind: 'muted' })

  return (
    <>
      {/* Backdrop to dismiss on outside click (stops the click from reaching the card) */}
      <Box
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          props.onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          props.onClose()
        }}
        style={{ position: 'fixed', inset: 0, zIndex: OVERLAY_Z_INDEX }}
      />
      <Paper
        withBorder
        shadow="md"
        radius="md"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'fixed',
          left: props.x,
          top: props.y,
          zIndex: OVERLAY_Z_INDEX + 1,
          minWidth: 188,
          padding: 6,
          overflow: 'hidden',
        }}
      >
        {items.map((it) => (
          <Button
            key={it.key}
            variant="subtle"
            color={it.kind === 'danger' ? 'red' : it.kind === 'muted' ? 'gray' : undefined}
            size="sm"
            fullWidth
            justify="flex-start"
            radius="sm"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              it.action()
            }}
            styles={{ root: { height: 34, paddingInline: 10 }, label: { fontWeight: 500 } }}
          >
            {it.label}
          </Button>
        ))}
      </Paper>
    </>
  )
}
