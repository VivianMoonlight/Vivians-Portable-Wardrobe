import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import { ActionIcon, Box, Button, Group, Paper, Portal, Stack, Text, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { hostWindow } from '@/utils/host-window.js'
import { ExternalAdapter } from '@/utils/external_adapters.js'
import { getFs, useFsSelector, type FileNode } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { OVERLAY_Z_INDEX } from '@/ui/z-index'
import { FileThumbnail } from './FileThumbnail'

type TimeFilter = 'all' | 'today' | 'week'

interface HistoryRecord extends FileNode {
  name: string
  data?: unknown[]
}

interface MenuState {
  visible: boolean
  x: number
  y: number
  record: HistoryRecord | null
}

function formatTimestamp(recordName: string): string {
  const match = recordName.match(/Record_(.+)/)
  if (!match) return recordName
  const date = new Date(match[1])
  if (Number.isNaN(date.getTime())) return recordName
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  let h = date.getHours()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${y}-${mo}-${d} ${h}:${min} ${ampm}`
}

function canUseHover(): boolean {
  return !!(hostWindow.matchMedia && hostWindow.matchMedia('(hover: hover) and (pointer: fine)').matches)
}

export function HistoryViewer() {
  const { t } = useTranslation()
  const dialog = useDialog()
  const historyVersion = useFsSelector((fs) => fs.historyVersion)
  const [records, setRecords] = useState<HistoryRecord[]>(() => getFs().getHistoryRecords() as HistoryRecord[])
  const [searchQuery, setSearchQuery] = useState('')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [menu, setMenu] = useState<MenuState>({ visible: false, x: 0, y: 0, record: null })

  const refresh = () => setRecords(getFs().getHistoryRecords() as HistoryRecord[])

  useEffect(() => {
    refresh()
  }, [historyVersion])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const now = Date.now()
    return records.filter((record) => {
      const ts = record?.name || ''
      if (q && !ts.toLowerCase().includes(q)) return false
      if (timeFilter === 'all') return true
      const match = ts.match(/Record_(.+)/)
      if (!match) return false
      const recordTime = new Date(match[1]).getTime()
      if (Number.isNaN(recordTime)) return false
      if (timeFilter === 'today') return now - recordTime <= 24 * 60 * 60 * 1000
      return now - recordTime <= 7 * 24 * 60 * 60 * 1000
    })
  }, [records, searchQuery, timeFilter])

  const applyRecord = (record: HistoryRecord) => {
    if (!Array.isArray(record?.data) || record.data.length === 0) return
    const target = getFs().character || (hostWindow as any).CurrentCharacter || (hostWindow as any).Player
    if (!target) return
    try {
      ExternalAdapter.applyOutfitToCharacter(target, record.data)
    } catch (e) {
      console.error('apply history record failed', e)
    }
  }

  const onRecordClick = (record: HistoryRecord) => {
    const fs = getFs()
    fs.setActiveItem(record)
    fs.loadHistoryRecord(record)
  }

  const onRecordEnter = (record: HistoryRecord) => {
    if (canUseHover()) getFs().setActiveItem(record)
  }
  const onRecordLeave = () => {
    if (canUseHover()) getFs().setActiveItem(-1)
  }

  const openMenu = (event: MouseEvent, record: HistoryRecord) => {
    event.preventDefault()
    const padding = 8
    const vw = hostWindow.innerWidth || 1024
    const vh = hostWindow.innerHeight || 768
    setMenu({
      visible: true,
      x: Math.max(padding, Math.min(event.clientX, vw - 180 - padding)),
      y: Math.max(padding, Math.min(event.clientY, vh - 160 - padding)),
      record,
    })
  }
  const closeMenu = () => setMenu((m) => ({ ...m, visible: false, record: null }))

  const deleteRecord = async (record: HistoryRecord) => {
    closeMenu()
    if (await dialog.confirm(t('historyViewer.deleteConfirm'))) {
      getFs().deleteHistoryRecord(record)
      refresh()
    }
  }

  const clearAll = async () => {
    if (await dialog.confirm(t('historyViewer.clearAllConfirm'))) {
      getFs().clearHistory()
      refresh()
    }
  }

  return (
    <Stack gap="sm" h="100%" style={{ minHeight: 0 }}>
      <Group justify="space-between">
        <Text fw={600}>
          {t('historyViewer.title')}{' '}
          {records.length > 0 && (
            <Text span c="dimmed" size="sm">
              ({filtered.length})
            </Text>
          )}
        </Text>
        {records.length > 0 && (
          <Button variant="subtle" color="red" size="xs" onClick={clearAll}>
            🗑 {t('historyViewer.clearAll')}
          </Button>
        )}
      </Group>

      <Group gap="sm" wrap="nowrap">
        <TextInput
          flex={1}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          placeholder={t('historyViewer.searchPlaceholder')}
          rightSection={
            searchQuery ? (
              <ActionIcon variant="subtle" onClick={() => setSearchQuery('')}>
                ✕
              </ActionIcon>
            ) : null
          }
        />
        <Button.Group>
          {(['all', 'today', 'week'] as const).map((f) => (
            <Button
              key={f}
              size="xs"
              variant={timeFilter === f ? 'filled' : 'default'}
              onClick={() => setTimeFilter(f)}
            >
              {t(`historyViewer.filter${f.charAt(0).toUpperCase() + f.slice(1)}`)}
            </Button>
          ))}
        </Button.Group>
      </Group>

      <Box
        style={{
          flex: 1,
          minHeight: 200,
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(136px, 160px))',
          alignItems: 'start',
          gap: 12,
          padding: 4,
        }}
      >
        {filtered.length > 0 ? (
          filtered.map((record, idx) => (
            <Paper
              key={`${record.name}-${idx}`}
              withBorder
              radius="sm"
              shadow="xs"
              style={historyCardStyle}
              tabIndex={0}
              onClick={() => onRecordClick(record)}
              onDoubleClick={() => applyRecord(record)}
              onContextMenu={(e) => openMenu(e, record)}
              onMouseEnter={() => onRecordEnter(record)}
              onMouseLeave={onRecordLeave}
            >
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
                  <FileThumbnail item={record} />
                </Box>
              </Box>
              <Text size="xs" ta="center" truncate w="100%">
                {formatTimestamp(record.name)}
              </Text>
            </Paper>
          ))
        ) : (
          <Text c="dimmed" ta="center" py="xl" style={{ gridColumn: '1 / -1' }}>
            {t('historyViewer.emptyState')}
          </Text>
        )}
      </Box>

      {menu.visible && menu.record && (
        <Portal>
          <Box onClick={closeMenu} style={{ position: 'fixed', inset: 0, zIndex: OVERLAY_Z_INDEX }} />
          <Paper
            withBorder
            shadow="md"
            radius="sm"
            style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: OVERLAY_Z_INDEX + 1, minWidth: 150, padding: 4 }}
          >
            {[
              { key: 'apply', label: t('historyViewer.apply'), action: () => { closeMenu(); menu.record && applyRecord(menu.record) } },
              { key: 'load', label: t('historyViewer.loadToPreview'), action: () => { const r = menu.record; closeMenu(); r && onRecordClick(r) } },
              { key: 'delete', label: t('historyViewer.delete'), action: () => menu.record && deleteRecord(menu.record) },
            ].map((it) => (
              <Button key={it.key} variant="subtle" fullWidth justify="flex-start" size="xs" onClick={it.action}>
                {it.label}
              </Button>
            ))}
          </Paper>
        </Portal>
      )}
    </Stack>
  )
}

const historyCardStyle: CSSProperties = {
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 6,
  padding: 6,
  width: '100%',
  overflow: 'hidden',
}
