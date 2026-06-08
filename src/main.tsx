import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { hostWindow, doc, setTimeoutHost } from '@/utils/host-window.js'
import { registerModWithSdk, hookDrawCharacter, hookHistory } from '@/utils/register.js'
import * as LayerTranslator from '@/services/LayerTranslator.js'
import { collectOutfitData } from '@/utils/AssetApi.js'
import { useFileSystemStore } from '@/stores/fileSystemStore.js'
import { createShadowHost } from '@/ui/shadow'
import { Root } from '@/ui/Root'
import '@/i18n' // side-effect: initialize i18next

const HOST_ID = 'vpw-shadow-host'
const FALLBACK_VERSION = '0.10.0'

const w = hostWindow as any

console.log('[VPW] React entry loaded')

/**
 * Wait until the BC game environment is ready. We require not just Player +
 * bcModSdk, but also that `CharacterRefresh` (the function we hook) actually
 * exists on the page window — otherwise ModSDK throws
 * "Function CharacterRefresh to be patched not found".
 */
function waitForGameReady(callback: () => void): void {
  if (
    w.Player &&
    typeof w.Player.MemberNumber !== 'undefined' &&
    w.bcModSdk?.registerMod &&
    typeof w.CharacterRefresh === 'function'
  ) {
    callback()
  } else {
    setTimeoutHost(() => waitForGameReady(callback), 500)
  }
}

async function injectApp(): Promise<void> {
  // Prevent double mount.
  if (doc.getElementById(HOST_ID)) return

  const version = w.VPW_Version || FALLBACK_VERSION

  const modApi = registerModWithSdk(version)
  hookDrawCharacter(modApi)

  await LayerTranslator.ensureItemColorLayerNamesLoaded()
  LayerTranslator.cleanUpItemColorLayerNamesLoad()

  // Expose a vue-i18n-shaped global for legacy framework-agnostic consumers
  // (e.g. src/config/filterGroupConfig.js group-name localization).
  const i18nCompat = {
    global: {
      t: (key: string, params?: Record<string, unknown>) =>
        params ? i18next.t(key, params) : i18next.t(key),
    },
  }
  w.__APP_I18N__ = i18nCompat
  w.APP_I18N = i18nCompat

  const { mountEl } = createShadowHost(HOST_ID)
  createRoot(mountEl).render(<Root rootEl={mountEl} />)

  // Wire the game history hook to the (now Zustand-backed) store's HistoryRecord.
  // Guard so a hook failure never escalates to an unhandled rejection.
  try {
    if (modApi) {
      const fsStore = useFileSystemStore.getState()
      hookHistory(modApi, fsStore.history, collectOutfitData)
    }
  } catch (e) {
    console.error('[VPW] hookHistory failed', e)
  }
}

setTimeoutHost(() => {
  console.log('[VPW] waiting for game ready…')
  waitForGameReady(() => {
    injectApp().catch((err) => console.error('[VPW] init failed', err))
  })
}, 1000)
