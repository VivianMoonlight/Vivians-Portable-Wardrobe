import { Fragment, useEffect, useId, useMemo, useState } from 'react'
import { ActionIcon, Badge, Box, Button, Collapse, Drawer, Group, Menu, Modal, MultiSelect, Paper, Progress, Select, Stack, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { getFs, getWb, useFsSelector, useWbSelector, type WardrobeOutfit } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { useIsMobile } from '@/ui/hooks/useIsMobile'
import { useWardrobeActions } from '@/ui/wardrobe-actions'
import { OVERLAY_Z_INDEX } from '@/ui/z-index'
import { estimateLocalStorageUsage } from '@/services/local-storage-usage.js'
import { hostWindow } from '@/utils/host-window.js'
import { FileItem } from './FileItem'
import { SyncConflictReview } from './SyncConflictReview'
import libraryStyles from './wardrobe-library.css?inline'
import { cloudflareSyncErrorKey } from '@/ui/cloudflare-sync-error'
import { CLOUDFLARE_WARDROBE_LIMIT_BYTES, estimateCloudflareWardrobeBytes } from '@/ui/cloudflare-size.js'

function formatKB(bytes: number): string {
  return `${(Math.max(0, bytes) / 1000).toFixed(1)} kB`
}

function formatLocalStorageBytes(bytes: number): string {
  return bytes < 1000 ? `${bytes} B` : formatKB(bytes)
}

const LOCAL_STORAGE_CATEGORIES = [
  ['currentIndexBytes', 'library.localStorageCurrentIndex'],
  ['recoveryBytes', 'library.localStorageRecovery'],
  ['oldHistoryBytes', 'library.localStorageOldHistory'],
  ['legacyWardrobeBytes', 'library.localStorageLegacyWardrobe'],
  ['otherVpwBytes', 'library.localStorageOtherVpw'],
  ['otherAppsBytes', 'library.localStorageOtherApps'],
] as const

interface FileManagerProps {
  onSelectOutfit?: (item: WardrobeOutfit) => void
}

export function FileManager({ onSelectOutfit }: FileManagerProps) {
  const { t, i18n } = useTranslation()
  const dialog = useDialog()
  const isMobile = useIsMobile()
  const actions = useWardrobeActions()
  const wardrobeIndex = useFsSelector((fs) => fs.wardrobeIndex)
  const outfits = useFsSelector((fs) => fs.outfits)
  const tags = useFsSelector((fs) => fs.tags)
  const selectedTagId = useFsSelector((fs) => fs.selectedTagId)
  const quota = useFsSelector((fs) => fs.cloudQuota)
  const sync = useFsSelector((fs) => fs.syncStatus)
  const cloudflare = useFsSelector((fs) => fs.cloudflareSyncStatus)
  const cloudflareErrorKey = cloudflareSyncErrorKey(cloudflare.errorCode)
  const cloudflareBytes = useMemo(() => cloudflare.enabled
    ? estimateCloudflareWardrobeBytes(wardrobeIndex) : 0, [cloudflare.enabled, wardrobeIndex])
  const cloudflareUsage = cloudflareBytes / CLOUDFLARE_WARDROBE_LIMIT_BYTES
  const cloudflareSizeLabel = cloudflareBytes >= 1_000_000
    ? `${(cloudflareBytes / 1_000_000).toFixed(2)} MB` : formatLocalStorageBytes(cloudflareBytes)
  const fileViewMode = useWbSelector((wb) => wb.wardrobeUi.fileViewMode)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingOutfit, setEditingOutfit] = useState<WardrobeOutfit | null>(null)
  const [editingTagIds, setEditingTagIds] = useState<string[]>([])
  const [tagPickerOpened, setTagPickerOpened] = useState(false)
  const [filtersOpened, setFiltersOpened] = useState(false)
  const [filterTagPickerOpened, setFilterTagPickerOpened] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [cloudFilter, setCloudFilter] = useState<'all' | 'cloud' | 'local'>('all')
  const [quotaDetailsOpened, setQuotaDetailsOpened] = useState(false)
  const [localSaveDetailsOpened, setLocalSaveDetailsOpened] = useState(false)
  const localSaveDetailsId = useId()
  const [conflictReviewOpened, setConflictReviewOpened] = useState(false)
  const conflicts = sync.conflicts ?? []
  const cloudQuarantined = conflicts.some((conflict) => conflict.type === 'missing-device')
  const reviewingConflicts = conflictReviewOpened && conflicts.length > 0

  useEffect(() => {
    if (conflicts.length === 0) setConflictReviewOpened(false)
  }, [conflicts.length])

  const tagNames = useMemo(() => new Map(tags.flatMap((tag) =>
    [tag.id, ...tag.aliasIds].map((id) => [id, tag.name] as const))), [tags])
  const selectedTag = tags.find((tag) => tag.id === selectedTagId)
  const tagOptions = tags.map((tag) => ({ value: tag.id, label: tag.name }))
  const filterTags = tags.filter((tag) => tag.name.toLocaleLowerCase().includes(tagQuery.trim().toLocaleLowerCase()))
  const tagCounts = useMemo(() => new Map(tags.map((tag) => [tag.id,
    outfits.filter((outfit) => outfit.tagIds.some((id) => id === tag.id || tag.aliasIds.includes(id))).length,
  ])), [outfits, tags])
  const untaggedCount = outfits.filter((outfit) => !outfit.tagIds.some((id) => tagNames.has(id))).length
  const cloudCount = outfits.filter((outfit) => outfit.cloudSync !== false).length

  const displayList = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return outfits.filter((outfit) => {
      if (cloudFilter === 'cloud' && outfit.cloudSync === false) return false
      if (cloudFilter === 'local' && outfit.cloudSync !== false) return false
      const outfitTags = outfit.tagIds.filter((id) => tagNames.has(id))
      if (selectedTagId === 'untagged' && outfitTags.length > 0) return false
      if (selectedTag && !outfitTags.some((id) => id === selectedTag.id || selectedTag.aliasIds.includes(id))) return false
      return !query || [outfit.name, ...outfitTags.map((id) => tagNames.get(id))]
        .some((value) => value?.toLocaleLowerCase().includes(query))
    }).reverse()
  }, [outfits, tagNames, selectedTagId, selectedTag, searchQuery, cloudFilter])

  const reportError = (error: unknown) => dialog.alert(t('library.operationFailed', {
    error: error instanceof Error ? error.message : String(error),
  }))

  const createTag = async () => {
    const name = await dialog.prompt(t('library.newTagPrompt'))
    if (!name?.trim()) return
    try {
      const id = await getFs().createTag(name.trim())
      if (id) getFs().selectTag(id)
      else await dialog.alert(t('library.tagNameInvalid'))
    } catch (error) { await reportError(error) }
  }

  const renameTag = async () => {
    if (!selectedTag) return
    const name = await dialog.prompt(t('library.renameTagPrompt'), selectedTag.name)
    if (!name?.trim() || name.trim() === selectedTag.name) return
    try {
      if (!await getFs().renameTag(selectedTag.id, name.trim())) await dialog.alert(t('library.tagNameInvalid'))
    } catch (error) { await reportError(error) }
  }

  const deleteTag = async () => {
    if (!selectedTag || !await dialog.confirm(t('library.deleteTagConfirm', { name: selectedTag.name }))) return
    try {
      if (!await getFs().deleteTag(selectedTag.id)) await dialog.alert(t('library.itemUnavailable'))
    } catch (error) { await reportError(error) }
  }

  const editTags = (outfit: WardrobeOutfit) => {
    setTagPickerOpened(false)
    setEditingOutfit(outfit)
    setEditingTagIds(tags.filter((tag) => outfit.tagIds.some((id) => id === tag.id || tag.aliasIds.includes(id))).map((tag) => tag.id))
  }

  const saveTags = async () => {
    if (!editingOutfit) return
    try {
      const current = getFs().outfits.find((outfit) => outfit.id === editingOutfit.id)
      if (!current) {
        setEditingOutfit(null)
        await dialog.alert(t('library.itemUnavailable'))
        return
      }
      const currentTags = tags.filter((tag) => current.tagIds.some((id) => id === tag.id || tag.aliasIds.includes(id))).map((tag) => tag.id)
      if (currentTags.length === editingTagIds.length && currentTags.every((id) => editingTagIds.includes(id))) {
        setEditingOutfit(null)
        return
      }
      if (!await getFs().setOutfitTags(editingOutfit.id, editingTagIds)) {
        await dialog.alert(t('library.itemUnavailable'))
        return
      }
      setEditingOutfit(null)
    } catch (error) { await reportError(error) }
  }

  const retrySync = async () => {
    try { await getFs().syncNow() } catch (error) { await reportError(error) }
  }

  const retryCloudflareSync = async () => {
    try { await getFs().syncCloudflareNow() } catch (error) { await reportError(error) }
  }

  const localStorageQuotaError = sync.errorCode === 'local-storage-quota'
  const indexedDBSaveError = sync.errorCode === 'indexeddb-quota' || sync.errorCode === 'indexeddb-error'
  const localSaveError = localStorageQuotaError || indexedDBSaveError
  useEffect(() => {
    if (!localSaveError) setLocalSaveDetailsOpened(false)
  }, [localSaveError])
  const localStorageUsage = useMemo(() => {
    if (!localStorageQuotaError) return null
    try { return estimateLocalStorageUsage(hostWindow.localStorage) } catch { return null }
  }, [localStorageQuotaError, sync])
  const observedQuota = localSaveError && quota.observedSource !== 'login-response'
    ? undefined : quota.observed
  const observedColor = observedQuota?.isOverLimit ? 'red' : observedQuota?.isWarning ? 'orange' : 'teal'
  const proposedColor = quota.isOverLimit ? 'red' : quota.isWarning ? 'orange' : 'teal'
  const syncColor = ['submitted', 'verified'].includes(sync.state) ? 'teal' : sync.state === 'conflict' ? 'orange'
    : ['error', 'quota'].includes(sync.state) ? 'red' : 'gray'
  const activeFilterCount = Number(!!selectedTagId) + Number(cloudFilter !== 'all')
  const clearFilters = () => { setSearchQuery(''); getFs().selectTag(null); setCloudFilter('all') }
  const showQuotaDetails = quotaDetailsOpened || sync.state === 'quota' || (sync.state === 'error' && !localSaveError)

  const tagFilterButton = (id: string | null, label: string, count: number) => (
    <UnstyledButton key={id ?? 'all'} className="vpw-library-filter-option" aria-pressed={selectedTagId === id}
      onClick={() => getFs().selectTag(id)}>
      <Text component="span" size="sm" className="vpw-library-filter-name">{label}</Text>
      <Text component="span" size="xs" c="dimmed">{count}</Text>
    </UnstyledButton>
  )

  const filterList = (
    <Stack gap="md">
      <Stack gap={3} role="group" aria-label={t('library.browseLibrary', { defaultValue: 'Browse wardrobe' })}>
        <Text size="xs" fw={700} c="dimmed" mb={3}>{t('library.browseLibrary', { defaultValue: 'Browse wardrobe' })}</Text>
        {tagFilterButton(null, t('library.allOutfits'), outfits.length)}
        {tagFilterButton('untagged', t('library.untagged'), untaggedCount)}
      </Stack>
      <Stack gap={5} role="group" aria-label={t('library.tags')}>
        <Text size="xs" fw={700} c="dimmed">{t('library.tags')}</Text>
        <TextInput size="xs" value={tagQuery} onChange={(event) => setTagQuery(event.currentTarget.value)}
          placeholder={t('library.findTag', { defaultValue: 'Find a tag…' })}
          aria-label={t('library.findTag', { defaultValue: 'Find a tag…' })} />
        {filterTags.map((tag) => tagFilterButton(tag.id, tag.name, tagCounts.get(tag.id) ?? 0))}
        {filterTags.length === 0 && <Text size="xs" c="dimmed">{t('library.noTags')}</Text>}
      </Stack>
      <Stack gap={3} role="group" aria-label={t('library.storageFilter', { defaultValue: 'Cloud inclusion' })}>
        <Text size="xs" fw={700} c="dimmed" mb={3}>{t('library.storageFilter', { defaultValue: 'Cloud inclusion' })}</Text>
        {([
          { value: 'all', label: t('library.allOutfits'), count: outfits.length },
          { value: 'cloud', label: t('library.cloudIncluded'), count: cloudCount },
          { value: 'local', label: t('library.localOnly'), count: outfits.length - cloudCount },
        ] as const).map((option) => <UnstyledButton key={option.value} className="vpw-library-filter-option"
          aria-pressed={cloudFilter === option.value} onClick={() => setCloudFilter(option.value)}>
          <Text component="span" size="sm" className="vpw-library-filter-name">{option.label}</Text>
          <Text component="span" size="xs" c="dimmed">{option.count}</Text>
        </UnstyledButton>)}
      </Stack>
      {activeFilterCount > 0 && <Button variant="subtle" size="xs" onClick={clearFilters}>{t('library.clearFilters')}</Button>}
    </Stack>
  )

  if (isMobile && reviewingConflicts) return <Box className="vpw-library-root">
    <style>{libraryStyles}</style>
    <SyncConflictReview conflicts={conflicts} mobile onBack={() => setConflictReviewOpened(false)} />
  </Box>

  return (
    <Box className="vpw-library-root" data-local-storage-error={localSaveError || undefined}>
      <style>{libraryStyles}</style>
      <Group gap={8} wrap="nowrap" className="vpw-library-search">
        <TextInput style={{ flex: 1, minWidth: 0 }} value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder={t('library.searchPlaceholder')} aria-label={t('library.searchPlaceholder')}
          leftSection={<Text c="dimmed" aria-hidden>⌕</Text>}
          rightSection={searchQuery ? <ActionIcon variant="subtle" onClick={() => setSearchQuery('')} aria-label={t('fileManager.clearSearch')}>×</ActionIcon> : null} />
        <Button className="vpw-library-filter-trigger" variant={activeFilterCount ? 'light' : 'default'} onClick={() => setFiltersOpened(true)}
          rightSection={activeFilterCount ? <Badge size="xs" circle>{activeFilterCount}</Badge> : undefined}>
          {t('library.filters', { defaultValue: 'Filters' })}
        </Button>
      </Group>

      {cloudQuarantined && <Text size="xs" c="orange" role="status">{t('library.conflict.quarantined')}</Text>}

      <Group className="vpw-library-toolbar" justify="space-between" gap={6}>
        <Text size="xs" c="dimmed" role="status">{t('library.outfitCount', { count: displayList.length, total: outfits.length })}</Text>
        <Group gap={6}>
          <Button.Group>
            {(['card', 'list'] as const).map((mode) => (
              <Button key={mode} size="compact-xs" variant={fileViewMode === mode ? 'light' : 'default'}
                onClick={() => getWb().setWardrobeUi({ fileViewMode: mode })}
                title={t(mode === 'card' ? 'fileManager.viewCard' : 'fileManager.viewList', { defaultValue: mode === 'card' ? '卡牌' : '列表' })}
                aria-label={t(mode === 'card' ? 'fileManager.viewCard' : 'fileManager.viewList', { defaultValue: mode === 'card' ? '卡牌' : '列表' })} aria-pressed={fileViewMode === mode}>
                {t(mode === 'card' ? 'fileManager.viewCard' : 'fileManager.viewList', { defaultValue: mode === 'card' ? '卡牌' : '列表' })}
              </Button>
            ))}
          </Button.Group>
          <Menu position="bottom-end" withinPortal shadow="md" zIndex={OVERLAY_Z_INDEX}>
            <Menu.Target><Button variant="default" size="compact-xs">{t('library.manageTags')}</Button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => void createTag()}>{t('library.newTag')}</Menu.Item>
              <Menu.Item disabled={!selectedTag} onClick={() => void renameTag()}>{t('library.renameTag')}</Menu.Item>
              <Menu.Item disabled={!selectedTag} color="red" onClick={() => void deleteTag()}>{t('library.deleteTag')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Menu position="bottom-end" withinPortal shadow="md" width={240} zIndex={OVERLAY_Z_INDEX}>
            <Menu.Target><Button variant="default" size="compact-xs">{t('wardrobeIO.menuLabel')}</Button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item disabled={cloudQuarantined} onClick={() => void actions.saveCharacterToFolder()}>{t('library.saveCharacter')}</Menu.Item>
              <Menu.Item disabled={cloudQuarantined} onClick={() => void actions.importPlayerWardrobe()}>{t('fileManagerPanel.importPlayerWardrobe')}</Menu.Item>
              <Menu.Item disabled={cloudQuarantined} onClick={() => void actions.importBCX()}>{t('fileManagerPanel.importBCX')}</Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={actions.saveBackup}>{t('fileManagerPanel.saveBackup')}</Menu.Item>
              <Menu.Item disabled={cloudQuarantined} onClick={actions.importBackup}>{t('fileManagerPanel.importBackup')}</Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={() => getFs().refreshThumbnails(displayList)}>{t('fileManager.refreshThumbnails')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <Box className="vpw-library-workspace">
        <Box component="aside" className="vpw-library-sidebar" aria-label={t('library.filters', { defaultValue: 'Filters' })}>
          {filterList}
        </Box>
        <Box className="vpw-library-scroll">
          {(selectedTagId || cloudFilter !== 'all') && <Group gap={5} mb={10}>
            {selectedTagId && <Badge variant="light">{selectedTag?.name ?? t('library.untagged')}</Badge>}
            {cloudFilter !== 'all' && <Badge variant="light" color="gray">{t(cloudFilter === 'cloud' ? 'library.cloudIncluded' : 'library.localOnly')}</Badge>}
            <Button size="compact-xs" variant="subtle" onClick={clearFilters}>{t('library.clearFilters')}</Button>
          </Group>}
          {displayList.length > 0 ? <Box className="vpw-library-masonry" data-view={fileViewMode}>
            {displayList.map((item) => (
              <FileItem key={item.id} item={item} viewMode={fileViewMode} cloudEnableBlocked={cloudQuarantined} onSelectOutfit={onSelectOutfit}
                tagNames={[...new Set(item.tagIds.map((id) => tagNames.get(id)).filter((name): name is string => !!name))]}
                onEditTags={() => editTags(item)} />
            ))}
          </Box> : (
            <Stack align="center" py="xl">
              <Text c="dimmed">{t(cloudQuarantined && !outfits.length ? 'library.conflict.hiddenEmpty'
                : outfits.length ? 'library.noMatches' : 'library.empty')}</Text>
              {searchQuery || activeFilterCount ? <Button variant="light" size="xs" onClick={clearFilters}>{t('library.clearFilters')}</Button>
                : cloudQuarantined ? <Button variant="light" size="xs" onClick={() => setConflictReviewOpened(true)}>
                  {t('library.conflict.review', { count: conflicts.length })}
                </Button> : <Button variant="light" size="xs" onClick={() => void actions.saveCharacterToFolder()}>{t('library.saveCharacter')}</Button>}
            </Stack>
          )}
        </Box>
      </Box>

      {localSaveError && <Paper withBorder radius="md" p={isMobile ? 8 : 'sm'} role="alert"
        className="vpw-library-local-alert" data-compact={isMobile || undefined}>
        <Stack gap={isMobile ? 4 : 'xs'} className="vpw-library-local-alert-stack">
          <Group justify="space-between" gap={4} wrap="nowrap" className="vpw-library-local-alert-heading">
            <Text size="sm" fw={700} c="red">{t(indexedDBSaveError ? 'library.indexedDBSaveTitle' : 'library.localStorageQuotaTitle')}</Text>
            {isMobile && <Button size="compact-xs" variant="subtle" onClick={() => setLocalSaveDetailsOpened((opened) => !opened)}
              aria-expanded={localSaveDetailsOpened} aria-controls={localSaveDetailsId}>
              {t(localSaveDetailsOpened ? 'library.hideLocalStorageDetails' : 'library.showLocalStorageDetails')}
            </Button>}
          </Group>
          <Box id={localSaveDetailsId} hidden={isMobile && !localSaveDetailsOpened}
            className="vpw-library-local-alert-details">
            <Stack gap={4}>
              <Text size="xs">{t(indexedDBSaveError ? 'library.indexedDBSaveHelp' : 'library.localStorageQuotaHelp')}</Text>
              {localStorageQuotaError && <Text size="xs" c="dimmed">{localStorageUsage
                ? t('library.localStorageUsage', {
                  wardrobe: formatLocalStorageBytes(localStorageUsage.wardrobeBytes),
                  other: formatLocalStorageBytes(localStorageUsage.otherBytes),
                  total: formatLocalStorageBytes(localStorageUsage.totalBytes),
                })
                : t('library.localStorageUsageUnavailable')}</Text>}
              {localStorageUsage && <>
                <Text size="xs" c="dimmed">{t('library.localStorageUsageNote')}</Text>
                <Box component="dl" m={0} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 12, rowGap: 2 }}>
                  {LOCAL_STORAGE_CATEGORIES.map(([category, label]) => <Fragment key={category}>
                    <Text component="dt" size="xs" c="dimmed">{t(label)}</Text>
                    <Text component="dd" size="xs" m={0} ta="right">{formatLocalStorageBytes(localStorageUsage.categories[category])}</Text>
                  </Fragment>)}
                </Box>
              </>}
            </Stack>
          </Box>
          <Group gap="xs" className="vpw-library-local-alert-actions">
            <Button size="compact-sm" color="red" onClick={actions.saveBackup}>{t('library.exportLocalBackup')}</Button>
            <Button size="compact-sm" color="red" variant="light" onClick={() => void retrySync()}>{t('library.retryLocalSave')}</Button>
          </Group>
        </Stack>
      </Paper>}

      {cloudflare.enabled ? <Paper withBorder radius="md" p={8} className="vpw-library-quota">
        <Stack gap={4}>
          <Group justify="space-between" gap={4}>
            <Text size="xs" fw={600}>{t('cloudflareSync.enable')}</Text>
            {!localSaveError && <Badge size="sm" variant="light" color={!cloudflare.ready ? 'orange' : cloudflare.error ? 'red' : cloudflare.pending ? 'blue' : cloudflare.lastSyncedAt && !cloudflare.syncing ? 'teal' : 'gray'}>
              {!cloudflare.ready ? t('cloudflareSync.serviceNotReady') : cloudflare.syncing ? t('cloudflareSync.syncingShort') : cloudflare.error
                ? t('cloudflareSync.needsAttentionShort') : cloudflare.pending ? t('cloudflareSync.pendingShort') : cloudflare.lastSyncedAt
                  ? t('cloudflareSync.syncedShort')
                  : t('cloudflareSync.waiting')}
            </Badge>}
          </Group>
          <Group justify="space-between" gap={4}>
            <Text size="xs" c="dimmed">{t('cloudflareSync.estimatedSize')}</Text>
            <Text size="xs" fw={600} c={cloudflareUsage > 1 ? 'red' : cloudflareUsage >= 0.9 ? 'orange' : undefined}>
              {cloudflareSizeLabel} / 1.8 MB
            </Text>
          </Group>
          <Progress size={4} value={Math.min(100, cloudflareUsage * 100)}
            color={cloudflareUsage > 1 ? 'red' : cloudflareUsage >= 0.9 ? 'orange' : 'teal'}
            aria-label={t('cloudflareSync.sizeAria', { used: cloudflareSizeLabel })} />
          <Text size="xs" c="dimmed">{t('cloudflareSync.sizeHint')}</Text>
          {cloudflareUsage > 1 && <Text size="xs" c="red">{t('cloudflareSync.sizeOver')}</Text>}
          {cloudflare.lastSyncedAt && !cloudflare.error && !cloudflare.pending && <Text size="xs" c="dimmed">
            {t('cloudflareSync.lastSynced', {
              time: new Date(cloudflare.lastSyncedAt).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US'),
            })}
          </Text>}
          {!localSaveError && <Group justify="space-between" gap={4}>
            <Text size="xs" c={sync.localSaved ? 'dimmed' : 'red'}>{t(sync.localSaved ? 'library.localSaved' : 'library.localUnsaved')}</Text>
            {conflicts.length > 0
              ? <Button variant="light" color="orange" size="compact-xs" onClick={() => setConflictReviewOpened(true)}>
                {t('library.conflict.review', { count: conflicts.length })}
              </Button>
              : <Button variant="subtle" size="compact-xs" disabled={!cloudflare.ready || cloudflare.syncing}
                onClick={() => { void retryCloudflareSync() }}>{t('cloudflareSync.syncNow')}</Button>}
          </Group>}
          {!cloudflare.ready && <Text size="xs" c="orange">{t('cloudflareSync.serviceUnavailable')}</Text>}
          {cloudflare.bcLegacyChanged ? <Group justify="space-between" gap={4}>
            <Text size="xs" c="orange">{t('cloudflareSync.bcLegacyChangedShort')}</Text>
            <Button variant="subtle" size="compact-xs" onClick={() => getWb().setActiveTab('settings')}>
              {t('fileManagerPanel.tabSettings')}
            </Button>
          </Group> : <>
            {cloudflare.bcLegacyRetained === true && <Text size="xs" c="orange">{t('cloudflareSync.bcCleanupPendingShort')}</Text>}
            {cloudflare.bcLegacyRetained == null && <Text size="xs" c="dimmed">{t('cloudflareSync.bcCleanupUnknownShort')}</Text>}
          </>}
          {sync.recoveryAvailable && <Button variant="subtle" size="compact-xs" style={{ alignSelf: 'flex-start' }}
            onClick={actions.saveRecoveryBackup}>{t('library.exportRecovery')}</Button>}
          {conflicts.length > 0 && <Text size="xs" c="orange">{t('library.conflict.paused')}</Text>}
          {cloudflare.error && <Text size="xs" c="red" style={{ overflowWrap: 'anywhere' }}>
            {cloudflareErrorKey ? t(cloudflareErrorKey) : cloudflare.error}
          </Text>}
        </Stack>
      </Paper> : <Paper withBorder radius="md" p={8} className="vpw-library-quota" data-expanded={showQuotaDetails || undefined}>
        <Stack gap={4}>
          <Group justify="space-between" gap={4}>
            <Group gap={4} wrap="nowrap">
              <Text size="xs" fw={600}>{t('library.cloudStorage')}</Text>
              <Tooltip label={t('library.sharedQuotaHint')} multiline w={270} withArrow zIndex={OVERLAY_Z_INDEX}
                events={{ hover: true, focus: true, touch: true }}>
                <ActionIcon variant="subtle" color="gray" size="xs" aria-label={t('library.sharedQuotaInfo')}>ⓘ</ActionIcon>
              </Tooltip>
            </Group>
            <Group gap={5}>
              {!localSaveError && <Badge size="sm" color={syncColor} variant="light">{t(`library.sync.${sync.state}`)}</Badge>}
              <ActionIcon variant="subtle" size="xs" onClick={() => setQuotaDetailsOpened((opened) => !opened)}
                aria-label={t('library.storageDetails', { defaultValue: 'Storage details' })} aria-expanded={showQuotaDetails}>
                {showQuotaDetails ? '⌄' : '⌃'}
              </ActionIcon>
            </Group>
          </Group>
          {observedQuota ? <>
            <Text size="xs" c="dimmed">{t(quota.observedSource === 'login-response'
              ? 'library.quotaObservedLogin' : 'library.quotaObservedCache')}</Text>
            <Progress value={Math.min(100, Math.max(0, observedQuota.usageRatio * 100))} color={observedColor} size={4}
              aria-label={t('library.quotaAria', { used: formatKB(observedQuota.totalBytes), limit: formatKB(observedQuota.limitBytes),
                source: t(quota.observedSource === 'login-response' ? 'library.quotaObservedLogin' : 'library.quotaObservedCache') })} />
            <Group justify="space-between" gap={4}>
              <Text size="xs">VPW {formatKB(observedQuota.wardrobeBytes)}</Text>
              <Text size="xs" c="dimmed" className="vpw-library-quota-secondary">{t('library.otherExtensions')} {formatKB(observedQuota.otherExtensionsBytes)}</Text>
              <Text size="xs" fw={600} c={observedColor}>{formatKB(observedQuota.totalBytes)} / {formatKB(observedQuota.limitBytes)}</Text>
            </Group>
          </> : <Text size="xs" c="dimmed">{t('library.quotaObservedUnavailable')}</Text>}
          {!localSaveError && <Group justify="space-between" gap={4} className="vpw-library-quota-secondary">
            <Text size="xs" c={sync.localSaved ? 'dimmed' : 'red'}>{t(sync.localSaved ? 'library.localSaved' : 'library.localUnsaved')}</Text>
            {conflicts.length > 0
              ? <Button variant="light" color="orange" size="compact-xs" onClick={() => setConflictReviewOpened(true)}>
                {t('library.conflict.review', { count: conflicts.length })}
              </Button>
              : sync.errorCode === 'device-limit'
                ? <Button variant="subtle" size="compact-xs" onClick={actions.saveBackup}>{t('library.exportLocalBackup')}</Button>
                : <Button variant="subtle" size="compact-xs" onClick={() => void retrySync()}>{t('library.retrySync')}</Button>}
          </Group>}
          <Collapse in={showQuotaDetails}>
            <Stack gap={4}>
              {observedQuota && <Text size="xs" c="dimmed">{t('library.observedRemaining', { amount: formatKB(observedQuota.remainingBytes) })}</Text>}
              {!localSaveError && quota.proposalAvailable === true && <>
              <Text size="xs" fw={600}>{t('library.proposedUpload')}</Text>
              <Group justify="space-between" gap={4}>
                <Text size="xs">VPW {formatKB(quota.wardrobeBytes)}</Text>
                <Text size="xs" c="dimmed" className="vpw-library-quota-secondary">{t('library.otherExtensions')} {formatKB(quota.otherExtensionsBytes)}</Text>
                <Text size="xs" fw={600} c={proposedColor}>{formatKB(quota.totalBytes)} / {formatKB(quota.limitBytes)}</Text>
              </Group>
              <Text size="xs" c="dimmed">{t('library.proposedRemaining', { amount: formatKB(quota.remainingBytes) })}</Text>
              </>}
              {sync.recoveryAvailable && <Button variant="subtle" size="compact-xs" onClick={actions.saveRecoveryBackup}>{t('library.exportRecovery')}</Button>}
            </Stack>
          </Collapse>
          {!localSaveError && quota.isWarning && !quota.isOverLimit && <Text size="xs" c="orange">{t('library.quotaWarning')}</Text>}
          {conflicts.length > 0 && <Text size="xs" c="orange">{t('library.conflict.paused')}</Text>}
          {sync.state === 'quota' && <Text size="xs" c="red">{t('library.quotaBlocked')}</Text>}
          {sync.errorCode === 'device-limit' && <Text size="xs" c="red">{t('library.deviceLimit')}</Text>}
          {sync.error && !localSaveError && sync.errorCode !== 'device-limit' && sync.state !== 'quota' && sync.state !== 'conflict'
            && <Text size="xs" c="red" style={{ overflowWrap: 'anywhere' }}>{sync.error}</Text>}
        </Stack>
      </Paper>}

      <Drawer opened={filtersOpened} onClose={() => setFiltersOpened(false)} position="left" size="min(340px, 88vw)" lockScroll={false}
        closeOnEscape={!filterTagPickerOpened}
        title={t('library.filters', { defaultValue: 'Filters' })} zIndex={OVERLAY_Z_INDEX}
        styles={{ content: { display: 'flex', flexDirection: 'column' }, body: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' } }}>
        <Stack style={{ flex: 1, minHeight: 0 }}>
          <Box style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          <Select value={selectedTagId ?? 'all'} label={t('library.filterByTag')}
            mb="md"
            data={[{ value: 'all', label: t('library.allOutfits') }, { value: 'untagged', label: t('library.untagged') }, ...tagOptions]}
            onChange={(value) => getFs().selectTag(value === 'all' ? null : value)} searchable allowDeselect={false}
            dropdownOpened={filterTagPickerOpened} onDropdownOpen={() => setFilterTagPickerOpened(true)}
            onDropdownClose={() => setFilterTagPickerOpened(false)} onOptionSubmit={() => setFilterTagPickerOpened(false)}
            comboboxProps={{ zIndex: OVERLAY_Z_INDEX + 1 }} />
          {filterList}
          </Box>
          <Button style={{ flexShrink: 0 }} onClick={() => setFiltersOpened(false)}>{t('library.showResults', { count: displayList.length, defaultValue: 'Show {count} outfits' })}</Button>
        </Stack>
      </Drawer>

      <Modal opened={editingOutfit !== null} onClose={() => setEditingOutfit(null)} centered zIndex={OVERLAY_Z_INDEX} lockScroll={false}
        closeOnEscape={!tagPickerOpened}
        title={t('library.editOutfitTags', { name: editingOutfit?.name })}>
        <Stack>
          <MultiSelect label={t('library.tags')} placeholder={t('library.selectTags')} searchable clearable
            data={tagOptions} value={editingTagIds} onChange={setEditingTagIds} nothingFoundMessage={t('library.noTags')}
            dropdownOpened={tagPickerOpened} onDropdownOpen={() => setTagPickerOpened(true)}
            onDropdownClose={() => setTagPickerOpened(false)} onOptionSubmit={() => setTagPickerOpened(false)}
            comboboxProps={{ zIndex: OVERLAY_Z_INDEX + 1 }} />
          <Text size="xs" c="dimmed">{t('library.multipleTagsHint')}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditingOutfit(null)}>{t('dialog.cancel')}</Button>
            <Button onClick={() => void saveTags()}>{t('library.saveTags')}</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={reviewingConflicts && !isMobile} onClose={() => setConflictReviewOpened(false)} centered
        zIndex={OVERLAY_Z_INDEX} lockScroll={false} size="lg" title={t('library.conflict.title')}>
        <SyncConflictReview conflicts={conflicts} mobile={false} onBack={() => setConflictReviewOpened(false)} />
      </Modal>
    </Box>
  )
}
