import { isHiddenBodySlot } from './hidden-body-slots.js'

const clone = value => JSON.parse(JSON.stringify(value))
const EDITOR_SCREENS = new Set(['Appearance'])
const BLOCKED_SENDS = new Set([
  'AccountUpdate', 'ChatRoomCharacterUpdate', 'ChatRoomCharacterItemUpdate', 'ChatRoomChat',
])

let installedEditor = null
let scratchId = 0
let active = false
const listeners = new Set()

function setActive(value) {
  if (active === value) return
  active = value
  for (const listener of listeners) listener()
}

export function subscribeNativeWardrobeEditor(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isNativeWardrobeEditorActive() { return active }

function copyAppearanceItem(item) {
  const copy = { ...item }
  for (const field of ['Color', 'Property', 'Craft']) {
    if (item[field] !== undefined) copy[field] = clone(item[field])
  }
  return copy
}

function appearanceBundle(host, character) {
  const byGroup = new Map()
  for (const item of character.Appearance || []) {
    const group = item?.Asset?.Group
    if (!group || group.Category === 'Item' || isHiddenBodySlot(group.Name)) continue
    const bundled = host.ServerBundledItemFromAppearanceItem(item)
    if (bundled?.Group === group.Name && !byGroup.has(group.Name)) byGroup.set(group.Name, clone(bundled))
  }
  return byGroup
}

function mergeAppearance(host, source, before, after, family) {
  const result = []
  const seen = new Set()
  const isItem = part => part.IsItem === true
    || host.AssetGet?.(family, part.Group, part.Name)?.Group?.Category === 'Item'

  for (const part of source) {
    const group = part?.Group
    if (typeof group !== 'string' || isHiddenBodySlot(group) || isItem(part)) {
      result.push(part)
      continue
    }
    if (seen.has(group)) continue
    seen.add(group)
    const initial = before.get(group)
    const edited = after.get(group)
    const unchanged = (!initial && !edited)
      || (initial && edited && JSON.stringify(initial) === JSON.stringify(edited))
    if (unchanged) {
      result.push(part)
    } else if (edited) {
      result.push({ ...edited, IsItem: false })
    }
  }

  for (const [group, edited] of after) {
    if (seen.has(group) || isHiddenBodySlot(group)) continue
    const initial = before.get(group)
    if (!initial || JSON.stringify(initial) !== JSON.stringify(edited)) {
      result.push({ ...edited, IsItem: false })
    }
  }
  return result
}

/** Opens BC's real Appearance screen on an isolated character, returning only the edited bundle. */
export function createNativeWardrobeEditor({ host, modApi, hostElement }) {
  if (!host || !modApi?.hookFunction || !hostElement) throw new Error('BC wardrobe is unavailable')
  for (const name of ['CharacterLoadSimple', 'CharacterNaked', 'ServerAppearanceLoadFromBundle',
    'CharacterRefresh', 'CharacterDelete', 'CharacterAppearanceLoadCharacter',
    'ServerBundledItemFromAppearanceItem', 'AssetGet']) {
    if (typeof host[name] !== 'function') throw new Error(`BC wardrobe needs ${name}`)
  }
  let session = null
  let disposed = false
  const unhooks = []
  const hook = (name, handler) => {
    if (typeof host[name] === 'function') unhooks.push(modApi.hookFunction(name, 100, handler))
  }
  const ownsScratch = () => session && host.CharacterAppearanceSelection === session.scratch

  hook('AppearanceMenuBuild', (args, next) => {
    const result = next(args)
    if (ownsScratch() && Array.isArray(host.AppearanceMenu)) {
      host.AppearanceMenu = host.AppearanceMenu.filter(button =>
        !['Wardrobe', 'WardrobeDisabled', 'Character'].includes(button))
    }
    return result
  })
  hook('CharacterAppearanceWardrobeLoad', (args, next) => {
    if (ownsScratch()) return
    return next(args)
  })
  hook('CharacterAppearanceClose', (args, next) => {
    if (ownsScratch()) {
      host.AppearanceUseCharacterInPreviewsSetting = host.Player?.VisualSettings?.UseCharacterInPreviews
    }
    return next(args)
  })

  hook('AppearanceGroupAllowed', (args, next) => {
    if (ownsScratch() && args[0] === session.scratch && isHiddenBodySlot(args[1])) return false
    return next(args)
  })
  hook('InventoryTogglePermission', (args, next) => {
    if (ownsScratch()) return
    return next(args)
  })
  hook('InventorySetPermission', (args, next) => {
    if (ownsScratch()) return
    return next(args)
  })
  hook('ServerPlayerAppearanceSync', (args, next) => {
    if (ownsScratch()) return
    return next(args)
  })
  hook('ChatRoomCharacterUpdate', (args, next) => {
    if (ownsScratch() && args[0] === session.scratch) return
    return next(args)
  })
  hook('ChatRoomCharacterItemUpdate', (args, next) => {
    if (ownsScratch() && args[0] === session.scratch) return
    return next(args)
  })
  hook('ServerSend', (args, next) => {
    if (ownsScratch() && BLOCKED_SENDS.has(args[0])) return
    return next(args)
  })
  hook('CharacterAppearanceCopy', (args, next) => {
    if (!ownsScratch() || !args[0] || args[1] !== session.scratch) return next(args)
    const from = Object.create(args[0])
    from.Appearance = (args[0]?.Appearance || []).map(copyAppearanceItem)
    return next([from, args[1]])
  })

  const cancel = () => {
    if (!session || session.closing) return
    if (host.CurrentScreen !== 'Appearance') {
      session.cancelRequested = true
      return
    }
    if (typeof host.CharacterAppearanceExit === 'function') {
      try { host.CharacterAppearanceExit(session.scratch); return }
      catch (error) { session.finish('cancelled', null, error); return }
    }
    session.finish('cancelled')
  }

  const open = ({ bundle, signal }) => {
    if (session) throw new Error('A BC wardrobe is already open')
    if (signal?.aborted) return Promise.resolve({ status: 'cancelled' })
    if (!Array.isArray(bundle)) throw new Error('Saved outfit data is unavailable')
    if (host.CurrentScreen === 'Appearance' || host.CurrentScreen === 'Wardrobe') {
      throw new Error('Leave the BC wardrobe before editing a saved outfit')
    }
    const source = clone(bundle)

    return new Promise((resolve, reject) => {
      const prior = {
        screen: host.CurrentScreen,
        module: host.CurrentModule,
        functions: host.CurrentScreenFunctions,
        character: host.CurrentCharacter,
        forceUp: host.CharacterAppearanceForceUpCharacter,
        selection: host.CharacterAppearanceSelection,
        backup: host.CharacterAppearanceBackup,
        returnScreen: host.CharacterAppearanceReturnScreen,
        resultCallback: host.CharacterAppearanceResultCallback,
        focusItem: host.DialogFocusItem,
        focusSource: host.DialogFocusSourceItem,
        focusName: host.DialogFocusItemName,
        menuMode: host.DialogMenuMode,
        extendedMessage: host.DialogExtendedMessage,
        subscreen: host.ExtendedItemSubscreen,
        permissionMode: host.ExtendedItemPermissionMode,
        tightenItem: host.DialogTightenLoosenItem,
        previewSetting: host.AppearanceUseCharacterInPreviewsSetting,
        hostDisplay: hostElement.style.display,
        chatHidden: host.ChatRoomChatHidden,
      }
      let scratch = null
      let originalIsPlayer
      let before = null
      let interval = null
      let entered = false
      const openedAt = Date.now()
      const current = {
        scratch: null,
        closing: false,
        cancelRequested: false,
        async finish(status, edited = null, error = null) {
          if (current.closing) return
          current.closing = true
          if (interval !== null) host.clearInterval(interval)
          signal?.removeEventListener('abort', cancel)
          try {
            if (status === 'saved' && !edited && !error) {
              edited = mergeAppearance(host, source, before, appearanceBundle(host, scratch), scratch.AssetFamily)
            }
          } catch (reason) { error ||= reason }
          try {
            if (EDITOR_SCREENS.has(host.CurrentScreen)) {
              if (typeof host.CommonSetScreen === 'function') {
                await host.CommonSetScreen(prior.module, prior.screen)
              }
            }
          } catch (reason) { error ||= reason }
          try {
            if (scratch) scratch.IsPlayer = originalIsPlayer
            if (EDITOR_SCREENS.has(host.CurrentScreen) || host.CurrentScreen === prior.screen) {
              host.CurrentScreen = prior.screen
              host.CurrentModule = prior.module
              host.CurrentScreenFunctions = prior.functions
              host.CurrentCharacter = prior.character
              host.DialogFocusItem = prior.focusItem
              host.DialogFocusSourceItem = prior.focusSource
              host.DialogFocusItemName = prior.focusName
              host.DialogMenuMode = prior.menuMode
              host.DialogExtendedMessage = prior.extendedMessage
              host.ExtendedItemSubscreen = prior.subscreen
              host.ExtendedItemPermissionMode = prior.permissionMode
              host.DialogTightenLoosenItem = prior.tightenItem
              if (prior.screen === 'ChatRoom' && prior.chatHidden !== true) host.ChatRoomShowElements?.()
            }
            if (host.CharacterAppearanceSelection === scratch || host.CurrentScreen === prior.screen) {
              host.CharacterAppearanceForceUpCharacter = prior.forceUp
              host.CharacterAppearanceSelection = prior.selection
              host.CharacterAppearanceBackup = prior.backup
              host.CharacterAppearanceReturnScreen = prior.returnScreen
              host.CharacterAppearanceResultCallback = prior.resultCallback
              host.AppearanceUseCharacterInPreviewsSetting = prior.previewSetting
            }
          } catch (reason) { error ||= reason }
          finally {
            hostElement.style.display = prior.hostDisplay
            try { if (scratch) host.CharacterDelete(scratch, false) } catch (reason) { error ||= reason }
            session = null
            setActive(false)
            if (disposed) for (const unhook of unhooks.splice(0).reverse()) unhook?.()
          }
          if (error) reject(error)
          else resolve(status === 'saved' ? { status, bundle: edited } : { status: 'cancelled' })
        },
      }

      try {
        scratch = host.CharacterLoadSimple(`VPWWardrobeCharacter${++scratchId}`)
        if (!scratch) throw new Error('BC could not create a wardrobe character')
        scratch.CharacterID = ''
        scratch.AllowItem = true
        scratch.Inventory = (host.Player?.Inventory || []).map(item => ({ ...item }))
        scratch.Crafting = (host.Player?.Crafting || []).map(item => ({ ...item }))
        scratch.Wardrobe = []
        scratch.WardrobeCharacterNames = []
        scratch.PermissionItems = {}
        scratch.LimitedItems = {}
        scratch.BlockItems = []
        scratch.OnlineSharedSettings = { AllowFullWardrobeAccess: true, BlockBodyCosplay: false,
          ItemsAffectExpressions: false }
        host.CharacterNaked(scratch, false)
        host.ServerAppearanceLoadFromBundle(scratch, scratch.AssetFamily, clone(source), host.Player?.MemberNumber)
        scratch.CharacterID = ''
        scratch.Appearance = (scratch.Appearance || []).map(copyAppearanceItem)
        host.CharacterRefresh(scratch, false, false)
        before = appearanceBundle(host, scratch)
        originalIsPlayer = scratch.IsPlayer
        scratch.IsPlayer = () => true
        current.scratch = scratch
        session = current
        setActive(true)
        host.CurrentCharacter = null
        host.CharacterAppearanceForceUpCharacter = -1
        if (prior.screen === 'ChatRoom') host.ChatRoomHideElements?.()
        hostElement.style.display = 'none'
        signal?.addEventListener('abort', cancel, { once: true })
        host.CharacterAppearanceLoadCharacter(scratch, accept => {
          current.finish(accept ? 'saved' : 'cancelled')
        })
        if (session === current && !current.closing && typeof host.setInterval === 'function') {
          interval = host.setInterval(() => {
            if (!session || current.closing) return
            if (EDITOR_SCREENS.has(host.CurrentScreen)) {
              entered = true
              if (current.cancelRequested) cancel()
            }
            else if (entered || Date.now() - openedAt > 10000) current.finish('cancelled')
          }, 250)
        }
      } catch (error) {
        if (session === current) current.finish('cancelled', null, error)
        else {
          try { if (scratch) host.CharacterDelete(scratch, false) } catch { /* setup failed */ }
          reject(error)
        }
      }
    })
  }

  const dispose = () => {
    disposed = true
    cancel()
    if (!session) for (const unhook of unhooks.splice(0).reverse()) unhook?.()
  }
  return { open, cancel, dispose }
}

export function configureNativeWardrobeEditor(options) {
  installedEditor?.dispose()
  const editor = createNativeWardrobeEditor(options)
  installedEditor = editor
  return () => {
    if (installedEditor === editor) {
      editor.dispose()
      installedEditor = null
    }
  }
}

export function cancelNativeWardrobeEditor() { installedEditor?.cancel() }

export function openNativeWardrobeEditor(options) {
  if (!installedEditor) throw new Error('BC wardrobe is not ready')
  return installedEditor.open(options)
}
