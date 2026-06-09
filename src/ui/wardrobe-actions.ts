import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import LZString from 'lz-string'
import { hostWindow, doc } from '@/utils/host-window.js'
import { ExternalAdapter } from '@/utils/external_adapters.js'
import { getFs, type FsCtx } from '@/stores/hooks'
import { useDialog, type DialogApi } from '@/ui/dialog/DialogProvider'

/**
 * Wardrobe import/export actions, ported from the Vue FileManagerPanel.
 *
 * Covers: import the player's in-game wardrobe, import a BCX code, import/export
 * a JSON backup, and save the current character outfit to a folder. BCX *export*
 * of an individual outfit lives on the file card (FileItem) via
 * ExternalAdapter.exportOutfitAsBCX.
 */
function defaultFilename(prefix: string): string {
  return `${prefix}_${new Date().toISOString().replace(/[:.]/g, '-')}`
}

/**
 * Apply an arbitrary imported payload (full FS backup, single file, raw outfit
 * array, or a `{ fs }` wrapper) into the file system.
 */
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

  // 1) Full FileSystem backup (root folder node) -> merge into current tree.
  if (parsed.type === 'folder' && Array.isArray(parsed.children)) {
    try {
      const existing = fs.fs.toJSON()
      fs.fs.fromMultipleJSON([existing, parsed])
      fs.saveAll()
      await dialog.alert(t('wardrobeIO.importMerged'))
    } catch (e) {
      console.warn('merge root failed, replacing', e)
      fs.fs.fromJSON(parsed)
      fs.saveAll()
      await dialog.alert(t('wardrobeIO.importReplaced'))
    }
    return
  }

  // 2) Single file object (has type + data) -> add to current folder.
  if (parsed.type && parsed.data) {
    fs.addFile(parsed)
    await dialog.alert(t('wardrobeIO.importedAsFile'))
    return
  }

  // 3) Raw outfit array -> prompt for a name and add as a file.
  if (Array.isArray(parsed)) {
    const name = await dialog.prompt(t('wardrobeIO.importNamePrompt'), defaultFilename('imported'))
    if (!name) {
      await dialog.alert(t('wardrobeIO.importCancelled'))
      return
    }
    fs.addFile({ name, type: 'outfit', data: parsed })
    await dialog.alert(t('wardrobeIO.importedAsFile'))
    return
  }

  // 4) `{ fs }` wrapper -> restore the embedded file system.
  if (parsed.fs && typeof parsed.fs === 'object') {
    fs.fs.fromMultipleJSON([fs.fs.toJSON(), parsed.fs])
    fs.saveAll()
    await dialog.alert(t('wardrobeIO.importMerged'))
    return
  }

  await dialog.alert(t('wardrobeIO.importUnrecognized'))
}

export interface WardrobeActions {
  importPlayerWardrobe: () => Promise<void>
  importBCX: () => Promise<void>
  saveBackup: () => void
  importBackup: () => void
  saveCharacterToFolder: () => Promise<void>
}

export function useWardrobeActions(): WardrobeActions {
  const dialog = useDialog()
  const { t } = useTranslation()

  return useMemo<WardrobeActions>(() => {
    /** Import every non-empty slot of Player.Wardrobe into a timestamped folder. */
    const importPlayerWardrobe = async () => {
      const fs = getFs()
      const player = (hostWindow as any).Player
      if (!player?.Wardrobe || !player.WardrobeCharacterNames) {
        await dialog.alert(t('wardrobeIO.playerWardrobeUnavailable'))
        return
      }
      try {
        const wardrobe: any[] = player.Wardrobe
        const names: string[] = player.WardrobeCharacterNames
        const folderName = `Player_Wardrobe_${new Date().toISOString().replace(/[:.]/g, '-')}`

        fs.fs.addFolder(fs.currentPath, folderName)
        fs.moveTo([...fs.currentPath, folderName])

        let count = 0
        for (let i = 0; i < wardrobe.length; i++) {
          const outfit = wardrobe[i]
          if (Array.isArray(outfit) && outfit.length > 0) {
            const name = (names[i] && names[i].trim()) || `Outfit_${i}`
            fs.addFile({ name, type: 'outfit', data: JSON.parse(JSON.stringify(outfit)) })
            count++
          }
        }
        await dialog.alert(t('wardrobeIO.playerWardrobeImported', { count, name: folderName }))
      } catch (e) {
        console.error('importPlayerWardrobe failed', e)
        await dialog.alert(t('wardrobeIO.playerWardrobeFailed'))
      }
    }

    /** Decode a pasted BCX code (base64 + LZString) and import it. */
    const importBCX = async () => {
      const code = await dialog.prompt(t('wardrobeIO.bcxImportPrompt'))
      if (!code) return
      try {
        const decompressed = LZString.decompressFromBase64(code.trim())
        if (!decompressed) throw new Error('LZString returned null')
        await applyImportedData(JSON.parse(decompressed), getFs(), dialog, t)
      } catch (e) {
        console.error('importBCX failed', e)
        await dialog.alert(t('wardrobeIO.bcxImportFailed'))
      }
    }

    /** Download the whole file system as a JSON backup. */
    const saveBackup = () => {
      try {
        const json = JSON.stringify(getFs().fs.toJSON(), null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = doc.createElement('a')
        a.href = url
        a.download = `${defaultFilename('vpw-backup')}.json`
        doc.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      } catch (e) {
        console.error('saveBackup failed', e)
        void dialog.alert(t('wardrobeIO.backupSaveFailed'))
      }
    }

    /** Load a JSON backup file and merge/apply it. */
    const importBackup = () => {
      const input = doc.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      input.style.display = 'none'
      input.addEventListener('change', async (ev: any) => {
        const file = ev.target?.files?.[0]
        if (!file) {
          input.remove()
          return
        }
        try {
          await applyImportedData(JSON.parse(await file.text()), getFs(), dialog, t)
        } catch (e) {
          console.error('importBackup failed', e)
          await dialog.alert(t('wardrobeIO.backupParseFailed'))
        } finally {
          input.remove()
        }
      })
      doc.body.appendChild(input)
      input.click()
    }

    /** Save the character's current outfit as a file in the current folder. */
    const saveCharacterToFolder = async () => {
      const fs = getFs()
      if (!Array.isArray(fs.characterItem)) {
        await dialog.alert(t('wardrobeIO.saveCharacterEmpty'))
        return
      }
      const name = await dialog.prompt(t('wardrobeIO.saveCharacterPrompt'), defaultFilename('character'))
      if (!name) return
      try {
        fs.addFile({ name, type: 'character', data: JSON.parse(JSON.stringify(fs.characterItem)) })
        try {
          ExternalAdapter.sendRetriveOutfitNotification(fs.character)
        } catch {
          /* notification is best-effort */
        }
        await dialog.alert(t('wardrobeIO.savedToFolder', { name }))
      } catch (e) {
        console.error('saveCharacterToFolder failed', e)
        await dialog.alert(t('wardrobeIO.saveFailed'))
      }
    }

    return { importPlayerWardrobe, importBCX, saveBackup, importBackup, saveCharacterToFolder }
  }, [dialog, t])
}
