import './mock-game'
import { createRoot } from 'react-dom/client'
import { createShadowHost } from '@/ui/shadow'
import { Root } from '@/ui/Root'
import { getFs } from '@/stores/hooks'
import '@/i18n'

// Seed a couple of sample entries so the file grid (and FileItem cards) are
// actually exercised in the harness — this is what surfaces render-loop issues.
try {
  const fs = getFs()
  fs.addFile({ name: 'Sample Folder', type: 'folder', children: [] })
  fs.addFile({ name: 'Sample Outfit', type: 'file', data: [] })
} catch (e) {
  console.warn('[dev] seed failed', e)
}

// Mount the wardrobe UI directly into a Shadow DOM, bypassing the game-readiness
// gate in main.tsx. Lets us visually verify the React + Mantine UI and Shadow DOM
// style isolation without the Bondage Club runtime.
const { mountEl } = createShadowHost('vpw-shadow-host')
createRoot(mountEl).render(<Root rootEl={mountEl} />)
