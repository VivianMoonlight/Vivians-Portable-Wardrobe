const SCREEN = 'VPWRestraints'
const MODULE = 'Character'

// BC draws and dispatches its own dialog while CurrentCharacter is set. Register
// a real parent screen so Appearance can unload it and later load it again.
export function createRestraintSession(host, scratch, origin, labels, complete, hook) {
  const doc = host.document
  const bar = doc.createElement('div')
  bar.style.cssText = 'position:fixed;bottom:1rem;left:1rem;z-index:2147483647;display:flex;gap:.4rem;align-items:center;background:#25232b;color:white;padding:.45rem'
  const message = doc.createElement('span')
  message.setAttribute('role', 'status')
  let group = scratch.Appearance.find(item => item.Asset?.Group.Category === 'Item')?.Asset.Group.Name
    || host.AssetGroup.find(entry => entry.Category === 'Item' && entry.Zone?.length)?.Name
  let phase = 'opening'
  let clothingVisit = 0
  let cancelled = false
  let disposed = false
  let retry = null
  let completing = false
  const atParent = () => host.CurrentModule === MODULE && host.CurrentScreen === SCREEN
  const inClothes = () => host.CurrentScreen === 'Appearance' && host.CharacterAppearanceSelection === scratch
  let leavingDialog = false

  const controls = []
  function button(label, action) {
    const el = doc.createElement('button')
    el.type = 'button'
    el.textContent = label
    el.addEventListener('click', action)
    bar.append(el)
    controls.push(el)
    return el
  }
  function show(visible) {
    bar.style.display = visible && (!canvasControls || retry || message.textContent) ? 'flex' : 'none'
    retryButton.hidden = !retry
    for (const el of controls.slice(0, 3)) el.hidden = !!retry
  }
  function failed(action, error) {
    retry = action
    message.textContent = String(error?.message || labels.returnFailed)
    show(true)
  }
  async function go(module, screen) {
    await host.CommonSetScreen(module, screen)
    if (host.CurrentModule !== module || host.CurrentScreen !== screen) throw new Error(labels.returnFailed)
  }
  function leaveDialog() {
    if (host.CurrentCharacter !== scratch) return
    group = scratch.FocusGroup?.Name || group
    leavingDialog = true
    try { host.DialogLeave({ reload: false }) } finally { leavingDialog = false }
  }
  function loadDialog() {
    host.DialogMenuMode = null
    host.DialogFocusItem = null
    host.DialogFocusItemName = null
    host.DialogFocusSourceItem = null
    host.DialogTightenLoosenItem = null
    host.ExtendedItemSubscreen = null
    host.ExtendedItemPermissionMode = false
    host.Player.FocusGroup = null
    host.CurrentCharacter = scratch
    host.DialogChangeFocusToGroup(scratch, group)
  }
  function ready() {
    phase = 'items'
    show(true)
    if (cancelled) void finish('cancelled')
  }
  async function returnToItems() {
    if (disposed || phase !== 'clothes' || !inClothes()) return
    phase = 'returning'
    try {
      await go(MODULE, SCREEN)
      if (!disposed) ready()
    } catch (error) {
      if (inClothes()) {
        phase = 'clothes'
        failed(returnToItems, error)
      } else if (!disposed) complete('cancelled', error)
    }
  }
  function clothes() {
    if (phase !== 'items') return
    phase = 'clothes'
    const visit = ++clothingVisit
    try {
      leaveDialog()
      show(false)
      host.CharacterAppearanceLoadCharacter(scratch, () => {
        if (visit === clothingVisit) void returnToItems()
      })
      // CommonSetScreen can resolve after BC rolls a failed Appearance load back.
      Promise.resolve(host.ScreenIsLoadingPromise).then(() => {
        if (!disposed && visit === clothingVisit && phase === 'clothes' && atParent()) {
          ready()
          message.textContent = labels.returnFailed
        }
      }, error => {
        if (disposed || visit !== clothingVisit || phase !== 'clothes') return
        if (atParent()) { loadDialog(); ready(); message.textContent = error.message }
        else if (inClothes()) failed(returnToItems, error)
        else complete('cancelled', error)
      })
    }
    catch (error) {
      if (atParent()) { loadDialog(); ready(); message.textContent = error.message }
      else failed(returnToItems, error)
    }
  }
  async function finish(status) {
    if (disposed || completing) return
    if (!atParent()) return
    completing = true
    phase = 'exiting'
    show(false)
    try {
      leaveDialog()
      await go(origin.module, origin.screen)
      if (!disposed) complete(cancelled ? 'cancelled' : status)
    } catch (error) {
      if (atParent()) {
        phase = 'items'
        failed(() => finish(status), error)
      }
      else if (!disposed) complete('cancelled', error)
    } finally { completing = false }
  }
  const actions = [
    [labels.clothes, clothes],
    [labels.copy, () => finish('copy')],
    [labels.save, () => finish('saved')],
    [labels.exit, () => finish('cancelled')],
  ]
  for (const [label, action] of actions) button(label, action)
  const retryButton = button(labels.retry, () => {
    const action = retry
    retry = null
    message.textContent = ''
    show(false)
    action?.()
  })
  bar.append(message)
  const removeHooks = []
  const register = (name, handler) => {
    if (typeof host[name] === 'function') removeHooks.push(hook(name, handler))
  }
  const handlers = {
    Run() {}, Click() {}, Load() { if (!disposed) loadDialog() },
    Unload() { if (!disposed) leaveDialog() },
    Background: 'Dressing',
  }
  const original = new Map()
  for (const [suffix, handler] of Object.entries(handlers)) {
    const key = SCREEN + suffix
    original.set(key, host[key])
    host[key] = handler
  }
  const previousGetter = host.CharacterGetCurrentHandlers[SCREEN]
  host.CharacterGetCurrentHandlers[SCREEN] = () => scratch
  // R134 reserves the left column for Player when interacting with another
  // character. Keep the scratch target at BC's normal hit-test coordinates.
  register('DrawCharacter', (args, next) => {
    if (atParent() && args[0] === host.Player && args[1] === 0) return
    return next(args)
  })
  const canvasControls = typeof host.DrawButton === 'function' && typeof host.DialogDraw === 'function'
  register('DialogDraw', (args, next) => {
    const result = next(args)
    if (canvasControls && atParent() && phase === 'items' && !retry) {
      actions.forEach(([label], i) => host.DrawButton(30, 40 + 95 * i, 420, 80, label, 'White'))
    }
    return result
  })
  register('DialogClick', (args, next) => {
    if (canvasControls && atParent() && phase === 'items' && !retry) {
      const action = actions.find((_, i) => host.MouseIn(30, 40 + 95 * i, 420, 80))
      if (action) { action[1](); return }
    }
    if (atParent() && host.MouseIn(0, 0, 500, 1000)) return
    return next(args)
  })
  register('DialogChangeFocusToGroup', (args, next) => {
    if (atParent() && args[0] !== scratch) return
    return next(args)
  })
  register('DialogLeave', (args, next) => {
    if (!leavingDialog && atParent() && phase === 'items' && host.CurrentCharacter === scratch) {
      if (host.DialogMenuMode === 'dialog') { void finish('cancelled'); return }
      // R134 also calls DialogLeave after equipping ordinary or preset items.
      // Keep the worn result and rebuild the inventory for the same group.
      group = scratch.FocusGroup?.Name || group
      next([{ reload: false }])
      loadDialog()
      return
    }
    return next(args)
  })
  return {
    async start() {
      doc.body.append(bar)
      show(false)
      await go(MODULE, SCREEN)
      if (!disposed) ready()
    },
    owns: atParent,
    cancel() {
      cancelled = true
      if (phase === 'items' || (atParent() && retry)) void finish('cancelled')
      else if (phase === 'clothes' && inClothes()) {
        if (retry) void returnToItems()
        else host.CharacterAppearanceExit(scratch)
      }
    },
    check() {
      if ((phase === 'items' && !atParent()) || (phase === 'clothes' && !inClothes() && !atParent())) {
        complete('cancelled', null, false)
      }
    },
    dispose() {
      disposed = true
      bar.remove()
      for (const remove of removeHooks.reverse()) remove?.()
      if (previousGetter === undefined) delete host.CharacterGetCurrentHandlers[SCREEN]
      else host.CharacterGetCurrentHandlers[SCREEN] = previousGetter
      for (const [key, value] of original) {
        if (value === undefined) delete host[key]
        else host[key] = value
      }
      if (host.CurrentCharacter === scratch) host.CurrentCharacter = null
    },
  }
}
