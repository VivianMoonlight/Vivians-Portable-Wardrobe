import { memo, useCallback, useMemo, useState } from 'react'
import { Box, Button, Checkbox, Collapse, Group, Paper, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { getFs, useFsSelector } from '@/stores/hooks'
import { AssetApi } from '@/utils/AssetApi'

type SlotMode = 'original' | 'incoming' | 'empty'
type ReplaceMode = 'preserve' | 'fill-empty' | 'merge-replace' | 'full-replace'
type ScopeState = 'none' | 'partial' | 'full'

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
interface WardrobePart {
  Group?: string
  Asset?: { Group?: { Name?: string; name?: string } }
}
type SlotControlMap = Record<string, { mode?: string; locked?: boolean }>
type PresenceMap = Record<string, { inCharacter?: boolean; inHover?: boolean }>
type NameMap = Record<string, string>
type ScopeStates = Record<SlotMode, ScopeState>
interface FilterGroupCardProps {
  group: FilterGroup
  isCollapsed: boolean
  hiddenBadge: string
  emptyItemsLabel: string
  applyMode: ReplaceMode
  slotControlMap: SlotControlMap
  presence: PresenceMap
  characterPartNameBySlot: NameMap
  incomingPartNameBySlot: NameMap
  scopeStates: ScopeStates
  slotLabels: Record<SlotMode, string>
  slotTooltips: Record<SlotMode, string>
  rowLabels: {
    noItemName: string
    characterItemName: string
    incomingItemName: string
    slotModeControlAriaLabel: string
  }
  dotLabels: { inCharacter: string; inHover: string; none: string }
  onToggleCollapsed: (id: string) => void
  onApplyGroupMode: (id: string, mode: SlotMode) => void
  onSetSlotMode: (key: string, mode: SlotMode) => void
}

const SLOT_MODES: SlotMode[] = ['original', 'incoming', 'empty']
const REPLACE_MODES: ReplaceMode[] = ['preserve', 'fill-empty', 'merge-replace', 'full-replace']
const SLOT_MODE_SET = new Set<string>(SLOT_MODES)
const EMPTY_GROUPS: FilterGroup[] = []
const EMPTY_ITEMS: FilterItem[] = []
const EMPTY_PARTS: WardrobePart[] = []
const EMPTY_SLOT_CONTROL_MAP: SlotControlMap = {}
const EMPTY_PRESENCE: { inCharacter?: boolean; inHover?: boolean } = {}
const EMPTY_SCOPE_STATES: ScopeStates = { original: 'none', incoming: 'none', empty: 'none' }

const replaceDescKey: Record<ReplaceMode, string> = {
  preserve: 'replaceDescPreserve',
  'fill-empty': 'replaceDescFillEmpty',
  'merge-replace': 'replaceDescMergeReplace',
  'full-replace': 'replaceDescFullReplace',
}
const replaceLabelKey: Record<ReplaceMode, string> = {
  preserve: 'modePreserve',
  'fill-empty': 'modeFillEmpty',
  'merge-replace': 'modeMergeReplace',
  'full-replace': 'modeFullReplace',
}
const tipKey: Record<SlotMode, string> = {
  original: 'tipKeep',
  incoming: 'tipOutfit',
  empty: 'tipEmpty',
}

const DOT_COLORS = {
  inCharacter: 'var(--mantine-color-blue-5)',
  inHover: 'var(--mantine-color-teal-5)',
  none: 'var(--mantine-color-gray-4)',
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const compactLabel = (value: string, max = 18) => {
  if (!value) return value
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}...` : value
}
const normalizeSlotMode = (mode: unknown): SlotMode => (SLOT_MODE_SET.has(String(mode)) ? (mode as SlotMode) : 'empty')
const normalizeReplaceMode = (mode: unknown): ReplaceMode =>
  REPLACE_MODES.includes(mode as ReplaceMode) ? (mode as ReplaceMode) : 'merge-replace'

function getGroupNameFromPart(part: WardrobePart | null | undefined) {
  if (!part) return ''
  return part.Group || part.Asset?.Group?.Name || part.Asset?.Group?.name || ''
}

function defaultModeFor(replaceMode: ReplaceMode, inChar: boolean, inInc: boolean): SlotMode {
  if (replaceMode === 'preserve') return 'empty'
  if (replaceMode === 'fill-empty') return inChar ? 'original' : inInc ? 'incoming' : 'empty'
  if (replaceMode === 'full-replace') return inInc ? 'incoming' : 'empty'
  return inInc ? 'incoming' : inChar ? 'original' : 'empty'
}

function buildSlotPresenceMap(characterData: WardrobePart[], incomingData: WardrobePart[]): PresenceMap {
  const inCharacter = new Set(characterData.map(getGroupNameFromPart).filter(Boolean))
  const inHover = new Set(incomingData.map(getGroupNameFromPart).filter(Boolean))
  const keys = new Set([...inCharacter, ...inHover])
  const map: PresenceMap = {}
  for (const key of keys) {
    map[key] = { inCharacter: inCharacter.has(key), inHover: inHover.has(key) }
  }
  return map
}

function buildPartNameMapBySlot(parts: WardrobePart[], character: unknown): NameMap {
  const grouped = new Map<string, WardrobePart[]>()
  for (const part of parts) {
    const slotKey = getGroupNameFromPart(part)
    if (!slotKey) continue
    if (!grouped.has(slotKey)) grouped.set(slotKey, [])
    grouped.get(slotKey)!.push(part)
  }

  const map: NameMap = {}
  for (const [slotKey, slotParts] of grouped.entries()) {
    const names = slotParts
      .map((part) => AssetApi.getPartDisplayName(part, character as any))
      .filter(Boolean)
    map[slotKey] = Array.from(new Set(names)).join(', ')
  }
  return map
}

function buildKnownSlotKeys(
  groups: FilterGroup[],
  snapshotItems: FilterItem[],
  slotControlMap: SlotControlMap,
  characterData: WardrobePart[],
  incomingData: WardrobePart[],
) {
  const keys = new Set(Object.keys(slotControlMap))
  for (const item of snapshotItems) if (item?.key) keys.add(item.key)
  for (const group of groups) {
    for (const item of group.itemList ?? EMPTY_ITEMS) if (item?.key) keys.add(item.key)
  }
  for (const part of characterData) {
    const key = getGroupNameFromPart(part)
    if (key) keys.add(key)
  }
  for (const part of incomingData) {
    const key = getGroupNameFromPart(part)
    if (key) keys.add(key)
  }
  return Array.from(keys)
}

function slotModeFor(slotControlMap: SlotControlMap, key: string): SlotMode {
  return normalizeSlotMode(slotControlMap[key]?.mode)
}

function scopeModeState(
  keys: string[],
  targetMode: SlotMode,
  slotControlMap: SlotControlMap,
  inCharacter: Set<string>,
  inIncoming: Set<string>,
): ScopeState {
  if (keys.length === 0) return 'none'
  const isTarget = (key: string) => slotModeFor(slotControlMap, key) === targetMode
  if (keys.every(isTarget)) return 'full'
  if (targetMode === 'empty') return 'none'
  const presence = targetMode === 'original' ? inCharacter : inIncoming
  const relevant = keys.filter((key) => presence.has(key))
  if (relevant.length > 0 && relevant.every(isTarget)) return 'partial'
  return 'none'
}

function SegmentLabel({ children, kind }: { children: string; kind: 'empty' | 'name' }) {
  return (
    <Box
      component="span"
      style={{
        display: 'block',
        width: kind === 'empty' ? 34 : 108,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  )
}

function Dot({ color }: { color: string }) {
  return <Box style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', background: color }} />
}

const ScopeToggles = memo(function ScopeToggles({
  labels,
  tooltips,
  states,
  onApply,
}: {
  labels: Record<SlotMode, string>
  tooltips: Record<SlotMode, string>
  states: ScopeStates
  onApply: (mode: SlotMode) => void
}) {
  return (
    <Group gap={4} wrap="nowrap" style={{ flex: '0 0 auto' }}>
      {SLOT_MODES.map((mode) => {
        const state = states[mode]
        const variant = state === 'full' ? 'filled' : state === 'partial' ? 'light' : 'default'
        return (
          <Tooltip key={mode} label={tooltips[mode]} withinPortal multiline w={220}>
            <Button size="compact-xs" px={8} variant={variant} onClick={() => onApply(mode)}>
              {labels[mode]}
            </Button>
          </Tooltip>
        )
      })}
    </Group>
  )
})

const FilterItemRow = memo(function FilterItemRow({
  item,
  presence,
  mode,
  isDefault,
  characterName,
  incomingName,
  noItemName,
  emptyLabel,
  characterLabel,
  incomingLabel,
  ariaLabel,
  dotLabels,
  onSetSlotMode,
}: {
  item: FilterItem
  presence: { inCharacter?: boolean; inHover?: boolean }
  mode: SlotMode
  isDefault: boolean
  characterName: string
  incomingName: string
  noItemName: string
  emptyLabel: string
  characterLabel: string
  incomingLabel: string
  ariaLabel: string
  dotLabels: { inCharacter: string; inHover: string; none: string }
  onSetSlotMode: (key: string, mode: SlotMode) => void
}) {
  const dotColor = presence.inCharacter
    ? DOT_COLORS.inCharacter
    : presence.inHover
      ? DOT_COLORS.inHover
      : DOT_COLORS.none
  const dotTitle = presence.inCharacter ? dotLabels.inCharacter : presence.inHover ? dotLabels.inHover : dotLabels.none
  const safeCharacterName = characterName || noItemName
  const safeIncomingName = incomingName || noItemName
  const segmentData = useMemo(
    () => [
      { value: 'original', label: <SegmentLabel kind="name">{compactLabel(safeCharacterName, 22)}</SegmentLabel> },
      { value: 'incoming', label: <SegmentLabel kind="name">{compactLabel(safeIncomingName, 22)}</SegmentLabel> },
      { value: 'empty', label: <SegmentLabel kind="empty">{emptyLabel}</SegmentLabel> },
    ],
    [emptyLabel, safeCharacterName, safeIncomingName],
  )
  const tooltip = `${characterLabel}: ${safeCharacterName} / ${incomingLabel}: ${safeIncomingName}`

  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      gap="xs"
      px={6}
      py={4}
      style={{
        borderRadius: 6,
        background: isDefault ? undefined : 'var(--mantine-color-blue-light)',
      }}
    >
      <Group gap={6} wrap="nowrap" style={{ width: 78, flex: '0 0 78px', minWidth: 0 }}>
        <Box title={dotTitle} style={{ display: 'flex' }}>
          <Dot color={dotColor} />
        </Box>
        <Text size="xs" truncate>
          {item.data?.Description || item.data?.Name || item.key}
        </Text>
      </Group>
      <Tooltip label={tooltip} withinPortal multiline w={260}>
        <SegmentedControl
          size="xs"
          value={mode}
          data={segmentData}
          onChange={(value) => onSetSlotMode(item.key, normalizeSlotMode(value))}
          aria-label={ariaLabel}
          style={{ flex: '1 1 auto', minWidth: 0, maxWidth: '100%' }}
          styles={{
            root: { overflow: 'hidden' },
            control: { flex: '0 1 auto', minWidth: 0 },
            label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }}
        />
      </Tooltip>
    </Group>
  )
})

const FilterGroupCard = memo(function FilterGroupCard({
  group,
  isCollapsed,
  hiddenBadge,
  emptyItemsLabel,
  applyMode,
  slotControlMap,
  presence,
  characterPartNameBySlot,
  incomingPartNameBySlot,
  scopeStates,
  slotLabels,
  slotTooltips,
  rowLabels,
  dotLabels,
  onToggleCollapsed,
  onApplyGroupMode,
  onSetSlotMode,
}: FilterGroupCardProps) {
  const items = group.itemList ?? EMPTY_ITEMS
  const applyGroupMode = useCallback((mode: SlotMode) => onApplyGroupMode(group.groupID, mode), [group.groupID, onApplyGroupMode])

  return (
    <Paper withBorder radius="sm" p="xs">
      <Group justify="space-between" wrap="nowrap" gap={4}>
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={() => onToggleCollapsed(group.groupID)}
          leftSection={isCollapsed ? '>' : 'v'}
          style={{ minWidth: 0, flex: 1 }}
          justify="flex-start"
        >
          <Text size="xs" truncate>
            {group.displayName || group.groupID}
            {group.isHiddenGroup ? ` (${hiddenBadge})` : ''}
          </Text>
        </Button>
        <ScopeToggles labels={slotLabels} tooltips={slotTooltips} states={scopeStates} onApply={applyGroupMode} />
      </Group>

      {!isCollapsed && (
        <Stack gap={4} mt="xs">
          {items.map((item) => {
            const itemPresence = presence[item.key] || EMPTY_PRESENCE
            const mode = slotModeFor(slotControlMap, item.key)
            const isDefault =
              mode === defaultModeFor(applyMode, !!itemPresence.inCharacter, !!itemPresence.inHover)
            return (
              <FilterItemRow
                key={item.key}
                item={item}
                presence={itemPresence}
                mode={mode}
                isDefault={isDefault}
                characterName={characterPartNameBySlot[item.key]}
                incomingName={incomingPartNameBySlot[item.key]}
                noItemName={rowLabels.noItemName}
                emptyLabel={slotLabels.empty}
                characterLabel={rowLabels.characterItemName}
                incomingLabel={rowLabels.incomingItemName}
                ariaLabel={rowLabels.slotModeControlAriaLabel}
                dotLabels={dotLabels}
                onSetSlotMode={onSetSlotMode}
              />
            )
          })}
          {items.length === 0 && (
            <Text size="xs" c="dimmed">
              {emptyItemsLabel}
            </Text>
          )}
        </Stack>
      )}
    </Paper>
  )
}, areFilterGroupCardPropsEqual)

function areScopeStatesEqual(a: ScopeStates, b: ScopeStates) {
  return a.original === b.original && a.incoming === b.incoming && a.empty === b.empty
}

function areGroupSlotModesEqual(group: FilterGroup, a: SlotControlMap, b: SlotControlMap) {
  for (const item of group.itemList ?? EMPTY_ITEMS) {
    if (!item.key) continue
    if (normalizeSlotMode(a[item.key]?.mode) !== normalizeSlotMode(b[item.key]?.mode)) return false
  }
  return true
}

function areFilterGroupCardPropsEqual(prev: FilterGroupCardProps, next: FilterGroupCardProps) {
  if (
    prev.group !== next.group ||
    prev.isCollapsed !== next.isCollapsed ||
    prev.hiddenBadge !== next.hiddenBadge ||
    prev.emptyItemsLabel !== next.emptyItemsLabel ||
    prev.applyMode !== next.applyMode ||
    prev.presence !== next.presence ||
    prev.characterPartNameBySlot !== next.characterPartNameBySlot ||
    prev.incomingPartNameBySlot !== next.incomingPartNameBySlot ||
    prev.slotLabels !== next.slotLabels ||
    prev.slotTooltips !== next.slotTooltips ||
    prev.rowLabels !== next.rowLabels ||
    prev.dotLabels !== next.dotLabels ||
    prev.onToggleCollapsed !== next.onToggleCollapsed ||
    prev.onApplyGroupMode !== next.onApplyGroupMode ||
    prev.onSetSlotMode !== next.onSetSlotMode ||
    !areScopeStatesEqual(prev.scopeStates, next.scopeStates)
  ) {
    return false
  }
  return areGroupSlotModesEqual(next.group, prev.slotControlMap, next.slotControlMap)
}

export function FilterManager() {
  const { t } = useTranslation()
  const filterSnapshot = useFsSelector((fs) => fs.filterSnapshot)
  const rawApplyMode = useFsSelector((fs) => fs.defaultReplaceMode)
  const slotControlMap = useFsSelector((fs) => fs.slotControlMap) || EMPTY_SLOT_CONTROL_MAP
  const characterItem = (useFsSelector((fs) => fs.characterItem) as WardrobePart[]) || EMPTY_PARTS
  const activeItemData = (useFsSelector((fs) => fs.activeItem?.data) as WardrobePart[]) || EMPTY_PARTS
  const character = useFsSelector((fs) => fs.character)

  const [legendOpen, setLegendOpen] = useState(false)
  const [showAllSlots, setShowAllSlots] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const applyMode = normalizeReplaceMode(rawApplyMode)
  const allGroups = (filterSnapshot?.groups as FilterGroup[] | undefined) ?? EMPTY_GROUPS
  const visibleGroups = (filterSnapshot?.visibleGroups as FilterGroup[] | undefined) ?? EMPTY_GROUPS
  const snapshotItems = (filterSnapshot?.items as FilterItem[] | undefined) ?? EMPTY_ITEMS

  const presence = useMemo(() => buildSlotPresenceMap(characterItem, activeItemData), [activeItemData, characterItem])
  const characterPartNameBySlot = useMemo(
    () => buildPartNameMapBySlot(characterItem, character),
    [character, characterItem],
  )
  const incomingPartNameBySlot = useMemo(
    () => buildPartNameMapBySlot(activeItemData, character),
    [activeItemData, character],
  )

  const knownSlotKeys = useMemo(
    () => buildKnownSlotKeys(allGroups, snapshotItems, slotControlMap, characterItem, activeItemData),
    [activeItemData, allGroups, characterItem, slotControlMap, snapshotItems],
  )
  const presenceSets = useMemo(
    () => ({
      inCharacter: new Set(characterItem.map(getGroupNameFromPart).filter(Boolean)),
      inIncoming: new Set(activeItemData.map(getGroupNameFromPart).filter(Boolean)),
    }),
    [activeItemData, characterItem],
  )

  const globalScopeStates = useMemo(() => {
    const next = { ...EMPTY_SCOPE_STATES }
    for (const mode of SLOT_MODES) {
      next[mode] = scopeModeState(knownSlotKeys, mode, slotControlMap, presenceSets.inCharacter, presenceSets.inIncoming)
    }
    return next
  }, [knownSlotKeys, presenceSets.inCharacter, presenceSets.inIncoming, slotControlMap])

  const groupScopeStates = useMemo(() => {
    const map = new Map<string, ScopeStates>()
    for (const group of allGroups) {
      const keys = (group.itemList ?? EMPTY_ITEMS).map((item) => item.key).filter(Boolean)
      const states = { ...EMPTY_SCOPE_STATES }
      for (const mode of SLOT_MODES) {
        states[mode] = scopeModeState(keys, mode, slotControlMap, presenceSets.inCharacter, presenceSets.inIncoming)
      }
      map.set(group.groupID, states)
    }
    return map
  }, [allGroups, presenceSets.inCharacter, presenceSets.inIncoming, slotControlMap])

  const displayGroups = useMemo(
    () =>
      (showAllSlots ? allGroups : visibleGroups)
        .map((group) =>
          showAllSlots
            ? group
            : {
                ...group,
                itemList: (group.itemList ?? EMPTY_ITEMS).filter((item) => {
                  if (!item.key) return false
                  const itemPresence = presence[item.key] || EMPTY_PRESENCE
                  return !!(itemPresence.inCharacter || itemPresence.inHover)
                }),
              },
        )
        .filter((group) => showAllSlots || (group.itemList ?? EMPTY_ITEMS).length > 0),
    [allGroups, presence, showAllSlots, visibleGroups],
  )

  const overrideCount = useMemo(() => {
    if (applyMode === 'preserve') return 0
    let count = 0
    for (const group of allGroups) {
      for (const item of group.itemList ?? EMPTY_ITEMS) {
        if (!item.key) continue
        const itemPresence = presence[item.key] || EMPTY_PRESENCE
        const mode = slotModeFor(slotControlMap, item.key)
        if (mode !== defaultModeFor(applyMode, !!itemPresence.inCharacter, !!itemPresence.inHover)) count += 1
      }
    }
    return count
  }, [allGroups, applyMode, presence, slotControlMap])

  const slotLabels = useMemo(
    () => ({
      original: t('filterManager.slotModeShortOriginal'),
      incoming: t('filterManager.slotModeShortIncoming'),
      empty: t('filterManager.slotModeShortEmpty'),
    }),
    [t],
  )
  const slotTooltips = useMemo(
    () => ({
      original: t(`filterManager.${tipKey.original}`),
      incoming: t(`filterManager.${tipKey.incoming}`),
      empty: t(`filterManager.${tipKey.empty}`),
    }),
    [t],
  )
  const rowLabels = useMemo(
    () => ({
      noItemName: t('filterManager.noItemName'),
      characterItemName: t('filterManager.characterItemName'),
      incomingItemName: t('filterManager.incomingItemName'),
      slotModeControlAriaLabel: t('filterManager.slotModeControlAriaLabel'),
    }),
    [t],
  )
  const dotLabels = useMemo(
    () => ({
      inCharacter: t('filterManager.inCharacter'),
      inHover: t('filterManager.inHover'),
      none: t('filterManager.dotNone'),
    }),
    [t],
  )

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])
  const collapseAllGroups = useCallback(() => {
    setCollapsed(new Set(displayGroups.map((group) => group.groupID)))
  }, [displayGroups])
  const expandAllGroups = useCallback(() => {
    setCollapsed(new Set())
  }, [])
  const setDefaultReplaceMode = useCallback((value: string) => {
    getFs().setDefaultReplaceMode(value)
  }, [])
  const applyAllMode = useCallback((mode: SlotMode) => {
    getFs().smartSetAllMode(mode)
  }, [])
  const applyGroupMode = useCallback((groupID: string, mode: SlotMode) => {
    getFs().smartSetGroupMode(groupID, mode)
  }, [])
  const setSlotMode = useCallback((key: string, mode: SlotMode) => {
    getFs().setSlotMode(key, mode)
  }, [])

  return (
    <Stack gap="sm" h="100%" style={{ minHeight: 0 }} aria-label={t('filterManager.ariaLabel')}>
      <Paper withBorder radius="sm" p="xs">
        <Text size="xs" fw={600} mb={6}>
          {t('filterManager.defaultReplaceModeLabel')}
        </Text>
        <SegmentedControl
          fullWidth
          size="xs"
          value={applyMode}
          onChange={setDefaultReplaceMode}
          data={REPLACE_MODES.map((mode) => ({ value: mode, label: t(`filterManager.${replaceLabelKey[mode]}`) }))}
        />
        <Text size="xs" c="dimmed" mt={6}>
          {t(`filterManager.${replaceDescKey[applyMode]}`)} / {t('filterManager.autoApplyHint')}
        </Text>
      </Paper>

      <Group justify="space-between" align="center" wrap="nowrap">
        <Text size="xs" fw={600}>
          {t('filterManager.sectionGlobal')}
        </Text>
        <ScopeToggles labels={slotLabels} tooltips={slotTooltips} states={globalScopeStates} onApply={applyAllMode} />
      </Group>

      <Group justify="space-between" wrap="nowrap" gap="xs" style={{ display: 'none' }}>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm">{t('filterManager.sectionAdvanced')}</Text>
          {overrideCount > 0 && (
            <Text size="xs" c="blue">
              / {t('filterManager.overrideCount', { count: overrideCount })}
            </Text>
          )}
        </Group>
        {overrideCount > 0 && (
          <Button
            variant="subtle"
            color="gray"
            size="compact-xs"
            style={{ flex: '0 0 auto' }}
            onClick={() => getFs().reapplyDefaultMode()}
          >
            {t('filterManager.resetToDefault')}
          </Button>
        )}
      </Group>

      <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
        <Group gap={4} wrap="nowrap">
          <Button size="compact-xs" variant="subtle" onClick={() => setLegendOpen((value) => !value)}>
            {t('filterManager.legendToggle')}
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={collapseAllGroups}>
            {t('filterManager.collapseAllGroups')}
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={expandAllGroups}>
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
        <Paper withBorder radius="sm" p="xs" bg="var(--mantine-color-default-hover)">
          <Stack gap={2}>
            {SLOT_MODES.map((mode) => (
              <Text key={mode} size="xs">
                <Text span fw={600}>
                  {slotLabels[mode]}
                </Text>{' '}
                <Text span c="dimmed">
                  {t(`filterManager.modeDesc${cap(mode)}`)}
                </Text>
              </Text>
            ))}
            <Group gap="md" mt={4}>
              <Group gap={4}>
                <Dot color={DOT_COLORS.inCharacter} />
                <Text size="xs" c="dimmed">
                  {dotLabels.inCharacter}
                </Text>
              </Group>
              <Group gap={4}>
                <Dot color={DOT_COLORS.inHover} />
                <Text size="xs" c="dimmed">
                  {dotLabels.inHover}
                </Text>
              </Group>
              <Group gap={4}>
                <Dot color={DOT_COLORS.none} />
                <Text size="xs" c="dimmed">
                  {dotLabels.none}
                </Text>
              </Group>
            </Group>
          </Stack>
        </Paper>
      </Collapse>

      <Box style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {displayGroups.length === 0 ? (
          <Text c="dimmed" size="sm" ta="center" py="md">
            {t('filterManager.emptyGroups')}
          </Text>
        ) : (
          <Stack gap="xs">
            {displayGroups.map((group) => (
              <FilterGroupCard
                key={group.groupID}
                group={group}
                isCollapsed={collapsed.has(group.groupID)}
                hiddenBadge={t('filterManager.hiddenBadge')}
                emptyItemsLabel={t('filterManager.emptyItems')}
                applyMode={applyMode}
                slotControlMap={slotControlMap}
                presence={presence}
                characterPartNameBySlot={characterPartNameBySlot}
                incomingPartNameBySlot={incomingPartNameBySlot}
                scopeStates={groupScopeStates.get(group.groupID) ?? EMPTY_SCOPE_STATES}
                slotLabels={slotLabels}
                slotTooltips={slotTooltips}
                rowLabels={rowLabels}
                dotLabels={dotLabels}
                onToggleCollapsed={toggleCollapsed}
                onApplyGroupMode={applyGroupMode}
                onSetSlotMode={setSlotMode}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
