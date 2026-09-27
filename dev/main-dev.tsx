import './mock-game'
import { createRoot } from 'react-dom/client'
import { createShadowHost } from '@/ui/shadow'
import { Root } from '@/ui/Root'
import { getFs } from '@/stores/hooks'
import { useFileSystemStore } from '@/stores/fileSystemStore.js'
import '@/i18n'

// The mock page has one writer and never contacts a game server.
const mockWindow = window as any
mockWindow.__VPW_WARDROBE_LOCK_OWNER = true
mockWindow.__VPW_WARDROBE_LOCK_MEMBER = String(mockWindow.Player.MemberNumber)
async function seedLibrary() {
  try {
    await useFileSystemStore.getState().loadAll()
    const fs = getFs()
    if (fs.outfits.length === 0) {
      const tagId = await fs.createTag('日常 / 夏天')
      await fs.addOutfit({ name: 'Sample Outfit', type: 'outfit', data: [], tagIds: [tagId] })
      await fs.addOutfit({ name: 'Local draft', type: 'outfit', data: [], cloudSync: false })
    }
  } catch (error) {
    console.warn('[dev] seed failed', error)
  }
}
// Mount the wardrobe UI directly into a Shadow DOM, bypassing the game-readiness
// gate in main.tsx. Lets us visually verify the React + Mantine UI and Shadow DOM
// style isolation without the Bondage Club runtime.
void seedLibrary().then(() => {
  const { mountEl } = createShadowHost('vpw-shadow-host')
  createRoot(mountEl).render(<Root rootEl={mountEl} />)
})
