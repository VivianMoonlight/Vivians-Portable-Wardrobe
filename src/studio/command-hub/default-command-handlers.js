import { createPaletteCommandHandlers } from '@/studio/command-hub/handlers/palette-command-handlers'
import { createPartLayerCommandHandlers } from '@/studio/command-hub/handlers/part-layer-command-handlers'
import { createBatchCommandHandlers } from '@/studio/command-hub/handlers/batch-command-handlers'
import { createAssetCommandHandlers } from '@/studio/command-hub/handlers/asset-command-handlers'
import { createHistoryCommandHandlers } from '@/studio/command-hub/handlers/history-command-handlers'
import { createSavesCommandHandlers } from '@/studio/command-hub/handlers/saves-command-handlers'
import { createStackCommandHandlers } from '@/studio/command-hub/handlers/stack-command-handlers'

export function createDefaultStudioCommandHandlers({ store, persistenceStore, paletteStore } = {}) {
  if (!store) return {}

  return {
    ...createPaletteCommandHandlers({ store, paletteStore }),
    ...createPartLayerCommandHandlers({ store }),
    ...createBatchCommandHandlers({ store }),
    ...createAssetCommandHandlers({ store }),
    ...createHistoryCommandHandlers({ store }),
    ...createSavesCommandHandlers({ store, persistenceStore }),
    ...createStackCommandHandlers({ store })
  }
}

export default createDefaultStudioCommandHandlers
