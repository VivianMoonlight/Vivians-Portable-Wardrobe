import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Loader, Select, Stack, Text, VisuallyHidden } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { hostWindow } from '@/utils/host-window.js'
import { ExternalAdapter } from '@/utils/external_adapters.js'
import { retryFailedImagesForOutfit } from '@/utils/RenderApi.js'
import { getFs, useFsSelector } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { OVERLAY_Z_INDEX } from '@/ui/z-index'
import { drawSourceCentered, sizeCanvasToContainer } from '@/ui/canvas-utils'

interface SidePreviewProps {
  /** Show the primary "apply to character" action below the preview. */
  showApply?: boolean
}

interface CharacterOption {
  value: string
  label: string
  character: any
}

const gameWindow = hostWindow as any

function getCharacterName(character: any): string {
  const nickname = typeof character?.Nickname === 'string' ? character.Nickname.trim() : ''
  const name = typeof character?.Name === 'string' ? character.Name.trim() : ''
  const memberNumber = character?.MemberNumber !== undefined && character?.MemberNumber !== null
    ? String(character.MemberNumber)
    : ''
  return nickname || name || memberNumber || 'Character'
}

function getCharacterKey(character: any, index: number): string {
  const memberNumber = character?.MemberNumber
  if (memberNumber !== undefined && memberNumber !== null && memberNumber !== '') {
    return `member:${memberNumber}`
  }
  const characterId = character?.CharacterID
  if (characterId) return `id:${characterId}`
  return `slot:${index}`
}

function getRawCharacters(): any[] {
  const chatRoomCharacters = Array.isArray(gameWindow.ChatRoomCharacter) ? gameWindow.ChatRoomCharacter : []
  const candidates = [gameWindow.Player, ...chatRoomCharacters].filter(Boolean)
  const seenKeys = new Set<string>()
  const seenRefs = new Set<any>()
  const unique: any[] = []

  for (const character of candidates) {
    const key = getCharacterKey(character, unique.length)
    if (seenRefs.has(character) || seenKeys.has(key)) continue
    seenRefs.add(character)
    seenKeys.add(key)
    unique.push(character)
  }

  return unique
}

function getSelectableCharacterOptions(): CharacterOption[] {
  const seen = new Set<string>()
  return getRawCharacters()
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => (
      ExternalAdapter.isSelfCharacter(character) ||
      ExternalAdapter.canChangeClothesOnCharacter(character)
    ))
    .map(({ character, index }) => {
      const key = getCharacterKey(character, index)
      const baseName = getCharacterName(character)
      return {
        value: key,
        label: baseName,
        character,
      }
    })
    .filter((option) => {
      if (seen.has(option.value)) return false
      seen.add(option.value)
      return true
    })
}

function areCharacterOptionsEqual(a: CharacterOption[], b: CharacterOption[]): boolean {
  if (a.length !== b.length) return false
  return a.every((option, index) => (
    option.value === b[index]?.value &&
    option.label === b[index]?.label &&
    option.character === b[index]?.character
  ))
}

export function ApplyOutfitButton() {
  const { t } = useTranslation()
  const dialog = useDialog()
  const character = useFsSelector((fs) => fs.character)
  const previewItem = useFsSelector((fs) => fs.previewItem)
  const [applied, setApplied] = useState<{ name: string; preview: unknown; character: unknown } | null>(null)
  const target = character || gameWindow.CurrentCharacter || gameWindow.Player
  const name = target ? getCharacterName(target) : t('sidePreview.noTargetCharacter')

  const applyCurrent = async () => {
    if (getFs().applyCurrentPreviewToCharacter()) setApplied({ name, preview: getFs().previewItem, character })
    else await dialog.alert(t('filterManager.applyFailed'))
  }

  return (
    <Box w="100%">
      <Button fullWidth disabled={!target || !Array.isArray(previewItem?.data)} onClick={applyCurrent}>
        {t('outfitFlow.applyTo', { name })}
      </Button>
      {applied?.preview === previewItem && applied.character === character && <Text role="status" size="xs" c="teal" ta="center" mt={3}>{t('outfitFlow.appliedTo', { name: applied.name })}</Text>}
    </Box>
  )
}

