import { memo, useCallback, useId, useMemo, useState } from 'react'
import { Box, Button, Checkbox, Collapse, Group, Paper, SegmentedControl, Stack, Text, Tooltip, VisuallyHidden } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { getFs, useFsSelector } from '@/stores/hooks'
import { AssetApi } from '@/utils/AssetApi'
import { OVERLAY_Z_INDEX } from '@/ui/z-index'
import { isHiddenBodySlot } from '@/services/hidden-body-slots.js'
import {
  SLOT_MODES,
  normalizeSlotMode,
  getGroupNameFromPart,
  groupPartsBySlot,
  buildPresenceSets,
  buildSlotPresenceMap,
  scopeModeState,
  type SlotMode,
  type GroupOperation,
  type ScopeState,
  type OutfitPart as WardrobePart,
  type SlotControlMap,
} from '@/services/outfit-slot-rules.js'
import filterStyles from './FilterManager.css?inline'

interface FilterItem {
  key: string
  data?: { Name?: string; Description?: string }
}
interface FilterGroup {
  groupID: string
  displayName?: string
  isHiddenGroup?: boolean
  itemList?: FilterItem[]
}
type SourceAction = { operation: GroupOperation; complete: boolean }
type GroupActions = Partial<Record<'original' | 'incoming', SourceAction | null>>
type PresenceMap = Record<string, { inCharacter?: boolean; inHover?: boolean }>
type NameMap = Record<string, string>
type ScopeStates = Record<SlotMode, ScopeState>

const EMPTY_GROUPS: FilterGroup[] = []
const EMPTY_ITEMS: FilterItem[] = []
const EMPTY_PARTS: WardrobePart[] = []
const EMPTY_SLOT_CONTROL_MAP: SlotControlMap = {}
const EMPTY_SCOPE_STATES: ScopeStates = { original: 'none', incoming: 'none', empty: 'none' }

function buildPartNameMapBySlot(parts: WardrobePart[], character: unknown): NameMap {
  const names: NameMap = {}
  for (const [slotKey, slotParts] of groupPartsBySlot(parts)) {
    names[slotKey] = Array.from(new Set(
      slotParts.map((part) => AssetApi.getPartDisplayName(part, character as any)).filter(Boolean),
    )).join(', ')
  }
  return names
}

function buildKnownSlotKeys(
  groups: FilterGroup[],
  snapshotItems: FilterItem[],
  controls: SlotControlMap,
  characterData: WardrobePart[],
  incomingData: WardrobePart[],
) {
  const keys = new Set(Object.keys(controls))
  for (const item of snapshotItems) if (item.key) keys.add(item.key)
  for (const group of groups) {
    for (const item of group.itemList ?? EMPTY_ITEMS) if (item.key) keys.add(item.key)
  }
  for (const part of [...characterData, ...incomingData]) {
    const key = getGroupNameFromPart(part)
    if (key) keys.add(key)
  }
  return Array.from(keys).filter((key) => !isHiddenBodySlot(key))
}

function SourceButtons({
  states,
  actions,
  grouped = false,
  onApply,
}: {
  states: ScopeStates
  actions?: GroupActions
  grouped?: boolean
  onApply: (mode: SlotMode) => void
}) {
  const { t } = useTranslation()
  const labels = {
    original: t('filterManager.slotModeShortOriginal'),
    incoming: t('filterManager.slotModeShortIncoming'),
    empty: t('filterManager.slotModeShortEmpty'),
  }
  const operationLabels: Record<GroupOperation, string> = {
    add: t('filterManager.operationAdd', { defaultValue: '补入' }),
    replace: t('filterManager.operationReplace', { defaultValue: '覆盖' }),
    'full-replace': t('filterManager.operationFullReplace', { defaultValue: '完全替换' }),
  }
  const directTips = {
    original: t('filterManager.restoreOriginalTooltip', { defaultValue: '恢复原角色的全部部位。' }),
    incoming: t('filterManager.replaceAllTooltip', { defaultValue: '全部使用所选衣物，清空其中没有的部位。' }),
    empty: t('filterManager.clearScopeTooltip', { defaultValue: '直接将此范围的滑块设为置空。' }),
  }

  return (
    <Group gap={5} wrap="nowrap" className="vpw-filter-source-buttons">
      {SLOT_MODES.map((mode) => {
        const action = mode !== 'empty' ? actions?.[mode] : undefined
        const active = action?.complete || states[mode] === 'full'
        const phase = grouped ? action?.operation : undefined
        const complete = !!action?.complete
        const variant = active ? 'filled' : states[mode] === 'partial' ? 'light' : 'default'
        const label = !grouped && mode === 'incoming'
          ? t('filterManager.replaceAllAction', { defaultValue: '全量替换' })
          : labels[mode]
        return (
          <Tooltip key={mode} label={directTips[mode]} disabled={grouped} withinPortal zIndex={OVERLAY_Z_INDEX + 1} multiline w={270}>
            <Button
              size="compact-xs"
              px={7}
              variant={variant}
              aria-pressed={active}
              data-source={mode}
              data-operation={phase}
              data-complete={complete || undefined}
              data-disabled={complete || undefined}
              aria-disabled={complete || undefined}
              disabled={grouped && mode !== 'empty' && !action}
              onClick={() => { if (!complete) onApply(mode) }}
              className={mode === 'empty' ? 'vpw-filter-empty-source' : 'vpw-filter-source'}
            >
              <span>{label}</span>
              {phase && <span className="vpw-filter-operation">{complete
                ? t('filterManager.operationComplete', { defaultValue: '已完全替换' })
                : operationLabels[phase]}</span>}
            </Button>
          </Tooltip>
        )
      })}
    </Group>
  )
}

