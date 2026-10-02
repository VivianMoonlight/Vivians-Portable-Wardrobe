import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { version as packageVersion } from '../package.json'
import { hostWindow, doc, setTimeoutHost } from '@/utils/host-window.js'
import { registerModWithSdk, hookDrawCharacter, hookHistory } from '@/utils/register.js'
import * as LayerTranslator from '@/services/LayerTranslator.js'
import { collectOutfitData } from '@/utils/AssetApi.js'
import { useFileSystemStore } from '@/stores/fileSystemStore.js'
import { installWardrobeSyncEvents } from '@/utils/wardrobe-sync-events.js'
import { createWardrobeTabLock } from '@/utils/wardrobe-tab-lock.js'
import { createWardrobeLoginCapture } from '@/utils/wardrobe-login-capture.js'
import { installRenderHooks } from '@/utils/RenderApi.js'
import { configureNativeItemEditor, cancelNativeItemEditor } from '@/services/native-item-editor.js'
import { configureNativeWardrobeEditor, cancelNativeWardrobeEditor } from '@/services/native-wardrobe-editor.js'
import { createShadowHost } from '@/ui/shadow'
import { Root } from '@/ui/Root'
import '@/i18n'

const HOST_ID = 'vpw-shadow-host'
const w = hostWindow as any
const currentMember = (): string | null => {
  const member = String(w.Player?.MemberNumber ?? '')
  return /^(0|[1-9]\d*)$/.test(member) && Number.isSafeInteger(Number(member)) ? member : null
}

// The repository's transport also checks the member bound below.
if (!doc.getElementById(HOST_ID)) {
  w.__VPW_WARDROBE_LOCK_OWNER = false
  w.__VPW_WARDROBE_LOCK_MEMBER = null
}

function waitForLoginHookReady(callback: () => void): void {
  if (w.bcModSdk?.registerMod && typeof w.LoginResponse === 'function'
    && typeof w.ServerSend === 'function') callback()
  else setTimeoutHost(() => waitForLoginHookReady(callback), 100)
}

