import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import LZString from 'lz-string'
import { hostWindow, doc } from '@/utils/host-window.js'
import { ExternalAdapter } from '@/utils/external_adapters.js'
import { getFs, type FsCtx } from '@/stores/hooks'
import { useDialog, type DialogApi } from '@/ui/dialog/DialogProvider'

function defaultFilename(prefix: string): string {
  return `${prefix}_${new Date().toISOString().replace(/[:.]/g, '-')}`
}

function downloadJson(payload: unknown, prefix: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = doc.createElement('a')
  try {
    anchor.href = url
    anchor.download = `${defaultFilename(prefix)}.json`
    doc.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    URL.revokeObjectURL(url)
  }
}

async function reportFailure(error: unknown, dialog: DialogApi, t: TFunction): Promise<void> {
  console.error('Wardrobe operation failed', error)
  await dialog.alert(t('library.operationFailed', {
    error: error instanceof Error ? error.message : String(error),
  }))
}

async function reportImported(count: number, dialog: DialogApi, t: TFunction): Promise<void> {
  await dialog.alert(count > 0 ? t('library.imported', { count }) : t('library.nothingImported'))
}

/** Import individual outfits into the selected tag; merge backups through the index. */
async function applyImportedData(
  parsed: any,
  fs: FsCtx,
  dialog: DialogApi,
  t: TFunction,
): Promise<void> {
  if (!parsed) {
    await dialog.alert(t('wardrobeIO.importEmpty'))
    return
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      await reportImported(0, dialog, t)
      return
    }
    const name = await dialog.prompt(t('library.saveNamePrompt'), defaultFilename('imported'))
    if (!name?.trim()) return
    parsed = { name: name.trim(), type: 'outfit', data: parsed }
  }

  try {
    if (parsed.type !== 'folder' && Array.isArray(parsed.data)) {
      const id = await fs.addOutfit({
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : defaultFilename('imported'),
        type: typeof parsed.type === 'string' ? parsed.type : 'outfit',
        data: parsed.data,
        tagIds: fs.selectedTagId && fs.selectedTagId !== 'untagged' ? [fs.selectedTagId] : [],
        cloudSync: typeof parsed.cloudSync === 'boolean' ? parsed.cloudSync : undefined,
      })
      await reportImported(id ? 1 : 0, dialog, t)
      return
    }
    const { count } = await fs.importWardrobe(parsed)
    await reportImported(count, dialog, t)
  } catch (error) {
    await reportFailure(error, dialog, t)
  }
}

export interface WardrobeActions {
  importPlayerWardrobe: () => Promise<void>
  importBCX: () => Promise<void>
  saveBackup: () => void
  saveRecoveryBackup: () => Promise<void>
  importBackup: () => void
  saveCharacterToFolder: () => Promise<void>
}

export function useWardrobeActions(): WardrobeActions {
  const dialog = useDialog()
  const { t } = useTranslation()

  return useMemo<WardrobeActions>(() => {
    const importPlayerWardrobe = async () => {
      const player = (hostWindow as any).Player
      if (!Array.isArray(player?.Wardrobe) || !Array.isArray(player?.WardrobeCharacterNames)) {
        await dialog.alert(t('wardrobeIO.playerWardrobeUnavailable'))
        return
      }
      try {
        const tagName = defaultFilename('Player_Wardrobe')
        const outfits = player.Wardrobe.flatMap((data: unknown, index: number) => {
          if (!Array.isArray(data) || data.length === 0) return []
          const slotName = player.WardrobeCharacterNames[index]
          const name = typeof slotName === 'string' && slotName.trim() ? slotName.trim() : `Outfit_${index}`
          return [{ name, type: 'outfit', data }]
        })
        const { count } = await getFs().importWardrobe({ type: 'folder', name: tagName, children: outfits }, { tagName })
        await reportImported(count, dialog, t)
      } catch (error) {
        await reportFailure(error, dialog, t)
      }
    }

    const importBCX = async () => {
      const code = await dialog.prompt(t('wardrobeIO.bcxImportPrompt'))
      if (!code?.trim()) return
      let parsed: unknown
      try {
        const decompressed = LZString.decompressFromBase64(code.trim())
        if (!decompressed) throw new Error('BCX code could not be decoded')
        parsed = JSON.parse(decompressed)
      } catch (error) {
        console.error('BCX parsing failed', error)
        await dialog.alert(t('wardrobeIO.bcxImportFailed'))
        return
      }
      await applyImportedData(parsed, getFs(), dialog, t)
    }

    const saveBackup = () => {
      try {
        downloadJson(getFs().exportWardrobe(), 'vpw-backup')
      } catch (error) {
        void reportFailure(error, dialog, t)
      }
    }

    const saveRecoveryBackup = async () => {
      try {
        downloadJson(await getFs().exportRecovery(), 'vpw-recovery')
      } catch (error) {
        await reportFailure(error, dialog, t)
      }
    }

    const importBackup = () => {
      const input = doc.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      input.style.display = 'none'
      input.addEventListener('cancel', () => input.remove(), { once: true })
      input.addEventListener('change', async () => {
        const file = input.files?.[0]
        input.remove()
        if (!file) return
        let parsed: unknown
        try {
          parsed = JSON.parse(await file.text())
        } catch (error) {
          console.error('Backup parsing failed', error)
          await dialog.alert(t('wardrobeIO.backupParseFailed'))
          return
        }
        await applyImportedData(parsed, getFs(), dialog, t)
      }, { once: true })
      doc.body.appendChild(input)
      input.click()
    }

    // Keep the action name while existing menu consumers migrate to the library UI.
    const saveCharacterToFolder = async () => {
      const fs = getFs()
      if (!Array.isArray(fs.characterItem) || fs.characterItem.length === 0) {
        await dialog.alert(t('wardrobeIO.saveCharacterEmpty'))
        return
      }
      const name = await dialog.prompt(t('library.saveNamePrompt'), defaultFilename('character'))
      if (!name?.trim()) return
      try {
        const id = await fs.addOutfit({
          name: name.trim(), type: 'character', data: fs.characterItem,
          tagIds: fs.selectedTagId && fs.selectedTagId !== 'untagged' ? [fs.selectedTagId] : [],
        })
        if (!id) {
          await reportImported(0, dialog, t)
          return
        }
        try {
          ExternalAdapter.sendRetriveOutfitNotification(fs.character)
        } catch {
          // A game notification failure does not undo the saved outfit.
        }
        await dialog.alert(t('library.saved', { name: name.trim() }))
      } catch (error) {
        await reportFailure(error, dialog, t)
      }
    }

    return { importPlayerWardrobe, importBCX, saveBackup, saveRecoveryBackup, importBackup, saveCharacterToFolder }
  }, [dialog, t])
}
