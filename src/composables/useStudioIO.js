/**
 * Composable for Studio import/export operations
 * Handles stacks and palette file I/O
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import { useFileSystemStore } from '@/stores/fileSystemStore'
import * as DialogService from '@/services/DialogService.js'

export function useStudioIO() {
  const { t } = useI18n()
  const studio = useStudioStore()
  const fsStore = useFileSystemStore()

  const stacksFileInput = ref(null)
  const paletteFileInput = ref(null)

  function onSaveStacks() {
    studio.persistStacksToLocalStorage()
    studio.exportStacksToJsonFile('stacks.json')
  }

  function onLoadStacksClick() {
    const el = stacksFileInput.value
    if (el) { el.value = null; el.click() }
  }

  async function onStacksFileSelected(e) {
    const files = e.target.files
    if (!files || !files.length) return
    const ok = await studio.importStacksFromJsonFile(files[0])
    if (ok) await DialogService.alert(t('studio.stacksImportSuccess'))
    else await DialogService.alert(t('studio.stacksImportFailed'))
  }

  function onSavePalette() {
    studio.persistPaletteToLocalStorage()
    studio.exportPaletteToJsonFile('palette.json')
  }

  function onLoadPaletteClick() {
    const el = paletteFileInput.value
    if (el) { el.value = null; el.click() }
  }

  async function onPaletteFileSelected(e) {
    const files = e.target.files
    if (!files || !files.length) return
    const ok = await studio.importPaletteFromJsonFile(files[0])
    if (ok) await DialogService.alert(t('studio.paletteImportSuccess'))
    else await DialogService.alert(t('studio.paletteImportFailed'))
  }

  async function exportMergedToFileStore() {
    if (!fsStore || typeof fsStore.addFile !== 'function') {
      await DialogService.alert(t('studio.exportNoFSAlert'))
      return
    }
    try {
      studio.refreshMergedAppearanceData()
      const payload = studio.getMergedAppearanceForExport()
      const fileNode = {
        name: 'mergedAppearance_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json',
        type: 'outfit',
        data: payload.data || [],
        createdAt: new Date().toISOString()
      }
      fsStore.addFile(fileNode)
      try { fsStore.saveAll() } catch (e) { /* ignore */ }
      await DialogService.alert(t('studio.exportSuccessAlert'))
    } catch (e) {
      console.error('exportMergedToFileStore failed', e)
      await DialogService.alert(t('studio.exportFailedAlert', { msg: e?.message || String(e) }))
    }
  }

  return {
    stacksFileInput,
    paletteFileInput,
    onSaveStacks,
    onLoadStacksClick,
    onStacksFileSelected,
    onSavePalette,
    onLoadPaletteClick,
    onPaletteFileSelected,
    exportMergedToFileStore
  }
}