const FilterItemRow = memo(function FilterItemRow({
  item,
  inCharacter,
  inIncoming,
  mode,
  characterName,
  incomingName,
  onSetMode,
}: {
  item: FilterItem
  inCharacter: boolean
  inIncoming: boolean
  mode: SlotMode
  characterName?: string
  incomingName?: string
  onSetMode: (key: string, mode: SlotMode) => void
}) {
  const { t } = useTranslation()
  const name = item.data?.Description || item.data?.Name || item.key
  const noItemName = t('filterManager.noItemName')
  const originalName = characterName || noItemName
  const outfitName = incomingName || noItemName
  const originalLabel = t('filterManager.slotModeShortOriginal')
  const incomingLabel = t('filterManager.slotModeShortIncoming')
  const emptyLabel = t('filterManager.slotModeShortEmpty')
  const data = [
    { value: 'original', label: <span title={originalName}><VisuallyHidden>{originalLabel}: </VisuallyHidden>{originalName}</span> },
    { value: 'incoming', label: <span title={outfitName}><VisuallyHidden>{incomingLabel}: </VisuallyHidden>{outfitName}</span> },
    { value: 'empty', label: emptyLabel },
  ]
  const dotColor = inCharacter ? 'blue' : inIncoming ? 'teal' : 'gray'
  const presenceText = [
    inCharacter ? t('filterManager.inCharacter') : '',
    inIncoming ? t('filterManager.inSelectedOutfit', { defaultValue: '所选衣物中存在' }) : '',
  ].filter(Boolean).join(' / ') || t('filterManager.dotNone')

  return (
    <div className="vpw-filter-slot-row" data-slot-key={item.key}>
      <Group gap={6} wrap="nowrap" className="vpw-filter-slot-name" title={presenceText}>
        <Box className="vpw-filter-presence-dot" bg={`var(--vpw-color-${dotColor}-5)`} />
        <Text size="xs" truncate title={name}>{name}</Text>
      </Group>
      <SegmentedControl
        size="xs"
        value={mode}
        data={data}
        onChange={(value) => onSetMode(item.key, normalizeSlotMode(value))}
        aria-label={t('filterManager.slotControlLabel', { defaultValue: '{name}：选择来源', name })}
        className="vpw-filter-slot-slider"
        styles={{
          root: { minWidth: 0, maxWidth: '100%' },
          control: { flex: '1 1 0', minWidth: 0 },
          label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 6 },
        }}
      />
    </div>
  )
})

