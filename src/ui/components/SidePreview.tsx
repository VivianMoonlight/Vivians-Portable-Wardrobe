import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Select, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { hostWindow } from '@/utils/host-window.js'
import { ExternalAdapter } from '@/utils/external_adapters.js'
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

/**
 * Character preview canvas for the currently active/previewed outfit.
 * Re-renders on previewItem change and on container resize. Ported from
 * SidePreview.vue.
 *
 * When `showApply` is set, a primary "apply to character" button is rendered
 * here so the core action stays reachable even when the Filter panel (its
 * previous home) is hidden.
 */
export function SidePreview({ showApply = false }: SidePreviewProps) {
  const { t } = useTranslation()
  const previewItem = useFsSelector((fs) => fs.previewItem)
  const selectedCharacter = useFsSelector((fs) => fs.character)
  const dialog = useDialog()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewFrameRef = useRef<HTMLDivElement>(null)
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

  const applyCurrent = async () => {
    const ok = getFs().applyCurrentPreviewToCharacter()
    if (!ok) await dialog.alert(t('filterManager.applyFailed'))
  }
  // Re-run the draw effect whenever the preview payload identity changes.
  const previewData = previewItem?.data

  useEffect(() => {
    const store = getFs()
    const canvas = canvasRef.current
    if (!canvas) return
    const target = previewFrameRef.current

    let disposed = false

    const update = async () => {
      const item = store.previewItem
      if (!item) {
        canvas.style.display = 'none'
        return
      }
      const renderer = store.renderer
      if (!renderer) return
      sizeCanvasToContainer(canvas, target)
      let src: HTMLCanvasElement | null = null
      try {
        renderer.startThumbFor?.(item)
        if (typeof renderer.getThumbCanvas === 'function') {
          src = await renderer.getThumbCanvas(item, { timeout: 3000 })
        } else if (typeof renderer.getCanvas === 'function') {
          src = await renderer.getCanvas(item, { timeout: 3000 })
        } else {
          src = renderer._getCanvas?.(item) ?? null
        }
      } catch {
        src = renderer._getCanvas?.(item) ?? null
      }
      if (disposed) return
      if (src) drawSourceCentered(canvas, src)
      else canvas.style.display = 'none'
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
          if (sizeCanvasToContainer(canvas, target)) void update()
        })
      })
      ro.observe(target)
    }
    void update()

    return () => {
      disposed = true
      if (rafId) hostWindow.cancelAnimationFrame(rafId)
      ro?.disconnect()
    }
  }, [previewData])

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        height: '100%',
        minHeight: 'clamp(180px, 40vh, 320px)',
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
            color: 'var(--mantine-color-dimmed)',
            fontWeight: 700,
            letterSpacing: 0,
          },
          input: {
            background: 'var(--mantine-color-default)',
            borderColor: 'var(--mantine-color-default-border)',
            color: 'var(--mantine-color-text)',
            fontWeight: 600,
          },
          dropdown: {
            background: 'var(--mantine-color-body)',
            borderColor: 'var(--mantine-color-default-border)',
            boxShadow: 'var(--mantine-shadow-md)',
            zIndex: OVERLAY_Z_INDEX,
          },
          option: {
            color: 'var(--mantine-color-text)',
            fontWeight: 600,
          },
        }}
      />
      <Box
        ref={previewFrameRef}
        style={{
          width: '100%',
          flex: '1 1 auto',
          minHeight: 180,
          minWidth: 0,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 10,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
          }}
        />
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

      {showApply && (
        <Button fullWidth disabled={!hasItem} onClick={applyCurrent}>
          {t('filterManager.applyCurrent')}
        </Button>
      )}
    </Box>
  )
}
