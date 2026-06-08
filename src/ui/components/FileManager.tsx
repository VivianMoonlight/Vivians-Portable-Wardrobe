import { useMemo, useState, type CSSProperties } from 'react'
import { ActionIcon, Box, Breadcrumbs, Button, Group, Stack, Text, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useFs, useWb, type FileNode, type SearchHit } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { FileItem } from './FileItem'

export function FileManager() {
  const { t } = useTranslation()
  const dialog = useDialog()
  const fs = useFs()
  const wb = useWb()
  const [searchQuery, setSearchQuery] = useState('')

  const searchScope = wb.wardrobeUi.searchScope || 'current'
  const fileViewMode = wb.wardrobeUi.fileViewMode || 'large'

  const items: FileNode[] = fs.currentNode?.children ?? []
  const currentPath = fs.currentPath

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
        base = fs.searchFiles(q)
      } catch {
        base = []
      }
    }

    return [...base].reverse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, currentPath, searchQuery, searchScope])

  const addFolder = async () => {
    const name = await dialog.prompt(t('fileManager.promptNewFolderName'))
    if (name) fs.addFile({ name, type: 'folder', children: [] })
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
            onClick={() => fs.moveTo(currentPath.slice(0, idx + 1))}
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
          onClick={() => wb.setWardrobeUi({ searchScope: searchScope === 'current' ? 'all' : 'current' })}
        >
          {searchScope === 'current' ? '🔍' : '🌐'}
        </ActionIcon>
      </Group>

      <Group justify="space-between" wrap="nowrap">
        <Button
          variant="subtle"
          size="xs"
          onClick={() => fs.refreshThumbnails(displayList.map((entry) => entry.item))}
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
                onClick={() => wb.setWardrobeUi({ fileViewMode: mode })}
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
        </Group>
      </Group>

      <Box style={{ ...gridStyle, overflowY: 'auto', flex: 1, minHeight: 200, padding: 4 }}>
        {displayList.length > 0 ? (
          displayList.map((entry) => (
            <FileItem
              key={`${entry.path.join('/')}/${entry.item.name}`}
              item={entry.item}
              viewMode={fileViewMode}
              onOpenFolder={() => {
                if (entry.item.type === 'folder') fs.moveTo([...entry.path, entry.item.name])
              }}
              onRemove={() => fs.removeFile(entry.item, entry.path)}
              onRename={(newName) => {
                entry.item.name = newName
                fs.saveAll()
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
    </Stack>
  )
}
