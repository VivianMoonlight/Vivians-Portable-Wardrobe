import { useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import { Box, Paper, Portal, Text, UnstyledButton } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { hostWindow } from '@/utils/host-window.js'
import { ExternalAdapter } from '@/utils/external_adapters.js'
import { getFs, useFs, type FileNode } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
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

export function FileItem({ item, viewMode, onOpenFolder, onRemove, onRename }: FileItemProps) {
  const { t } = useTranslation()
  const dialog = useDialog()
  const fs = useFs()
  const rootRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<MenuState>({ visible: false, x: 0, y: 0 })

  const isFolder = item.type === 'folder'
  // Read state directly (do NOT call the read-only `isPreviewLockedOn` action
  // during render).
  const isPreviewLocked = fs.lockedItem === item
  const isCloudSyncEnabled = item.cloudSync !== false

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
    fs.togglePreviewLock(item)
  }

  const applyToCharacter = () => {
    closeMenu()
    const data = item.data
    if (!Array.isArray(data) || data.length === 0) return
    try {
      fs.applyFilteredOutfitToCharacter({ outfitData: data })
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
    if (fs.lockedItem || !canUseHover()) return
    fs.setActiveItem(item)
  }
  const handleMouseLeave = () => {
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

  const exportBcx = () => {
    closeMenu()
    if (isFolder) return
    try {
      ExternalAdapter.exportOutfitAsBCX(item.name, Array.isArray(item.data) ? item.data : [])
    } catch (e) {
      console.error('exportBCX failed', e)
    }
  }

  const toggleCloudSync = (event: MouseEvent) => {
    event.stopPropagation()
    fs.setNodeCloudSync(item, !isCloudSyncEnabled, { recursive: isFolder })
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
    fs.moveFile(payload.name, payload.fromPath ?? store.currentPath, targetPath)
  }

  const isList = viewMode === 'list'
  const isSmall = viewMode === 'small'
  const isCard = !isList
  const cardStyle: CSSProperties = {
    display: 'flex',
    flexDirection: isList ? 'row' : 'column',
    alignItems: 'stretch',
    justifyContent: isList ? undefined : 'space-between',
    gap: isList ? 10 : 0,
    padding: isList ? '8px 10px' : 6,
    cursor: 'pointer',
    borderColor: isPreviewLocked ? 'var(--mantine-color-teal-5)' : undefined,
    minHeight: isList ? 64 : undefined,
    aspectRatio: isCard ? '9 / 13.5' : undefined,
    width: isCard ? '100%' : undefined,
    overflow: 'hidden',
  }
  const thumbSize = isList ? 44 : undefined

  return (
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
      <Box
        style={{
          width: isList ? thumbSize : '100%',
          height: isList ? undefined : '100%',
          aspectRatio: '9 / 16',
          flex: isList ? '0 0 auto' : '1 1 auto',
          minHeight: 0,
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--mantine-color-default-hover)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isFolder ? (
          <Text size="xl" aria-hidden>
            📁
          </Text>
        ) : (
          <FileThumbnail item={item} />
        )}
      </Box>

      <Box
        style={{
          display: 'flex',
          flexDirection: isList ? 'row' : 'column',
          alignItems: isList ? 'center' : 'stretch',
          gap: isList ? 8 : 3,
          flex: isList ? 1 : '0 0 38px',
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
    </Paper>
  )
}

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
  const items: Array<{ key: string; label: string; action: () => void }> = []
  if (props.isFolder) items.push({ key: 'open', label: t('fileItem.open'), action: props.onOpen })
  items.push({ key: 'rename', label: t('fileItem.rename'), action: props.onRename })
  items.push({ key: 'delete', label: t('fileItem.delete'), action: props.onDelete })
  if (!props.isFolder) {
    items.push({ key: 'apply', label: t('fileItem.apply'), action: props.onApply })
    items.push({ key: 'export', label: t('fileItem.exportBCX'), action: props.onExport })
  }
  items.push({ key: 'cancel', label: t('fileItem.cancel'), action: props.onClose })

  return (
    <>
      {/* Backdrop to dismiss on outside click */}
      <Box
        onClick={props.onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          props.onClose()
        }}
        style={{ position: 'fixed', inset: 0, zIndex: 100000 }}
      />
      <Paper
        withBorder
        shadow="md"
        radius="sm"
        style={{ position: 'fixed', left: props.x, top: props.y, zIndex: 100001, minWidth: 160, padding: 4 }}
      >
        {items.map((it) => (
          <UnstyledButton
            key={it.key}
            onClick={it.action}
            style={{ display: 'block', width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 13 }}
          >
            {it.label}
          </UnstyledButton>
        ))}
      </Paper>
    </>
  )
}
