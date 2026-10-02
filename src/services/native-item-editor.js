const SCREEN = 'VPWNativeItemEditor'
const clone = value => JSON.parse(JSON.stringify(value))

let installedEditor = null
let scratchId = 0
let active = false
const listeners = new Set()

function setActive(value) {
  if (active === value) return
  active = value
  for (const listener of listeners) listener()
}

export function subscribeNativeItemEditor(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isNativeItemEditorActive() { return active }

/** BC owns this screen while its real extended-item controls edit a scratch character. */
export function createNativeItemEditor({ host, modApi, hostElement }) {
  if (!host || !modApi?.hookFunction || !hostElement) throw new Error('BC item editor is unavailable')
  for (const name of ['DialogLeaveFocusItem', 'DialogLeave', 'CommonSetScreen',
    'ChatRoomCharacterUpdate', 'ChatRoomCharacterItemUpdate', 'ServerSend']) {
    if (typeof host[name] !== 'function') throw new Error(`BC item editor needs ${name}`)
  }
  let session = null
  const unhooks = []
  const ownsScreen = () => session && host.CurrentScreen === SCREEN

  const hook = (name, callback) => {
    if (typeof host[name] !== 'function') throw new Error(`BC item editor needs ${name}`)
    unhooks.push(modApi.hookFunction(name, 100, callback))
  }

  hook('DialogLeaveFocusItem', (args, next) => {
    if (!ownsScreen() || session.closing) return next(args)
    session.back()
  })
  hook('DialogLeave', (args, next) => {
    if (!ownsScreen() || session.closing) return next(args)
    session.requestFinish()
  })
  hook('CommonSetScreen', (args, next) => {
    // Native item callbacks sometimes try to return to a chat-room dialog.
    if (ownsScreen() && session.dispatchDepth > 0) return Promise.resolve()
    return next(args)
  })
  for (const name of ['InventoryTogglePermission', 'InventorySetPermission']) {
    if (typeof host[name] === 'function') hook(name, (args, next) => {
      if (ownsScreen()) return
      return next(args)
    })
  }
  for (const name of ['ChatRoomCharacterUpdate', 'ChatRoomCharacterItemUpdate']) {
    hook(name, (args, next) => {
      if (ownsScreen() && args[0] === session.scratch) return
      return next(args)
    })
  }
  hook('ServerSend', (args, next) => {
    if (ownsScreen() && session.dispatchDepth > 0) return
    return next(args)
  })

  const cancel = () => session?.requestFinish('cancelled')

  const open = ({ bundle, groupName, signal, title = 'Edit item' }) => {
    if (session) throw new Error('A BC item editor is already open')
    if (signal?.aborted) return Promise.resolve({ status: 'cancelled' })
    if (!Array.isArray(bundle) || typeof groupName !== 'string') throw new Error('Select a saved item to edit')
    const source = bundle.find(part => part?.Group === groupName)
    if (!source || typeof source.Name !== 'string') throw new Error('The selected item is unavailable')
    const needed = ['CharacterLoadSimple', 'CharacterNaked', 'ServerAppearanceLoadFromBundle',
      'CharacterRefresh', 'CharacterDelete', 'InventoryGet', 'ExtendedItemInit',
      'ExtendedItemExit', 'ServerBundledItemFromAppearanceItem', 'DrawCharacter']
    for (const name of needed) if (typeof host[name] !== 'function') throw new Error(`BC item editor needs ${name}`)
    if (!host.CharacterGetCurrentHandlers || typeof host.CurrentScreen !== 'string') {
      throw new Error('BC item editor is unavailable on this game version')
    }
    const asset = host.AssetGet?.(host.Player?.AssetFamily || 'Female3DCG', groupName, source.Name)
    if (!asset || asset.Group?.Category !== 'Item') throw new Error('This item is unavailable in BC')
    const handlerBase = `Inventory${groupName}${source.Name}`
    for (const suffix of ['Load', 'Draw', 'Click']) {
      if (typeof host[handlerBase + suffix] !== 'function') {
        throw new Error('This item does not have a BC settings screen')
      }
    }

    return new Promise((resolve, reject) => {
      const prior = {
        screen: host.CurrentScreen,
        module: host.CurrentModule,
        functions: host.CurrentScreenFunctions,
        character: host.CurrentCharacter,
        focusItem: host.DialogFocusItem,
        focusSource: host.DialogFocusSourceItem,
        focusName: host.DialogFocusItemName,
        extendedMessage: host.DialogExtendedMessage,
        menuMode: host.DialogMenuMode,
        subscreen: host.ExtendedItemSubscreen,
        permissionMode: host.ExtendedItemPermissionMode,
        tightenItem: host.DialogTightenLoosenItem,
        currentHandler: host.CharacterGetCurrentHandlers[SCREEN],
        hostDisplay: hostElement.style.display,
        background: host[`${SCREEN}Background`],
        chatHidden: host.ChatRoomChatHidden,
      }
      let scratch = null
      let focusedItem = null
      let interval = null
      let removed = false
      let backing = false

      const current = {
        scratch: null,
        closing: false,
        dispatchDepth: 0,
        finish(status = 'saved', error = null) {
          if (current.closing) return
          current.closing = true
          const stillOwnsScreen = host.CurrentScreen === SCREEN
          let result = null
          try {
            if (stillOwnsScreen) {
              current.withScratch(() => {
                if (host.DialogTightenLoosenItem) host.TightenLoosenItemExit?.()
                for (let step = 0; step < 4 && (host.DialogFocusItem || host.ExtendedItemSubscreen); step++) {
                  const focus = host.DialogFocusItem
                  const subscreen = host.ExtendedItemSubscreen
                  host.ExtendedItemExit()
                  if (host.DialogFocusItem === focus && host.ExtendedItemSubscreen === subscreen) break
                }
              })
            }
          } catch (reason) {
            error ||= reason
          }
          if (status === 'saved' && !error) {
            try {
              const item = host.InventoryGet(scratch, groupName)
              if (!item?.Asset || item.Asset.Name !== source.Name) throw new Error('The edited item disappeared')
              const bundled = host.ServerBundledItemFromAppearanceItem(item)
              if (bundled?.Group !== groupName || bundled.Name !== source.Name) {
                throw new Error('BC could not save the edited item')
              }
              result = { ...clone(bundled), IsItem: true }
            } catch (reason) { error = reason }
          }
          try {
            if (interval !== null) host.clearInterval(interval)
            signal?.removeEventListener('abort', cancel)
            if (stillOwnsScreen) {
              host.CurrentScreen = prior.screen
              host.CurrentModule = prior.module
              host.CurrentScreenFunctions = prior.functions
              host.CurrentCharacter = prior.character
              host.DialogFocusItem = prior.focusItem
              host.DialogFocusSourceItem = prior.focusSource
              host.DialogFocusItemName = prior.focusName
              host.DialogExtendedMessage = prior.extendedMessage
              host.DialogMenuMode = prior.menuMode
              host.ExtendedItemSubscreen = prior.subscreen
              host.ExtendedItemPermissionMode = prior.permissionMode
              host.DialogTightenLoosenItem = prior.tightenItem
              if (prior.screen === 'ChatRoom' && prior.chatHidden !== true) {
                try { host.ChatRoomShowElements?.() } catch (reason) { error ||= reason }
              }
            } else {
              if (host.DialogFocusItem === focusedItem) host.DialogFocusItem = null
              if (host.DialogFocusSourceItem === focusedItem) host.DialogFocusSourceItem = null
            }
          } catch (reason) { error ||= reason }
          finally {
            if (prior.currentHandler === undefined) delete host.CharacterGetCurrentHandlers[SCREEN]
            else host.CharacterGetCurrentHandlers[SCREEN] = prior.currentHandler
            if (prior.background === undefined) delete host[`${SCREEN}Background`]
            else host[`${SCREEN}Background`] = prior.background
            hostElement.style.display = prior.hostDisplay
            try { if (scratch) host.CharacterDelete(scratch, false) } catch (reason) { error ||= reason }
            removed = true
            session = null
            setActive(false)
          }
          if (error) reject(error)
          else resolve(status === 'saved' ? { status, part: result } : { status: 'cancelled' })
        },
        requestFinish(status = 'saved') {
          if (current.closing) return
          if (current.dispatchDepth) {
            if (current.pendingFinish !== 'cancelled') current.pendingFinish = status
          }
          else current.finish(status)
        },
        withScratch(callback) {
          const previousCharacter = host.CurrentCharacter
          const previousCanInteract = host.Player?.CanInteract
          current.dispatchDepth++
          host.CurrentCharacter = scratch
          if (typeof previousCanInteract === 'function') host.Player.CanInteract = () => true
          try { return callback() }
          finally {
            if (typeof previousCanInteract === 'function') host.Player.CanInteract = previousCanInteract
            host.CurrentCharacter = previousCharacter
            current.dispatchDepth--
            if (current.dispatchDepth === 0 && current.pendingFinish) {
              const status = current.pendingFinish
              current.pendingFinish = null
              current.finish(status)
            }
          }
        },
        back() {
          if (backing || current.closing) return
          backing = true
          try {
            current.withScratch(() => {
              if (host.DialogTightenLoosenItem) {
                host.TightenLoosenItemExit?.()
                if (host.DialogFocusItem) host.DialogMenuMode = 'extended'
                else current.requestFinish()
              } else if (host.DialogFocusItem && typeof host.ExtendedItemExit === 'function') {
                host.ExtendedItemExit()
                if (!host.DialogFocusItem) current.requestFinish()
              } else current.requestFinish()
            })
          } finally { backing = false }
        },
      }

      try {
        scratch = host.CharacterLoadSimple(`VPWNativeItemEditor${++scratchId}`)
        if (!scratch) throw new Error('BC could not create a temporary item character')
        scratch.MemberNumber = 1000000000 + Math.floor(Math.random() * 1000000)
        scratch.AllowItem = true
        scratch.Inventory = (host.Player?.Inventory || []).map(entry => ({ ...entry }))
        scratch.Crafting = (host.Player?.Crafting || []).map(entry => ({ ...entry }))
        scratch.PermissionItems = {}
        scratch.LimitedItems = {}
        scratch.BlockItems = []
        scratch.OnlineSharedSettings = { AllowFullWardrobeAccess: true, BlockBodyCosplay: false,
          ItemsAffectExpressions: false }
        host.CharacterNaked(scratch, false)
        host.ServerAppearanceLoadFromBundle(scratch, scratch.AssetFamily, clone(bundle), scratch.MemberNumber)
        focusedItem = host.InventoryGet(scratch, groupName)
        if (!focusedItem?.Asset || focusedItem.Asset.Name !== source.Name) {
          throw new Error('BC could not load the selected item')
        }
        if (source.Difficulty !== undefined) focusedItem.Difficulty = source.Difficulty
        scratch.FocusGroup = focusedItem.Asset.Group
        host.CharacterRefresh(scratch, false, false)
        current.scratch = scratch
        session = current
        setActive(true)
        host.CharacterGetCurrentHandlers[SCREEN] = () => scratch
        host.CurrentScreen = SCREEN
        host.CurrentModule = 'Room'
        host.CurrentCharacter = null
        if (prior.screen === 'ChatRoom') host.ChatRoomHideElements?.()
        host[`${SCREEN}Background`] = 'Dressing'
        host.CurrentScreenFunctions = {
          Run() {
            try {
              current.withScratch(() => {
                host.ExtendedItemPermissionMode = false
                scratch.MustDraw = true
                host.CharacterAppearanceSetHeightModifiers?.(scratch)
                host.DrawCharacter(scratch, 250, 0, 1, true)
                if (host.DialogMenuMode === 'tighten' && host.DialogTightenLoosenItem) {
                  host.TightenLoosenItemDraw?.(host.DialogTightenLoosenItem)
                } else host[handlerBase + 'Draw']()
                host.DrawText?.(title, 1150, 70, 'White', 'Black')
                host.DrawButton?.(1885, 25, 90, 90, '', 'White', 'Icons/Exit.png', 'Back to wardrobe')
                host.DrawRect?.(1775, 25, 90, 90, '#777777')
                host.DrawText?.('X', 1820, 78, 'White', 'Black')
              })
            } catch (reason) { current.finish('cancelled', reason) }
          },
          Click() {
            try {
              if (host.MouseIn?.(1775, 25, 90, 90)) return
              current.withScratch(() => {
                if (host.DialogMenuMode === 'tighten' && host.DialogTightenLoosenItem) {
                  host.TightenLoosenItemClick?.(scratch, host.DialogTightenLoosenItem)
                  if (!host.DialogTightenLoosenItem) current.back()
                } else host[handlerBase + 'Click']()
                host.ExtendedItemPermissionMode = false
              })
            } catch (reason) { current.finish('cancelled', reason) }
          },
          KeyDown(event) {
            if (event?.key === 'Escape') current.back()
            else {
              try { current.withScratch(() => host[handlerBase + 'KeyDown']?.(event)) }
              catch (reason) { current.finish('cancelled', reason) }
            }
          },
          Exit() { current.back() },
          Draw() {}, Load() {}, Unload() {}, Resize() {}, MouseDown() {}, MouseUp() {},
          MouseMove() {}, MouseWheel() {}, KeyUp() {}, Paste() {},
        }
        host.DialogFocusSourceItem = null
        host.DialogFocusItem = focusedItem
        host.DialogFocusItemName = `${groupName}${source.Name}`
        host.DialogMenuMode = 'extended'
        host.ExtendedItemSubscreen = null
        host.ExtendedItemPermissionMode = false
        hostElement.style.display = 'none'
        signal?.addEventListener('abort', cancel, { once: true })
        current.withScratch(() => {
          host.ExtendedItemInit(scratch, focusedItem, false, false)
          host[handlerBase + 'Load']()
        })
        if (typeof host.setInterval === 'function') {
          interval = host.setInterval(() => {
            if (!removed && host.CurrentScreen !== SCREEN) current.finish('cancelled')
          }, 250)
        }
      } catch (reason) {
        if (session === current) current.finish('cancelled', reason)
        else {
          try { if (scratch) host.CharacterDelete(scratch, false) } catch { /* initial failure */ }
          reject(reason)
        }
      }
    })
  }

  const dispose = () => {
    cancel()
    for (const unhook of unhooks.reverse()) unhook?.()
  }
  return { open, cancel, dispose }
}

export function configureNativeItemEditor(options) {
  installedEditor?.dispose()
  const editor = createNativeItemEditor(options)
  installedEditor = editor
  return () => {
    if (installedEditor === editor) {
      editor.dispose()
      installedEditor = null
    }
  }
}

export function cancelNativeItemEditor() { installedEditor?.cancel() }

export function openNativeItemEditor(options) {
  if (!installedEditor) throw new Error('BC item editor is not ready')
  return installedEditor.open(options)
}