function FilterGroupCard({
  group,
  collapsed,
  showAllSlots,
  slotControls,
  actions,
  presence,
  characterNames,
  incomingNames,
  scopeStates,
  onToggle,
  onApplyGroup,
  onSetSlot,
}: {
  group: FilterGroup
  collapsed: boolean
  showAllSlots: boolean
  slotControls: SlotControlMap
  actions?: GroupActions
  presence: PresenceMap
  characterNames: NameMap
  incomingNames: NameMap
  scopeStates: ScopeStates
  onToggle: (id: string) => void
  onApplyGroup: (id: string, mode: SlotMode) => void
  onSetSlot: (key: string, mode: SlotMode) => void
}) {
  const { t } = useTranslation()
  const name = t(`groupNames.${group.groupID}`, { defaultValue: group.displayName || group.groupID })
  const items = (group.itemList ?? EMPTY_ITEMS).filter((item) => !isHiddenBodySlot(item.key) && (
    showAllSlots || presence[item.key]?.inCharacter || presence[item.key]?.inHover
  ))
  const contentID = useId()

  return (
    <Paper withBorder radius="md" p="xs" component="section" aria-label={name} data-group-id={group.groupID}>
      <Button
        variant="subtle"
        size="compact-sm"
        fullWidth
        px={2}
        mb={7}
        justify="space-between"
        onClick={() => onToggle(group.groupID)}
        aria-expanded={!collapsed}
        aria-controls={contentID}
        rightSection={<span aria-hidden="true">{collapsed ? '+' : '−'}</span>}
      >
        <Text size="sm" fw={600} truncate>
          {name}
          {group.isHiddenGroup ? ` · ${t('filterManager.hiddenBadge')}` : ''}
          <Text span size="xs" c="dimmed" ml={6}>{items.length}</Text>
        </Text>
      </Button>
      <SourceButtons grouped states={scopeStates} actions={actions} onApply={(mode) => onApplyGroup(group.groupID, mode)} />
      <Stack id={contentID} gap={3} mt="xs" hidden={collapsed}>
        {!collapsed && items.map((item) => (
          <FilterItemRow
            key={item.key}
            item={item}
            inCharacter={!!presence[item.key]?.inCharacter}
            inIncoming={!!presence[item.key]?.inHover}
            mode={normalizeSlotMode(slotControls[item.key]?.mode)}
            characterName={characterNames[item.key]}
            incomingName={incomingNames[item.key]}
            onSetMode={onSetSlot}
          />
        ))}
        {!collapsed && items.length === 0 && <Text size="xs" c="dimmed">{t('filterManager.emptyItems')}</Text>}
      </Stack>
    </Paper>
  )
}

