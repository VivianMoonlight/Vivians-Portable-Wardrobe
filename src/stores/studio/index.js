import { useStudioStore } from '@/stores/studioStore'
import { useStudioPanelStore } from '@/stores/studio/panelStore'
import { useStudioHistoryStore } from '@/stores/studio/historyStore'
import { useStudioPersistenceStore } from '@/stores/studio/persistenceStore'
import { useStudioSelectionStore } from '@/stores/studio/selectionStore'
import { useStudioPaletteStore } from '@/stores/studio/paletteStore'
import { useStudioRenderStore } from '@/stores/studio/renderStore'
import { useStudioCoreStore } from '@/stores/studio/coreStore'
import { useStudioAssetStore } from '@/stores/studio/assetStore'

export function useStudioDomainStores() {
  const studio = useStudioStore()
  const panel = useStudioPanelStore()
  const history = useStudioHistoryStore()
  const persistence = useStudioPersistenceStore()
  const selection = useStudioSelectionStore()
  const palette = useStudioPaletteStore()
  const render = useStudioRenderStore()
  const core = useStudioCoreStore()
  const asset = useStudioAssetStore()

  return {
    studio,
    core,
    asset,
    panel,
    history,
    persistence,
    selection,
    palette,
    render
  }
}
