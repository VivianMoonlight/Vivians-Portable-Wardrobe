import { useStudioStore } from '@/stores/studioStore'
import { useStudioPanelStore } from '@/stores/studio/panelStore'

export function useStudioDomainStores() {
  const studio = useStudioStore()
  const panel = useStudioPanelStore()
  return {
    studio,
    panel
  }
}
