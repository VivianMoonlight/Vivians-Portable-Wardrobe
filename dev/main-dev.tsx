import './mock-game'
import { createRoot } from 'react-dom/client'
import { createShadowHost } from '@/ui/shadow'
import { Root } from '@/ui/Root'
import { getFs } from '@/stores/hooks'
import { useFileSystemStore } from '@/stores/fileSystemStore.js'
import '@/i18n'

// Seed an indexed library once; the mock never contacts a game server.
try {
  useFileSystemStore.getState().loadAll()
  const fs = getFs()
  if (fs.outfits.length === 0) {
    const tagId = fs.createTag('日常 / 夏天')
    fs.addOutfit({ name: 'Sample Outfit', type: 'outfit', data: [], tagIds: [tagId] })
    fs.addOutfit({ name: 'Local draft', type: 'outfit', data: [], cloudSync: false })
  }
} catch (e) {
  console.warn('[dev] seed failed', e)
}

// Mount the wardrobe UI directly into a Shadow DOM, bypassing the game-readiness
// gate in main.tsx. Lets us visually verify the React + Mantine UI and Shadow DOM
// style isolation without the Bondage Club runtime.
const { mountEl } = createShadowHost('vpw-shadow-host')
createRoot(mountEl).render(<Root rootEl={mountEl} />)
