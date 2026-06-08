import { useState } from 'react'
import { Box, Button, Checkbox, Collapse, Group, Paper, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useFs } from '@/stores/hooks'

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

// Three explicit slot states (no more lazy `auto`).
const SLOT_MODES: SlotMode[] = ['original', 'incoming', 'empty']
const SLOT_CONTROL_MODES: SlotMode[] = ['original', 'incoming', 'empty']
const REPLACE_MODES: ReplaceMode[] = ['preserve', 'fill-empty', 'merge-replace', 'full-replace']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
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

const compactLabel = (value: string, max = 18) => {
  if (!value) return value
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}...` : value
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

// Mirror of the store's computeModeFromReplace — used only to detect which slots
// deviate from the default-mode baseline ("customized").
function defaultModeFor(replaceMode: ReplaceMode, inChar: boolean, inInc: boolean): SlotMode {
  if (replaceMode === 'preserve') return 'empty'
  if (replaceMode === 'fill-empty') return inChar ? 'original' : inInc ? 'incoming' : 'empty'
  if (replaceMode === 'full-replace') return inInc ? 'incoming' : 'empty'
  return inInc ? 'incoming' : inChar ? 'original' : 'empty'
}

export function FilterManager() {
  const { t } = useTranslation()
  const fs = useFs()
  const [legendOpen, setLegendOpen] = useState(false)
  const [showAllSlots, setShowAllSlots] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const snapshot = (fs as any).filterSnapshot ?? {}
  const allGroups: FilterGroup[] = snapshot.groups ?? []
  const visibleGroups: FilterGroup[] = snapshot.visibleGroups ?? []
  const applyMode: ReplaceMode = (fs as any).defaultReplaceMode || 'merge-replace'
  const presence = (fs as any).slotPresenceMap || {}
  const characterPartNameBySlot = (fs as any).characterPartNameBySlot || {}
  const incomingPartNameBySlot = (fs as any).incomingPartNameBySlot || {}

  const slotMode = (key: string): SlotMode => (fs as any).getSlotControlState(key).mode
  const isRelevant = (key: string) => {
    const p = presence[key] || {}
    return !!(p.inCharacter || p.inHover)
  }

  // Count slots manually moved away from the default-mode baseline.
  const overrideCount = allGroups.reduce((acc, g) => {
    if (applyMode === 'preserve') return acc
    for (const it of g.itemList ?? []) {
      if (!it.key) continue
      const p = presence[it.key] || {}
      if (slotMode(it.key) !== defaultModeFor(applyMode, !!p.inCharacter, !!p.inHover)) acc += 1
    }
    return acc
  }, 0)

  const shortLabel = (mode: SlotMode) => t(`filterManager.slotModeShort${cap(mode)}`)
  const modeDesc = (mode: SlotMode) => t(`filterManager.modeDesc${cap(mode)}`)
  const getSegmentData = (characterName: string, incomingName: string) => [
    { value: 'original', label: <SegmentLabel kind="name">{compactLabel(characterName, 22)}</SegmentLabel> },
    { value: 'incoming', label: <SegmentLabel kind="name">{compactLabel(incomingName, 22)}</SegmentLabel> },
    { value: 'empty', label: <SegmentLabel kind="empty">{shortLabel('empty')}</SegmentLabel> },
  ]

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const collapseAllGroups = () => {
    setCollapsed(new Set(displayGroups.map((group) => group.groupID)))
  }

  const expandAllGroups = () => {
    setCollapsed(new Set())
  }

  // Escalating original/outfit/empty toggle row (global or per-group).
  const ScopeToggles = ({
    getState,
    onApply,
  }: {
    getState: (mode: SlotMode) => ScopeState
    onApply: (mode: SlotMode) => void
  }) => (
    <Group gap={4} wrap="nowrap" style={{ flex: '0 0 auto' }}>
      {SLOT_MODES.map((mode) => {
        const state = getState(mode)
        const variant = state === 'full' ? 'filled' : state === 'partial' ? 'light' : 'default'
        return (
          <Tooltip key={mode} label={t(`filterManager.${tipKey[mode]}`)} withinPortal multiline w={220}>
            <Button size="compact-xs" px={8} variant={variant} onClick={() => onApply(mode)}>
              {shortLabel(mode)}
            </Button>
          </Tooltip>
        )
      })}
    </Group>
  )

  const displayGroups: FilterGroup[] = (showAllSlots ? allGroups : visibleGroups)
    .map((g) =>
      showAllSlots ? g : { ...g, itemList: (g.itemList ?? []).filter((it) => it.key && isRelevant(it.key)) },
    )
    .filter((g) => showAllSlots || (g.itemList ?? []).length > 0)

  return (
    <Stack gap="sm" h="100%" style={{ minHeight: 0 }} aria-label={t('filterManager.ariaLabel')}>
      {/* ── Default replacement mode (auto-applied on outfit selection) ── */}
      <Paper withBorder radius="sm" p="xs">
        <Text size="xs" fw={600} mb={6}>
          {t('filterManager.defaultReplaceModeLabel')}
        </Text>
        <SegmentedControl
          fullWidth
          size="xs"
          value={applyMode}
          onChange={(v) => v && (fs as any).setDefaultReplaceMode(v)}
          data={REPLACE_MODES.map((mode) => ({ value: mode, label: t(`filterManager.${replaceLabelKey[mode]}`) }))}
        />
        <Text size="xs" c="dimmed" mt={6}>
          {t(`filterManager.${replaceDescKey[applyMode]}`)} · {t('filterManager.autoApplyHint')}
        </Text>
      </Paper>

      {/* ── Global escalating toggles ── */}
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text size="xs" fw={600}>
          {t('filterManager.sectionGlobal')}
        </Text>
        <ScopeToggles
          getState={(mode) => (fs as any).getAllModeState(mode)}
          onApply={(mode) => (fs as any).smartSetAllMode(mode)}
        />
      </Group>

      <Group justify="space-between" wrap="nowrap" gap="xs" style={{ display: 'none' }}>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm">{t('filterManager.sectionAdvanced')}</Text>
          {overrideCount > 0 && (
            <Text size="xs" c="blue">
              · {t('filterManager.overrideCount', { count: overrideCount })}
            </Text>
          )}
        </Group>
        {overrideCount > 0 && (
          <Button
            variant="subtle"
            color="gray"
            size="compact-xs"
            style={{ flex: '0 0 auto' }}
            onClick={() => (fs as any).reapplyDefaultMode()}
          >
            {t('filterManager.resetToDefault')}
          </Button>
        )}
      </Group>

      <>
        <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
          <Group gap={4} wrap="nowrap">
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setLegendOpen((v) => !v)}
            >
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
            onChange={(e) => setShowAllSlots(e.currentTarget.checked)}
          />
        </Group>

          <Collapse in={legendOpen}>
            <Paper withBorder radius="sm" p="xs" bg="var(--mantine-color-default-hover)">
              <Stack gap={2}>
                {SLOT_MODES.map((mode) => (
                  <Text key={mode} size="xs">
                    <Text span fw={600}>
                      {shortLabel(mode)}
                    </Text>{' '}
                    <Text span c="dimmed">
                      {modeDesc(mode)}
                    </Text>
                  </Text>
                ))}
                <Group gap="md" mt={4}>
                  <Group gap={4}>
                    <Dot color={DOT_COLORS.inCharacter} />
                    <Text size="xs" c="dimmed">
                      {t('filterManager.inCharacter')}
                    </Text>
                  </Group>
                  <Group gap={4}>
                    <Dot color={DOT_COLORS.inHover} />
                    <Text size="xs" c="dimmed">
                      {t('filterManager.inHover')}
                    </Text>
                  </Group>
                  <Group gap={4}>
                    <Dot color={DOT_COLORS.none} />
                    <Text size="xs" c="dimmed">
                      {t('filterManager.dotNone')}
                    </Text>
                  </Group>
                </Group>
              </Stack>
            </Paper>
          </Collapse>

          {/* Groups */}
          <Box style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            {displayGroups.length === 0 ? (
              <Text c="dimmed" size="sm" ta="center" py="md">
                {t('filterManager.emptyGroups')}
              </Text>
            ) : (
              <Stack gap="xs">
                {displayGroups.map((group) => {
                  const isCollapsed = collapsed.has(group.groupID)
                  const items = group.itemList ?? []
                  return (
                    <Paper key={group.groupID} withBorder radius="sm" p="xs">
                      <Group justify="space-between" wrap="nowrap" gap={4}>
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          onClick={() => toggleCollapsed(group.groupID)}
                          leftSection={isCollapsed ? '▸' : '▾'}
                          style={{ minWidth: 0, flex: 1 }}
                          justify="flex-start"
                        >
                          <Text size="xs" truncate>
                            {group.displayName || group.groupID}
                            {group.isHiddenGroup ? ` (${t('filterManager.hiddenBadge')})` : ''}
                          </Text>
                        </Button>
                        <ScopeToggles
                          getState={(mode) => (fs as any).getGroupModeState(group.groupID, mode)}
                          onApply={(mode) => (fs as any).smartSetGroupMode(group.groupID, mode)}
                        />
                      </Group>

                      {!isCollapsed && (
                        <Stack gap={4} mt="xs">
                          {items.map((it) => {
                            const p = presence[it.key] || {}
                            const dotColor = p.inCharacter
                              ? DOT_COLORS.inCharacter
                              : p.inHover
                                ? DOT_COLORS.inHover
                                : DOT_COLORS.none
                            const dotTitle = p.inCharacter
                              ? t('filterManager.inCharacter')
                              : p.inHover
                                ? t('filterManager.inHover')
                                : t('filterManager.dotNone')
                            const mode = slotMode(it.key)
                            const isDefault =
                              mode === defaultModeFor(applyMode, !!p.inCharacter, !!p.inHover)
                            const characterName = characterPartNameBySlot[it.key] || t('filterManager.noItemName')
                            const incomingName = incomingPartNameBySlot[it.key] || t('filterManager.noItemName')
                            return (
                              <Group
                                key={it.key}
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
                                    {it.data?.Description || it.data?.Name || it.key}
                                  </Text>
                                </Group>
                                <Tooltip
                                  label={`${t('filterManager.characterItemName')}: ${characterName} / ${t('filterManager.incomingItemName')}: ${incomingName}`}
                                  withinPortal
                                  multiline
                                  w={260}
                                >
                                  <SegmentedControl
                                    size="xs"
                                    value={mode}
                                    data={getSegmentData(characterName, incomingName)}
                                    onChange={(value) => (fs as any).setSlotMode(it.key, value)}
                                    aria-label={t('filterManager.slotModeControlAriaLabel')}
                                    style={{ flex: '1 1 auto', minWidth: 0, maxWidth: '100%' }}
                                    styles={{
                                      root: {
                                        overflow: 'hidden',
                                      },
                                      control: {
                                        flex: '0 1 auto',
                                        minWidth: 0,
                                      },
                                      label: {
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      },
                                    }}
                                  />
                                </Tooltip>
                              </Group>
                            )
                          })}
                          {items.length === 0 && (
                            <Text size="xs" c="dimmed">
                              {t('filterManager.emptyItems')}
                            </Text>
                          )}
                        </Stack>
                      )}
                    </Paper>
                  )
                })}
              </Stack>
            )}
          </Box>
      </>
    </Stack>
  )
}
