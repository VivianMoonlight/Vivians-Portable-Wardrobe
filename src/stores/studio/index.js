import { useStudioStore } from '@/stores/studioStore'
import { useStudioPanelStore } from '@/stores/studio/panelStore'
import { useStudioHistoryStore } from '@/stores/studio/historyStore'
import { useStudioPersistenceStore } from '@/stores/studio/persistenceStore'
import { useStudioSelectionStore } from '@/stores/studio/selectionStore'

export function useStudioDomainStores() {
  const studio = useStudioStore()
  const panel = useStudioPanelStore()
  const history = useStudioHistoryStore()
  const persistence = useStudioPersistenceStore()
  const selection = useStudioSelectionStore()

  return {
    studio,
    panel,
    history,
    persistence,
    selection
  }
}
