import { useMemo, useState, type CSSProperties } from 'react'
import { ActionIcon, Box, Breadcrumbs, Button, Group, Menu, Stack, Text, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { getFs, getWb, useFsSelector, useWbSelector, type FileNode, type SearchHit } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { useWardrobeActions } from '@/ui/wardrobe-actions'
import { OVERLAY_Z_INDEX } from '@/ui/z-index'
import { FileItem } from './FileItem'

export function FileManager() {
  const { t } = useTranslation()
  const dialog = useDialog()
  const actions = useWardrobeActions()
  const currentPath = useFsSelector((fs) => fs.currentPath)
  const fileTreeVersion = useFsSelector((fs) => fs.fileTreeVersion)
  const thumbnailRefreshVersion = useFsSelector((fs) => fs.thumbnailRefreshVersion)
  const searchScope = useWbSelector((wb) => wb.wardrobeUi.searchScope || 'current')
  const fileViewMode = useWbSelector((wb) => wb.wardrobeUi.fileViewMode || 'large')
  const [searchQuery, setSearchQuery] = useState('')

  const items: FileNode[] = useMemo(() => {
    return getFs().fs.getNode(currentPath)?.children ?? []
  }, [currentPath, fileTreeVersion])

  const displayList: SearchHit[] = useMemo(() => {
    const q = searchQuery.trim()
    const ql = q.toLowerCase()
    let base: SearchHit[]
    if (!q) {
      base = items.map((it) => ({ item: it, path: currentPath }))
    } else if (searchScope === 'current') {
      base = items
        .filter((it) => (it.name || '').toLowerCase().includes(ql))
        .map((it) => ({ item: it, path: currentPath }))
    } else {
      try {
        base = getFs().searchFiles(q)
      } catch {
        base = []
      }
    }

    return [...base].reverse()
  }, [currentPath, fileTreeVersion, items, searchQuery, searchScope, thumbnailRefreshVersion])

  const addFolder = async () => {
    const name = await dialog.prompt(t('fileManager.promptNewFolderName'))
    if (name) getFs().addFile({ name, type: 'folder', children: [] })
  }

  const gridStyle: CSSProperties =
    fileViewMode === 'list'
      ? { display: 'flex', flexDirection: 'column', gap: 10 }
      : {
          display: 'grid',
          gridTemplateColumns:
            fileViewMode === 'small'
              ? 'repeat(auto-fill, minmax(112px, 128px))'
              : 'repeat(auto-fill, minmax(160px, 180px))',
          gridAutoRows: 'max-content',
          alignItems: 'start',
          gap: fileViewMode === 'small' ? 8 : 12,
        }

  return (
    <Stack gap="sm" h="100%" style={{ minHeight: 0 }}>
      <Breadcrumbs separator="›">
        {currentPath.map((seg, idx) => (
          <Text
            key={`${seg}-${idx}`}
            size="sm"
            c={idx === currentPath.length - 1 ? undefined : 'blue'}
            fw={idx === currentPath.length - 1 ? 600 : 400}
            style={{ cursor: idx === currentPath.length - 1 ? 'default' : 'pointer' }}
            onClick={() => getFs().moveTo(currentPath.slice(0, idx + 1))}
          >
            {seg}
          </Text>
        ))}
      </Breadcrumbs>

      <Group gap="sm" wrap="nowrap">
        <TextInput
          flex={1}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          placeholder={
            searchScope === 'current'
              ? t('fileManager.searchPlaceholderCurrent')
              : t('fileManager.searchPlaceholderAll')
          }
          rightSection={
            searchQuery ? (
              <ActionIcon variant="subtle" onClick={() => setSearchQuery('')} aria-label={t('fileManager.clearSearch')}>
                ✕
              </ActionIcon>
            ) : null
          }
        />
        <ActionIcon
          variant="default"
          size="lg"
          title={
            searchScope === 'current'
              ? t('fileManager.switchToGlobalSearch')
              : t('fileManager.switchToCurrentSearch')
          }
          onClick={() => getWb().setWardrobeUi({ searchScope: searchScope === 'current' ? 'all' : 'current' })}
        >
          {searchScope === 'current' ? '🔍' : '🌐'}
        </ActionIcon>
      </Group>

      <Group justify="space-between" wrap="nowrap">
        <Button
          variant="subtle"
          size="xs"
          onClick={() => getFs().refreshThumbnails(displayList.map((entry) => entry.item))}
        >
          {t('fileManager.refreshThumbnails')}
        </Button>
        <Group gap="xs" wrap="nowrap">
          <Button.Group>
            {(['large', 'small', 'list'] as const).map((mode) => (
              <Button
                key={mode}
                size="xs"
                variant={fileViewMode === mode ? 'filled' : 'default'}
                onClick={() => getWb().setWardrobeUi({ fileViewMode: mode })}
                title={
                  mode === 'large'
                    ? t('fileManager.viewLarge')
                    : mode === 'small'
                      ? t('fileManager.viewSmall')
                      : t('fileManager.viewList')
                }
              >
                {mode === 'large' ? '▦' : mode === 'small' ? '▢' : '☰'}
              </Button>
            ))}
          </Button.Group>
          <Button variant="default" size="xs" onClick={addFolder}>
            {t('fileManager.newFolderTitle')}
          </Button>
          <Menu position="bottom-end" withinPortal shadow="md" width={240} zIndex={OVERLAY_Z_INDEX}>
            <Menu.Target>
              <Button variant="default" size="xs">
                {t('wardrobeIO.menuLabel')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t('fileManagerPanel.tabWardrobe')}</Menu.Label>
              <Menu.Item onClick={() => void actions.importPlayerWardrobe()}>
                {t('fileManagerPanel.importPlayerWardrobe')}
              </Menu.Item>
              <Menu.Item onClick={() => void actions.importBCX()}>
                {t('fileManagerPanel.importBCX')}
              </Menu.Item>
              <Menu.Item onClick={() => void actions.saveCharacterToFolder()}>
                {t('fileManagerPanel.saveCharacter')}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={actions.saveBackup}>{t('fileManagerPanel.saveBackup')}</Menu.Item>
              <Menu.Item onClick={actions.importBackup}>{t('fileManagerPanel.importBackup')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <Box style={{ overflowY: 'auto', flex: 1, minHeight: 200, padding: 4 }}>
        <Box style={gridStyle}>
          {displayList.length > 0 ? (
            displayList.map((entry) => (
              <FileItem
                key={`${entry.path.join('/')}/${entry.item.name}`}
                item={entry.item}
                viewMode={fileViewMode}
                onOpenFolder={() => {
                  if (entry.item.type === 'folder') getFs().moveTo([...entry.path, entry.item.name])
                }}
                onRemove={() => getFs().removeFile(entry.item, entry.path)}
                onRename={(newName) => {
                  entry.item.name = newName
                  getFs().saveAll()
                }}
              />
            ))
          ) : (
            <Stack align="center" py="xl" style={{ gridColumn: '1 / -1' }}>
              <Text c="dimmed">{t('fileManager.emptyTip')}</Text>
              {searchQuery ? (
                <Button variant="light" size="xs" onClick={() => setSearchQuery('')}>
                  {t('fileManager.clearSearch')}
                </Button>
              ) : (
                <Button variant="light" size="xs" onClick={addFolder}>
                  {t('fileManager.newFolderTitle')}
                </Button>
              )}
            </Stack>
          )}
        </Box>
      </Box>
    </Stack>
  )
}