export function FilterManager() {
  const { t } = useTranslation()
  const filterSnapshot = useFsSelector((fs) => fs.filterSnapshot)
  const slotControls = useFsSelector((fs) => fs.slotControlMap) || EMPTY_SLOT_CONTROL_MAP
  const previewItem = useFsSelector((fs) => fs.previewItem)
  const characterItem = (useFsSelector((fs) => fs.characterItem) as WardrobePart[]) || EMPTY_PARTS
  const incomingData = (useFsSelector((fs) => fs.activeItem?.data) as WardrobePart[]) || EMPTY_PARTS
  const character = useFsSelector((fs) => fs.character)
  const [legendOpen, setLegendOpen] = useState(false)
  const [showAllSlots, setShowAllSlots] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const groups = (filterSnapshot?.groups as FilterGroup[] | undefined) ?? EMPTY_GROUPS
  const snapshotItems = (filterSnapshot?.items as FilterItem[] | undefined) ?? EMPTY_ITEMS

  const presence = useMemo(() => buildSlotPresenceMap(characterItem, incomingData), [characterItem, incomingData])
  const characterNames = useMemo(() => buildPartNameMapBySlot(characterItem, character), [characterItem, character])
  const incomingNames = useMemo(() => buildPartNameMapBySlot(incomingData, character), [incomingData, character])
  const knownKeys = useMemo(
    () => buildKnownSlotKeys(groups, snapshotItems, slotControls, characterItem, incomingData),
    [groups, snapshotItems, slotControls, characterItem, incomingData],
  )
  const presenceSets = useMemo(() => buildPresenceSets(characterItem, incomingData), [characterItem, incomingData])
  const scopes = useMemo(() => {
    const forKeys = (keys: string[]): ScopeStates => {
      const result = { ...EMPTY_SCOPE_STATES }
      for (const mode of SLOT_MODES) {
        result[mode] = scopeModeState(keys, mode, slotControls, presenceSets.inCharacter, presenceSets.inIncoming)
      }
      return result
    }
    return {
      all: forKeys(knownKeys),
      groups: new Map(groups.map((group) => [
        group.groupID,
        forKeys((group.itemList ?? EMPTY_ITEMS).map((item) => item.key).filter((key) => !isHiddenBodySlot(key))),
      ])),
    }
  }, [groups, knownKeys, slotControls, presenceSets])
  const visibleGroups = useMemo(() => groups.filter((group) => {
    if (group.isHiddenGroup) return false
    if (showAllSlots) return true
    return (group.itemList ?? EMPTY_ITEMS).some((item) =>
      !isHiddenBodySlot(item.key) && (presence[item.key]?.inCharacter || presence[item.key]?.inHover),
    )
  }), [groups, presence, showAllSlots])
  const groupActions = useMemo(() => {
    const fs = getFs()
    return new Map(groups.map((group) => [group.groupID, {
      original: fs.getGroupSourceAction(group.groupID, 'original'),
      incoming: fs.getGroupSourceAction(group.groupID, 'incoming'),
    }]))
  }, [groups, slotControls, characterItem, incomingData, previewItem])

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const applyAll = useCallback((mode: SlotMode) => { getFs().replaceAllFromSource(mode) }, [])
  const applyGroup = useCallback((id: string, mode: SlotMode) => {
    if (mode === 'empty') getFs().setGroupSlotModes(id, mode)
    else getFs().progressGroupSource(id, mode)
  }, [])
  const setSlot = useCallback((key: string, mode: SlotMode) => { getFs().setSlotMode(key, mode) }, [])

  return (
    <Stack gap="xs" h="100%" className="vpw-filter-manager" aria-label={t('filterManager.ariaLabel')}>
      <style>{filterStyles}</style>
      <Paper withBorder radius="md" p="xs">
        <Group gap={6} grow wrap="nowrap">
          <Tooltip label={t('filterManager.preserveBodyTooltip', { defaultValue: '单次保留原角色的身体、面容和发色，其余微调保持当前选择。' })} multiline w={250} withinPortal zIndex={OVERLAY_Z_INDEX + 1}>
            <Button variant="light" size="xs" px={8} onClick={() => getFs().preserveBody()}>
              {t('filterManager.preserveBody', { defaultValue: '保留原身形' })}
            </Button>
          </Tooltip>
          <Tooltip label={t('filterManager.replaceBodyOnlyTooltip', { defaultValue: '只使用所选衣物的身体、面容和发色，其他部位恢复原角色。' })} multiline w={250} withinPortal zIndex={OVERLAY_Z_INDEX + 1}>
            <Button variant="default" size="xs" px={8} onClick={() => getFs().replaceBodyOnly()}>
              {t('filterManager.replaceBodyOnly', { defaultValue: '只替换身形' })}
            </Button>
          </Tooltip>
        </Group>
        <Group justify="space-between" gap="xs" mt="xs" wrap="nowrap">
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{t('filterManager.sectionGlobal')}</Text>
          <SourceButtons states={scopes.all} onApply={applyAll} />
        </Group>
      </Paper>

      <Text size="xs" c="dimmed">
        {t('filterManager.groupProgressHint', { defaultValue: '分组按钮显示当前预览需要的下一步；部件滑块直接选择来源。' })}
      </Text>
      <Group justify="space-between" gap={4}>
        <Group gap={2}>
          <Button size="compact-xs" variant="subtle" onClick={() => setLegendOpen((value) => !value)} aria-expanded={legendOpen}>
            {t('filterManager.legendToggle')}
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={() => setCollapsed(new Set(visibleGroups.map((group) => group.groupID)))}>
            {t('filterManager.collapseAllGroups')}
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={() => setCollapsed(new Set())}>
            {t('filterManager.expandAllGroups')}
          </Button>
        </Group>
        <Checkbox
          size="xs"
          label={t('filterManager.showAllSlots')}
          checked={showAllSlots}
          onChange={(event) => setShowAllSlots(event.currentTarget.checked)}
        />
      </Group>
      <Collapse in={legendOpen}>
        <Paper withBorder radius="sm" p="xs" bg="var(--vpw-color-default-hover)">
          <Stack gap={4}>
            <Text size="xs">{t('filterManager.groupProgressTooltip', { defaultValue: '按钮根据当前预览执行下一步：先补齐缺少的部位，已补齐时覆盖已有部位，已覆盖时清空来源中没有的部位。' })}</Text>
            <Text size="xs" c="dimmed">
              {t('filterManager.fullReplaceSourceHint', { defaultValue: '完全替换产生的空部位仍停在所选来源；只有手动选择“置空”才会切到空档。' })}
            </Text>
            <Text size="xs" c="dimmed">
              {t('filterManager.slotSourceHint', { defaultValue: '每行依次为原角色、所选衣物和置空。名称显示该来源的实际部件；蓝点表示原角色有此部位，绿点表示仅所选衣物有此部位。' })}
            </Text>
          </Stack>
        </Paper>
      </Collapse>

      <Box className="vpw-filter-groups">
        {visibleGroups.length === 0 && <Text c="dimmed" size="sm" ta="center" py="md">{t('filterManager.emptyGroups')}</Text>}
        <Stack gap="xs">
          {visibleGroups.map((group) => (
            <FilterGroupCard
              key={group.groupID}
              group={group}
              collapsed={collapsed.has(group.groupID)}
              showAllSlots={showAllSlots}
              slotControls={slotControls}
              actions={groupActions.get(group.groupID)}
              presence={presence}
              characterNames={characterNames}
              incomingNames={incomingNames}
              scopeStates={scopes.groups.get(group.groupID) ?? EMPTY_SCOPE_STATES}
              onToggle={toggleCollapsed}
              onApplyGroup={applyGroup}
              onSetSlot={setSlot}
            />
          ))}
        </Stack>
      </Box>
    </Stack>
  )
}
