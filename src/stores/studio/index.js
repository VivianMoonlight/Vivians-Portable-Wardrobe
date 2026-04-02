import { useStudioStore } from '@/stores/studioStore'
import { useStudioPanelStore } from '@/stores/studio/panelStore'
import { useStudioHistoryStore } from '@/stores/studio/historyStore'
import { useStudioPersistenceStore } from '@/stores/studio/persistenceStore'
import { useStudioSelectionStore } from '@/stores/studio/selectionStore'
import { useStudioPaletteStore } from '@/stores/studio/paletteStore'

export function useStudioDomainStores() {
  const studio = useStudioStore()
  const panel = useStudioPanelStore()
  const history = useStudioHistoryStore()
  const persistence = useStudioPersistenceStore()
  const selection = useStudioSelectionStore()
  const palette = useStudioPaletteStore()

  return {
    studio,
    panel,
    history,
    persistence,
    selection,
    palette
  }
}
