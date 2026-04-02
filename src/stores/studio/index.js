import { useStudioStore } from '@/stores/studioStore'
import { useStudioPanelStore } from '@/stores/studio/panelStore'
import { useStudioHistoryStore } from '@/stores/studio/historyStore'
import { useStudioPersistenceStore } from '@/stores/studio/persistenceStore'

export function useStudioDomainStores() {
  const studio = useStudioStore()
  const panel = useStudioPanelStore()
  const history = useStudioHistoryStore()
  const persistence = useStudioPersistenceStore()
  return {
    studio,
    panel,
    history,
    persistence
  }
}
