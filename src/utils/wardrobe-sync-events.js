function isLoginResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const validId = (typeof data.ID === 'string' && data.ID.length > 0)
    || (typeof data.ID === 'number' && Number.isFinite(data.ID))
  return validId
    && typeof data.AccountName === 'string' && data.AccountName.length > 0
    && typeof data.Name === 'string' && data.Name.length > 0
    && data.MemberNumber != null
}

/** Connect host events to persistence callbacks without owning any store state. */
export function installWardrobeSyncEvents({
  hostWindow,
  modApi,
  onLogin,
  onStorage,
  onOnline,
  onOffline,
  onError = (error) => console.warn('[VPW] Sync event failed', error),
}) {
  let disposed = false
  let socket = null
  let unhookLogin = null

  const reportError = (error) => {
    try { onError?.(error) } catch { /* Error reporting must not interrupt the game. */ }
  }
  const call = (callback, payload) => {
    if (disposed || typeof callback !== 'function') return
    try {
      const result = callback(payload)
      if (result && typeof result.catch === 'function') result.catch(reportError)
    } catch (error) {
      reportError(error)
    }
  }

  const socketOnline = () => call(onOnline, { source: 'socket' })
  const socketOffline = (reason) => call(onOffline, { source: 'socket', reason })
  const detachSocket = () => {
    if (!socket) return
    const remove = socket.off || socket.removeListener
    if (typeof remove === 'function') {
      remove.call(socket, 'connect', socketOnline)
      remove.call(socket, 'disconnect', socketOffline)
    }
    socket = null
  }
  const bindSocket = () => {
    const nextSocket = hostWindow.ServerSocket
    if (nextSocket === socket) return
    detachSocket()
    if (typeof nextSocket?.on !== 'function') return
    socket = nextSocket
    socket.on('connect', socketOnline)
    socket.on('disconnect', socketOffline)
  }

  const storage = (event) => call(onStorage, event)
  const online = () => {
    try { bindSocket() } catch (error) { reportError(error) }
    call(onOnline, { source: 'browser' })
  }
  const offline = () => call(onOffline, { source: 'browser' })
  hostWindow.addEventListener('storage', storage)
  hostWindow.addEventListener('online', online)
  hostWindow.addEventListener('offline', offline)
  try { bindSocket() } catch (error) { reportError(error) }

  try {
    if (typeof modApi?.hookFunction === 'function') {
      unhookLogin = modApi.hookFunction('LoginResponse', 0, (args, next) => {
        // Let the game finish login/relogin before touching wardrobe state. A
        // relog skips LoginSetupPlayer, so Player.ExtensionSettings can be stale.
        const result = next(args)
        if (disposed) return result
        try {
          const data = args[0]
          if (!isLoginResponse(data)) return result
          bindSocket()
          const extensionSettings = { ...(data.ExtensionSettings ?? {}) }
          call(onLogin, {
            memberNumber: data.MemberNumber,
            extensionSettings,
            rawWardrobe: extensionSettings.VPWardrobe,
          })
        } catch (error) {
          reportError(error)
        }
        return result
      })
    }
  } catch (error) {
    reportError(error)
  }

  return () => {
    if (disposed) return
    disposed = true
    hostWindow.removeEventListener('storage', storage)
    hostWindow.removeEventListener('online', online)
    hostWindow.removeEventListener('offline', offline)
    try { detachSocket() } catch (error) { reportError(error) }
    try { unhookLogin?.() } catch (error) { reportError(error) }
  }
}