/** Visible BC render updates; resizing only fits the cached canvas. */
export function SidePreview({ showApply = false }: SidePreviewProps) {
  const { t } = useTranslation()
  const previewItem = useFsSelector((fs) => fs.previewItem)
  const selectedCharacter = useFsSelector((fs) => fs.character)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewFrameRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [renderError, setRenderError] = useState(false)
  const [renderAttempt, setRenderAttempt] = useState(0)
  const [characterOptions, setCharacterOptions] = useState<CharacterOption[]>(() => getSelectableCharacterOptions())

  const hasItem = !!previewItem
  const itemName = previewItem?.name ?? ''

  const refreshCharacterOptions = useCallback(() => {
    setCharacterOptions((current) => {
      const next = getSelectableCharacterOptions()
      return areCharacterOptionsEqual(current, next) ? current : next
    })
  }, [])

  useEffect(() => {
    refreshCharacterOptions()
  }, [refreshCharacterOptions])

  const characterSelectData = useMemo(
    () => characterOptions.map(({ value, label }) => ({ value, label })),
    [characterOptions],
  )

  const selectedCharacterValue = useMemo(() => {
    const target = selectedCharacter || gameWindow.CurrentCharacter || gameWindow.Player
    return characterOptions.find((option) => option.character === target)?.value ?? null
  }, [characterOptions, selectedCharacter])

  const onCharacterChange = (value: string | null) => {
    const option = characterOptions.find((entry) => entry.value === value)
    if (!option) return
    void getFs().initialize(option.character, {
      keepSelection: true,
      refreshCharacter: true,
      preserveSlotControls: true,
    })
  }

  const retryPreview = () => {
    retryFailedImagesForOutfit(previewItem?.data)
    getFs().renderer.removeCanvas(previewItem)
    setRenderAttempt((attempt) => attempt + 1)
  }

  useEffect(() => {
    const store = getFs()
    const canvas = canvasRef.current
    const target = previewFrameRef.current
    if (!canvas || !target) return

    let disposed = false
    let inViewport = false
    let source: HTMLCanvasElement | null = null
    let unsubscribe: (() => void) | null = null
    let subscriptionId = 0
    canvas.style.display = 'none'
    setLoading(false)
    setRenderError(false)

    const draw = () => {
      sizeCanvasToContainer(canvas, target)
      if (source) drawSourceCentered(canvas, source)
      else canvas.style.display = 'none'
    }

    const stop = () => {
      subscriptionId += 1
      unsubscribe?.()
      unsubscribe = null
      source = null
      canvas.style.display = 'none'
      canvas.width = 1
      canvas.height = 1
      // Recompute the backing size when the preview becomes visible again.
      delete (canvas as HTMLCanvasElement & { __cssW?: number }).__cssW
      target.removeAttribute('aria-busy')
      if (!disposed) setLoading(false)
    }

    const start = () => {
      if (disposed || unsubscribe || !previewItem) return
      const currentId = ++subscriptionId
      draw()
      unsubscribe = store.renderer.observe(previewItem, (
        nextSource: HTMLCanvasElement | null,
        status: { state: string },
      ) => {
        if (disposed || !inViewport || currentId !== subscriptionId) return
        source = nextSource
        setLoading(status.state === 'loading')
        setRenderError(status.state === 'error')
        target.setAttribute('aria-busy', String(status.state === 'loading'))
        draw()
      }, { preview: true })
    }

    let io: IntersectionObserver | null = null
    if (typeof hostWindow.IntersectionObserver === 'function') {
      io = new hostWindow.IntersectionObserver((entries) => {
        const entry = entries[0]
        inViewport = !!(entry && (entry.isIntersecting || entry.intersectionRatio > 0))
        if (inViewport) start()
        else stop()
      }, { threshold: 0.01 })
      io.observe(target)
    } else {
      inViewport = true
      start()
    }

    let ro: ResizeObserver | null = null
    let rafId = 0
    if (target && typeof hostWindow.ResizeObserver === 'function') {
      ro = new hostWindow.ResizeObserver(() => {
        // Defer to the next frame so writing the canvas size doesn't re-enter the
        // observer synchronously ("ResizeObserver loop … undelivered notifications").
        if (rafId) hostWindow.cancelAnimationFrame(rafId)
        rafId = hostWindow.requestAnimationFrame(() => {
          rafId = 0
          if (inViewport) draw()
        })
      })
      ro.observe(target)
    }
    return () => {
      disposed = true
      stop()
      if (rafId) hostWindow.cancelAnimationFrame(rafId)
      io?.disconnect()
      ro?.disconnect()
    }
  }, [previewItem, renderAttempt])

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        height: '100%',
        minHeight: 0,
        padding: 8,
      }}
    >
      <Select
        data={characterSelectData}
        value={selectedCharacterValue}
        onChange={onCharacterChange}
        label={t('sidePreview.targetCharacter')}
        placeholder={t('sidePreview.noTargetCharacter')}
        aria-label={t('sidePreview.targetCharacter')}
        disabled={characterSelectData.length === 0}
        size="xs"
        comboboxProps={{ withinPortal: true, zIndex: OVERLAY_Z_INDEX }}
        style={{ width: '100%', flex: '0 0 auto' }}
        styles={{
          label: {
            color: 'var(--vpw-color-dimmed)',
            fontWeight: 700,
            letterSpacing: 0,
          },
          input: {
            background: 'var(--vpw-color-default)',
            borderColor: 'var(--vpw-color-default-border)',
            color: 'var(--vpw-color-text)',
            fontWeight: 600,
          },
          dropdown: {
            background: 'var(--vpw-color-body)',
            borderColor: 'var(--vpw-color-default-border)',
            boxShadow: 'var(--vpw-shadow-md)',
            zIndex: OVERLAY_Z_INDEX,
          },
          option: {
            color: 'var(--vpw-color-text)',
            fontWeight: 600,
          },
        }}
      />
      <Box
        ref={previewFrameRef}
        style={{
          width: '100%',
          flex: '1 1 auto',
          minHeight: 80,
          minWidth: 0,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 10,
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t('sidePreview.ariaLabel')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
          }}
        />
        {loading && <Box role="status">
          <VisuallyHidden>{t('sidePreview.loading', { defaultValue: '正在加载预览' })}</VisuallyHidden>
          <Loader size="sm" aria-hidden style={{ position: 'absolute', right: 12, bottom: 12, pointerEvents: 'none' }} />
        </Box>}
        {renderError && <Stack gap="xs" align="center" justify="center" p="sm" style={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
          <Text role="status" size="xs" c="dimmed" ta="center">{t('sidePreview.renderFailed', { defaultValue: '预览加载失败，请重试' })}</Text>
          <Button variant="light" size="compact-xs" onClick={retryPreview}>{t('sidePreview.retry', { defaultValue: '重新加载预览' })}</Button>
        </Stack>}
      </Box>
      {hasItem ? (
        <Text size="sm" fw={600} truncate w="100%" ta="center">
          {itemName}
        </Text>
      ) : (
        <Text size="sm" c="dimmed" ta="center">
          {t('sidePreview.hint')}
        </Text>
      )}

      {showApply && <ApplyOutfitButton />}
    </Box>
  )
}
