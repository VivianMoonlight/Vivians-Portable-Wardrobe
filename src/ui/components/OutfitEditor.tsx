import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Alert, Box, Button, Group, Modal, ScrollArea, Select, Stack, Text, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { getFs, useFsSelector } from '@/stores/hooks'
import { RenderService } from '@/services/RenderService.js'
import { isHiddenBodySlot } from '@/services/hidden-body-slots.js'
import {
  createOutfitDraft, listOutfitParts, removeOutfitAsset, setOutfitAsset, setOutfitColor,
} from '@/services/outfit-editor-model.js'
import { fetchAssetData } from '@/utils/AssetApi.js'
import { retryFailedImagesForOutfit } from '@/utils/RenderApi.js'
import { hostWindow } from '@/utils/host-window.js'
import { drawSourceCentered, sizeCanvasToContainer } from '@/ui/canvas-utils'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { OVERLAY_Z_INDEX } from '@/ui/z-index'
import styles from './OutfitEditor.css?inline'

// The shared confirmation/prompt dialog must sit above this editor.
const EDITOR_Z_INDEX = OVERLAY_Z_INDEX - 2

interface EditorPart {
  Group: string
  Name: string
  Color?: string | string[]
}

interface AssetGroupData {
  Name: string
  Description?: string
  Category?: string
  AllowNone?: boolean
  Asset?: Array<{ Name: string; Description?: string }>
}

interface SourceSnapshot {
  id: string
  name: string
  type: string
  tagIds: string[]
  cloudSync: boolean
  rev: [number, string]
  data: EditorPart[]
}

function readSource(id: string): SourceSnapshot | null {
  const fs = getFs()
  const outfit = fs.outfits.find((entry) => entry.id === id)
  if (!outfit?.rev) return null
  return {
    id, name: outfit.name, type: outfit.type, tagIds: [...outfit.tagIds],
    cloudSync: outfit.cloudSync, rev: [outfit.rev[0], outfit.rev[1]],
    data: createOutfitDraft(outfit.data) as EditorPart[],
  }
}

function sourceChanged(snapshot: SourceSnapshot): boolean {
  const current = getFs().outfits.find((entry) => entry.id === snapshot.id)
  return !current?.rev || current.rev[0] !== snapshot.rev[0] || current.rev[1] !== snapshot.rev[1]
}

function assetList(group: AssetGroupData | undefined) {
  const assets = group?.Asset
  return Array.isArray(assets) ? assets : []
}

function getAsset(group: AssetGroupData | undefined, assetName: string) {
  return assetList(group).find((asset) => asset?.Name === assetName)
}

function DraftPreview({ draft }: { draft: EditorPart[] }) {
  const { t } = useTranslation()
  const renderer = useMemo(() => new RenderService({ drawCallbacks: getFs().renderer.drawCallbacks } as any), [])
  const item = useMemo(() => ({ data: draft }), [draft])
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const frame = frameRef.current
    const canvas = canvasRef.current
    if (!frame || !canvas) return
    let source: HTMLCanvasElement | null = null
    let disposed = false
    let frameId = 0
    const draw = () => {
      sizeCanvasToContainer(canvas, frame)
      if (source) drawSourceCentered(canvas, source)
      else canvas.style.display = 'none'
    }
    draw()
    setStatus('loading')
    frame.setAttribute('aria-busy', 'true')
    const unsubscribe = renderer.observe(item, (nextSource: HTMLCanvasElement | null, nextStatus: { state: string }) => {
      if (disposed) return
      source = nextSource
      setStatus(nextStatus.state === 'error' ? 'error' : nextStatus.state === 'ready' ? 'ready' : 'loading')
      frame.setAttribute('aria-busy', String(nextStatus.state === 'loading'))
      draw()
    }, { preview: true })
    const resize = typeof hostWindow.ResizeObserver === 'function'
      ? new hostWindow.ResizeObserver(() => {
        if (frameId) hostWindow.cancelAnimationFrame(frameId)
        frameId = hostWindow.requestAnimationFrame(() => { frameId = 0; draw() })
      })
      : null
    resize?.observe(frame)
    return () => {
      disposed = true
      unsubscribe()
      resize?.disconnect()
      if (frameId) hostWindow.cancelAnimationFrame(frameId)
      renderer.removeCanvas(item)
    }
  }, [renderer, item, attempt])

  return <Box className="vpw-outfit-editor-preview" ref={frameRef}>
    <canvas ref={canvasRef} aria-label={t('outfitEditor.preview')} />
    {status === 'loading' && <Text className="vpw-outfit-editor-preview-message" size="xs" c="dimmed">{t('outfitEditor.previewLoading')}</Text>}
    {status === 'error' && <Stack className="vpw-outfit-editor-preview-message" gap="xs" align="center">
      <Text size="xs" c="dimmed">{t('outfitEditor.previewFailed')}</Text>
      <Button size="compact-xs" variant="light" onClick={() => {
        retryFailedImagesForOutfit(draft)
        setAttempt((value) => value + 1)
      }}>{t('outfitEditor.retryPreview')}</Button>
    </Stack>}
  </Box>
}