function injectApp(): void {
  if (doc.getElementById(HOST_ID)) return

  const modApi = registerModWithSdk(w.VPW_Version || packageVersion)
  const wardrobe = useFileSystemStore.getState()
  const { host, shadow, mountEl } = createShadowHost(HOST_ID)
  const status = doc.createElement('div')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.style.cssText = 'position:fixed;right:16px;bottom:16px;max-width:min(360px,calc(100vw - 32px));padding:12px 16px;border-radius:10px;background:#1f2937;color:#fff;font:14px/1.5 system-ui,sans-serif;box-shadow:0 4px 20px #0004;z-index:2147483647;display:none'
  shadow.appendChild(status)
  const message = (zh: string, en: string) => i18next.language?.startsWith('zh') ? zh : en
  const showStatus = (value: string) => {
    status.textContent = value
    status.style.display = value ? 'block' : 'none'
  }

  let root: ReturnType<typeof createRoot> | null = null
  let loadedMember: string | null = null
  let desiredMember: string | null = null
  let gameReady = false
  let disposed = false
  let pageHidden = false
  let historyHooked = false
  let generation = 0
  let lockRun = 0
  let lockPending = false
  let pendingMember: string | null = null
  let waitTimer: ReturnType<typeof setTimeout> | null = null
  let disposeRender = () => {}
  let disposeNativeItemEditor = () => {}
  let disposeNativeWardrobeEditor = () => {}
  const loginCapture = createWardrobeLoginCapture()
  const repository = () => wardrobe._repository
  const lock = createWardrobeTabLock({
    locks: w.navigator?.locks,
    onChange: (owned: boolean, member: string | null) => {
      w.__VPW_WARDROBE_LOCK_OWNER = owned
      w.__VPW_WARDROBE_LOCK_MEMBER = owned ? member : null
      if (!owned) repository()?.cancelPending()
    },
  })
  const ownsWriter = () => loadedMember !== null && lock.isHeldFor(loadedMember)
    && w.__VPW_WARDROBE_LOCK_MEMBER === loadedMember
    && currentMember() === loadedMember

  const stopWaitTimer = () => {
    if (waitTimer !== null) w.clearTimeout(waitTimer)
    waitTimer = null
  }
  const unmountApp = () => {
    cancelNativeWardrobeEditor()
    cancelNativeItemEditor()
    root?.unmount()
    root = null
    loadedMember = null
  }
  const mountApp = () => {
    if (root) return
    root = createRoot(mountEl)
    root.render(<Root rootEl={mountEl} />)
    if (!historyHooked && modApi) {
      historyHooked = true
      try {
        hookHistory(modApi, (data: unknown[]) => useFileSystemStore.getState().addToHistory(data), collectOutfitData)
      } catch (error) {
        console.error('[VPW] hookHistory failed', error)
      }
    }
  }

  let openingMember: string | null = null
  let activationTask: Promise<void> = Promise.resolve()
  const activate = (member: string) => {
    if (disposed || pageHidden || !gameReady || !lock.isHeldFor(member) || currentMember() !== member) return
    if (desiredMember === member && (loadedMember === member || openingMember === member)) return
    const ticket = ++generation
    desiredMember = member
    openingMember = member
    w.__VPW_WARDROBE_LOCK_MEMBER = member
    repository()?.invalidateFreshness()
    unmountApp()
    activationTask = activationTask.catch(() => {}).then(async () => {
      if (ticket !== generation || currentMember() !== member || !lock.isHeldFor(member)) return
      try {
        await wardrobe.loadAll()
        if (ticket !== generation || currentMember() !== member || !lock.isHeldFor(member)) return
        loadedMember = member
        w.__VPW_WARDROBE_LOCK_MEMBER = member
        const fresh = loginCapture.take({ member, player: w.Player, lockToken: lock.token() })
        if (fresh) await wardrobe.receiveCloud(fresh)
        if (ticket !== generation || currentMember() !== member || !lock.isHeldFor(member)) return
        mountApp()
        showStatus('')
      } catch (error) {
        if (ticket !== generation) return
        console.error('[VPW] wardrobe initialization failed', error)
        w.__VPW_WARDROBE_LOCK_MEMBER = null
        unmountApp()
        showStatus(message('衣柜启动失败。请刷新页面重试。', 'Wardrobe could not start. Reload the page to retry.'))
      } finally {
        if (ticket === generation) openingMember = null
      }
    })
    return activationTask
  }
  const acquireMemberLock = async () => {
    const member = currentMember()
    if (disposed || pageHidden || member === null
      || (doc.visibilityState === 'hidden' && !gameReady)) return
    if (lock.isHeldFor(member)) {
      if (gameReady) activate(member)
      return
    }
    if (lockPending && pendingMember === member) return
    const ticket = ++lockRun
    lockPending = true
    pendingMember = member
    generation++
    desiredMember = null
    unmountApp()
    w.__VPW_WARDROBE_LOCK_OWNER = false
    w.__VPW_WARDROBE_LOCK_MEMBER = null
    showStatus(message('正在打开衣柜…', 'Opening wardrobe…'))
    stopWaitTimer()
    waitTimer = w.setTimeout(() => {
      if (ticket === lockRun && !lock.isHeldFor(member)) showStatus(message(
        '此角色的衣柜正在另一个标签页使用。关闭那个标签页后，这里会自动接管。',
        'This character’s wardrobe is open in another tab. Close that tab to take over here automatically.',
      ))
    }, 200)
    const held = await lock.acquire(member)
    if (disposed || pageHidden || ticket !== lockRun) return
    lockPending = false
    pendingMember = null
    stopWaitTimer()
    if (!held) {
      showStatus(message(
        '无法取得多标签页写入锁，已暂停打开衣柜以保护本机数据。',
        'The tab write lock is unavailable. Opening is paused to protect local changes.',
      ))
      return
    }
    if (gameReady) activate(member)
    else showStatus(message('等待 BC 登录…', 'Waiting for BC sign-in…'))
  }

  // Only a request sent under this lock can certify a later LoginResponse.
  // Never inspect or retain the AccountLogin credentials.
  const unhookLoginRequest = modApi.hookFunction('ServerSend', 0, (args: any[], next: (args: any[]) => unknown) => {
    if (args[0] === 'AccountLogin') {
      const member = currentMember()
      loginCapture.markRequest(member !== null && lock.isHeldFor(member) ? lock.token() : null)
    }
    return next(args)
  })
  const unhookLoginResponse = modApi.hookFunction('LoginResponse', -1, (args: any[], next: (args: any[]) => unknown) => {
    const result = next(args)
    loginCapture.noteResponse()
    return result
  })
  const disposeSync = installWardrobeSyncEvents({
    hostWindow: w,
    modApi,
    onLogin: (event: any) => {
      if (disposed || pageHidden) return
      const member = String(event.memberNumber)
      if (member !== currentMember()) return
      loginCapture.record(event, w.Player, lock.isHeldFor(member) ? lock.token() : null)
      if (!gameReady) return
      if (!lock.isHeldFor(member)) {
        void acquireMemberLock()
        return
      }
      if (desiredMember !== member || loadedMember !== member) {
        activate(member)
        return
      }
      const fresh = loginCapture.take({ member, player: w.Player, lockToken: lock.token() })
      if (fresh) {
        void wardrobe.receiveCloud(fresh).then((received: boolean) => {
          if (received) showStatus('')
        }).catch((error: unknown) => console.error('[VPW] cloud observation failed', error))
      } else {
        if (wardrobe.cloudflareSyncStatus?.enabled) {
          void wardrobe.syncCloudflareNow()
          return
        }
        repository()?.invalidateFreshness()
        showStatus(message(
          '这次登录开始于衣柜接管前。请重新登录 BC 后再同步。',
          'This sign-in began before the wardrobe took over. Sign in again to sync.',
        ))
      }
    },
    onStorage: () => {},
    onOnline: () => {
      if (!ownsWriter() || desiredMember !== loadedMember) return
      if (wardrobe.cloudflareSyncStatus?.enabled) {
        void wardrobe.syncCloudflareNow()
        return
      }
      repository()?.invalidateFreshness()
    },
    onOffline: () => {
      if (!ownsWriter()) return
      if (wardrobe.cloudflareSyncStatus?.enabled) {
        wardrobe.cloudflareSyncStatus = { ...wardrobe.cloudflareSyncStatus,
          error: message('当前离线，修改已保存在本机。', 'Offline; changes are saved on this device.') }
        return
      }
      const repo = repository()
      repo?.invalidateFreshness()
      repo?.emit({ state: 'offline' })
    },
  })

  const onPageHide = () => {
    pageHidden = true
    generation++
    lockRun++
    lockPending = false
    pendingMember = null
    stopWaitTimer()
    loginCapture.clear()
    w.__VPW_WARDROBE_LOCK_MEMBER = null
    lock.release()
    unmountApp()
    desiredMember = null
  }
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || disposed) return
    pageHidden = false
    void acquireMemberLock()
  }
  const onVisibilityChange = () => {
    if (disposed || pageHidden) return
    if (doc.visibilityState === 'hidden' && !gameReady && loadedMember === null) {
      lockRun++
      lockPending = false
      pendingMember = null
      stopWaitTimer()
      loginCapture.clear()
      w.__VPW_WARDROBE_LOCK_MEMBER = null
      lock.release()
    } else if (doc.visibilityState === 'visible' && loadedMember === null) {
      void acquireMemberLock()
    }
  }
  w.addEventListener('pagehide', onPageHide)
  w.addEventListener('pageshow', onPageShow)
  doc.addEventListener('visibilitychange', onVisibilityChange)

  const i18nCompat = {
    global: {
      t: (key: string, params?: Record<string, unknown>) =>
        params ? i18next.t(key, params) : i18next.t(key),
    },
  }
  w.__APP_I18N__ = i18nCompat
  w.APP_I18N = i18nCompat

  if (import.meta.hot) import.meta.hot.dispose(() => {
    disposed = true
    generation++
    lockRun++
    stopWaitTimer()
    loginCapture.clear()
    w.__VPW_WARDROBE_LOCK_MEMBER = null
    lock.dispose()
    disposeSync()
    unhookLoginRequest?.()
    unhookLoginResponse?.()
    disposeRender()
    disposeNativeItemEditor()
    disposeNativeWardrobeEditor()
    unmountApp()
    w.removeEventListener('pagehide', onPageHide)
    w.removeEventListener('pageshow', onPageShow)
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    host.remove()
  })

  const waitForPlayerReady = () => {
    if (disposed) return
    if (currentMember() === null
      || typeof w.CharacterRefresh !== 'function') {
      setTimeoutHost(waitForPlayerReady, 100)
      return
    }
    try {
      hookDrawCharacter(modApi)
      disposeRender = installRenderHooks(modApi)
      try {
        disposeNativeItemEditor = configureNativeItemEditor({ host: w, modApi, hostElement: host })
      } catch (error) {
        console.warn('[VPW] BC item editor is unavailable', error)
      }
      try {
        disposeNativeWardrobeEditor = configureNativeWardrobeEditor({ host: w, modApi, hostElement: host })
      } catch (error) {
        console.warn('[VPW] BC wardrobe editor is unavailable', error)
      }
      void Promise.resolve().then(() => LayerTranslator.ensureItemColorLayerNamesLoaded())
        .catch(error => console.warn('[VPW] item color layer names unavailable', error))
        .finally(() => LayerTranslator.cleanUpItemColorLayerNamesLoad())
      gameReady = true
      void acquireMemberLock()
    } catch (error) {
      console.error('[VPW] game hooks failed', error)
      showStatus(message('衣柜启动失败。请刷新页面重试。', 'Wardrobe could not start. Reload the page to retry.'))
    }
  }
  waitForPlayerReady()
}

waitForLoginHookReady(() => {
  try { injectApp() }
  catch (error) { console.error('[VPW] init failed', error) }
})