function Editor({ outfitId, onClose, mobile }: { outfitId: string; onClose: () => void; mobile: boolean }) {
  const { t } = useTranslation()
  const dialog = useDialog()
  const backRef = useRef<HTMLButtonElement>(null)
  const [source] = useState(() => readSource(outfitId))
  const [draft, setDraft] = useState<EditorPart[]>(() => source ? createOutfitDraft(source.data) as EditorPart[] : [])
  const [groups, setGroups] = useState<AssetGroupData[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string | null>(() =>
    source ? (listOutfitParts(source.data) as EditorPart[])[0]?.Group ?? null : null)
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [colors, setColors] = useState<string[]>([''])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileTreeVersion = useFsSelector((fs) => fs.fileTreeVersion)
  const stale = !!source && sourceChanged(source)
  const dirty = useMemo(() => !!source && JSON.stringify(draft) !== JSON.stringify(source.data), [draft, source])
  const parts = useMemo(() => listOutfitParts(draft) as EditorPart[], [draft])
  const currentPart = parts.find((part) => part.Group === selectedGroup)
  const group = groups.find((entry) => entry.Name === selectedGroup)
  const gameWindow = hostWindow as any

  useLayoutEffect(() => { if (mobile) backRef.current?.focus({ preventScroll: true }) }, [mobile])

  useEffect(() => {
    let alive = true
    void fetchAssetData().then((entries: Array<{ key: string; data: AssetGroupData }>) => {
      if (!alive) return
      setGroups(entries.map((entry) => entry.data).filter((entry) =>
        !!entry?.Name && !isHiddenBodySlot(entry.Name) &&
        (!entry.Category || entry.Category === 'Appearance' || entry.Category === 'Item')))
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    setSelectedAsset(currentPart?.Name ?? null)
    const color = currentPart?.Color
    setColors(Array.isArray(color) ? [...color] : [color ?? ''])
  }, [selectedGroup, currentPart?.Name, currentPart?.Color])

  const groupOptions = useMemo(() => groups.map((entry) => ({
    value: entry.Name, label: entry.Description || entry.Name,
  })).sort((a, b) => a.label.localeCompare(b.label)), [groups])
  const assets = useMemo(() => {
    const family = gameWindow.Player?.AssetFamily || 'Female3DCG'
    const list = assetList(group).filter((entry) => {
      if (!entry?.Name) return false
      if (typeof gameWindow.AssetGet !== 'function') return true
      try { return !!gameWindow.AssetGet(family, group?.Name, entry.Name) }
      catch { return false }
    })
    if (currentPart && !list.some((entry) => entry.Name === currentPart.Name)) {
      list.unshift({ Name: currentPart.Name })
    }
    return list.map((entry) => ({ value: entry.Name, label: entry.Description || entry.Name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [group, currentPart?.Name])

  const resolveGroup = (name: string) => groups.find((entry) => entry.Name === name) ?? null
  const resolveAsset = (groupName: string, assetName: string) => {
    const family = gameWindow.Player?.AssetFamily || 'Female3DCG'
    if (typeof gameWindow.AssetGet === 'function') {
      try { return gameWindow.AssetGet(family, groupName, assetName) ?? null }
      catch { return null }
    }
    return getAsset(resolveGroup(groupName) ?? undefined, assetName) ?? null
  }
  const canChooseAsset = !!group && !!selectedGroup && !!selectedAsset
    && selectedAsset !== currentPart?.Name
    && !!resolveAsset(selectedGroup, selectedAsset)

  const describeError = (reason: unknown) => {
    const code = (reason as { code?: string })?.code
    return code && t(`outfitEditor.errors.${code}`, { defaultValue: '' })
      || t('outfitEditor.editFailed', { error: reason instanceof Error ? reason.message : String(reason) })
  }

  const edit = (operation: () => EditorPart[]) => {
    try {
      setError('')
      setDraft(operation())
    } catch (reason) { setError(describeError(reason)) }
  }

  const addOrReplace = () => {
    if (!selectedGroup || !selectedAsset || !canChooseAsset) return
    edit(() => setOutfitAsset(draft, selectedGroup, selectedAsset, { resolveGroup, resolveAsset }) as EditorPart[])
  }

  const remove = () => {
    if (!selectedGroup) return
    edit(() => removeOutfitAsset(draft, selectedGroup, { resolveGroup }) as EditorPart[])
  }

  const updateColor = () => {
    if (!selectedGroup) return
    const values = colors.map((value) => value.trim())
    const color = values.every((value) => !value) ? null
      : values.length === 1 ? values[0] : values
    edit(() => setOutfitColor(draft, selectedGroup, color, { resolveGroup, resolveAsset }) as EditorPart[])
  }

  const closeWithDiscardCheck = async () => {
    if (saving) return
    if (dirty && !await dialog.confirm(t('outfitEditor.discardConfirm'))) return
    onClose()
  }

  const overwrite = async () => {
    if (!source || !dirty || saving) return
    if (sourceChanged(source)) { setError(t('outfitEditor.sourceChanged')); return }
    setSaving(true)
    setError('')
    try {
      await getFs().updateOutfitIfUnchanged(source.id, source.rev, { data: draft })
      onClose()
    } catch (reason) {
      const code = (reason as { code?: string })?.code
      setError(sourceChanged(source) || code === 'outfit-changed'
        ? t('outfitEditor.sourceChanged')
        : t('outfitEditor.saveFailed', { error: reason instanceof Error ? reason.message : String(reason) }))
    } finally { setSaving(false) }
  }

  const saveCopy = async () => {
    if (!source || saving) return
    const name = (await dialog.prompt(t('outfitEditor.newNamePrompt'),
      t('outfitEditor.copyName', { name: source.name })))?.trim()
    if (name === undefined) return
    if (!name) { setError(t('outfitEditor.nameRequired')); return }
    setSaving(true)
    setError('')
    try {
      await getFs().addOutfit({ name, type: source.type, data: draft,
        tagIds: source.tagIds, cloudSync: source.cloudSync })
      onClose()
    } catch (reason) { setError(t('outfitEditor.saveFailed', { error: reason instanceof Error ? reason.message : String(reason) })) }
    finally { setSaving(false) }
  }

  const onEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return
    const target = event.nativeEvent.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement)
    if (target?.closest('[role="listbox"], [role="menu"], [aria-expanded="true"][aria-haspopup]')) return
    event.stopPropagation()
    event.preventDefault()
    void closeWithDiscardCheck()
  }

  const content = <>
    <style>{styles}</style>
    {mobile && <Group className="vpw-outfit-editor-mobile-header" gap="xs" wrap="nowrap">
      <Button ref={backRef} variant="subtle" size="compact-sm" onClick={() => void closeWithDiscardCheck()}>
        {t('outfitEditor.back')}
      </Button>
      <Text fw={600} size="sm" truncate>{source?.name || t('outfitEditor.title')}</Text>
    </Group>}
    {!source ? <Alert color="orange" role="alert">{t('outfitEditor.sourceMissing')}</Alert> : <>
      {stale && <Alert color="orange" role="alert">{t('outfitEditor.sourceChanged')}</Alert>}
      {error && <Alert color="red" role="alert">{error}</Alert>}
      <Box className="vpw-outfit-editor-layout">
        <Box className="vpw-outfit-editor-preview-column">
          <Text size="xs" fw={600}>{t('outfitEditor.preview')}</Text>
          <DraftPreview draft={draft} />
          <Text size="xs" c="dimmed">{t('outfitEditor.previewHint')}</Text>
        </Box>
        <Box className="vpw-outfit-editor-controls">
          <Text size="sm" fw={600}>{t('outfitEditor.parts')}</Text>
          <ScrollArea className="vpw-outfit-editor-parts" type="auto">
            {parts.length ? parts.map((part) => <Button key={part.Group} variant={selectedGroup === part.Group ? 'light' : 'subtle'}
              className="vpw-outfit-editor-part" onClick={() => setSelectedGroup(part.Group)}
              aria-pressed={selectedGroup === part.Group} justify="space-between">
              <span>{groups.find((entry) => entry.Name === part.Group)?.Description || part.Group}</span>
              <span className="vpw-outfit-editor-part-name">{part.Name}</span>
            </Button>) : <Text size="xs" c="dimmed">{t('outfitEditor.noParts')}</Text>}
          </ScrollArea>
          <Box className="vpw-outfit-editor-fields">
            <Select searchable clearable data={groupOptions} value={selectedGroup} onChange={setSelectedGroup}
              label={t('outfitEditor.group')} placeholder={t('outfitEditor.selectGroup')}
              nothingFoundMessage={t('outfitEditor.noGroups')}
              comboboxProps={{ withinPortal: true, zIndex: EDITOR_Z_INDEX + 1 }} />
            <Select searchable clearable data={assets} value={selectedAsset} onChange={setSelectedAsset}
              label={t('outfitEditor.asset')} placeholder={t('outfitEditor.selectAsset')}
              disabled={!group} nothingFoundMessage={t('outfitEditor.noAssets')}
              comboboxProps={{ withinPortal: true, zIndex: EDITOR_Z_INDEX + 1 }} />
            <Group gap="xs" wrap="nowrap">
              <Button size="xs" onClick={addOrReplace} disabled={!canChooseAsset || saving}>
                {currentPart ? t('outfitEditor.replaceAsset') : t('outfitEditor.addAsset')}
              </Button>
              {currentPart && <Button size="xs" variant="default" color="red" onClick={remove}
                disabled={!group || group.AllowNone === false || saving}>
                {t('outfitEditor.removeAsset')}
              </Button>}
            </Group>
            {currentPart && <Stack gap="xs" className="vpw-outfit-editor-colors">
              <Text size="xs" fw={600}>{t('outfitEditor.color')}</Text>
              {colors.map((color, index) => <TextInput key={`${selectedGroup}:${index}`}
                label={colors.length > 1 ? t('outfitEditor.colorLayer', { number: index + 1 }) : undefined}
                aria-label={t('outfitEditor.colorLayer', { number: index + 1 })}
                value={color} onChange={(event) => setColors((before) => before.map((value, i) => i === index ? event.currentTarget.value : value))}
                placeholder={t('outfitEditor.defaultColor')} />)}
              <Group gap="xs">
                <Button size="xs" variant="light" onClick={updateColor} disabled={!group || saving}>{t('outfitEditor.setColor')}</Button>
                <Button size="xs" variant="subtle" onClick={() => {
                  setColors([''])
                  edit(() => setOutfitColor(draft, selectedGroup!, null, { resolveGroup, resolveAsset }) as EditorPart[])
                }} disabled={!group || saving}>{t('outfitEditor.resetColor')}</Button>
              </Group>
            </Stack>}
          </Box>
        </Box>
      </Box>
      <Group className="vpw-outfit-editor-footer" gap="xs" justify="flex-end">
        <Button variant="subtle" onClick={() => void closeWithDiscardCheck()} disabled={saving}>{t('outfitEditor.cancel')}</Button>
        <Button variant="default" onClick={() => void saveCopy()} disabled={saving}>{t('outfitEditor.saveCopy')}</Button>
        <Button onClick={() => void overwrite()} disabled={!dirty || stale || saving} loading={saving}>
          {t('outfitEditor.overwrite')}
        </Button>
      </Group>
    </>}
  </>

  return mobile ? <Box component="section" className="vpw-outfit-editor-page"
    aria-label={t('outfitEditor.title')} onKeyDownCapture={onEscape}
    onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }}>{content}</Box>
    : <Modal opened lockScroll={false} onClose={() => void closeWithDiscardCheck()}
      title={<Text fw={600}>{t('outfitEditor.titleFor', { name: source?.name || '' })}</Text>}
      size={1000} centered radius="md" padding="sm" zIndex={EDITOR_Z_INDEX}
      classNames={{ content: 'vpw-outfit-editor-dialog', body: 'vpw-outfit-editor-body' }}
      closeButtonProps={{ 'aria-label': t('outfitEditor.close') }}
      closeOnEscape={false} onKeyDownCapture={onEscape} returnFocus={false}
      overlayProps={{ backgroundOpacity: 0.4 }}>{content}</Modal>
}

export function OutfitEditorDialog({ outfitId, onClose }: { outfitId: string | null; onClose: () => void }) {
  return outfitId ? <Editor key={outfitId} outfitId={outfitId} onClose={onClose} mobile={false} /> : null
}

export function OutfitEditorPage({ outfitId, onBack }: { outfitId: string; onBack: () => void }) {
  return <Editor key={outfitId} outfitId={outfitId} onClose={onBack} mobile />
}
