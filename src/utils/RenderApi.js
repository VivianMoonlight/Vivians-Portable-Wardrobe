import { hostWindow } from './host-window.js'

const sessions = new Map()
let capturing = null
let hooksActive = false
let characterId = 0
const failedImagesByOutfit = new Map()
const maxFailedOutfits = 32

/** Retry only this outfit's exhausted BC requests, preserving the shared loaders. */
export function retryFailedImagesForOutfit(data) {
  if (!Array.isArray(data)) return 0
  const key = JSON.stringify(data)
  const images = failedImagesByOutfit.get(key)
  failedImagesByOutfit.delete(key)
  let retried = 0
  for (const image of images || []) {
    if (imageState(image) !== 'error') continue
    image.errorcount = 0
    image.src = image.src
    retried++
  }
  return retried
}

function capture(session, draw) {
  const previous = capturing
  capturing = session
  try { return draw() } finally { capturing = previous }
}

/** Observe BC's existing caches; do not issue a second image request. */
export function installRenderHooks(modApi) {
  if (!modApi?.hookFunction) return () => {}
  const removers = []
  const hook = (name, callback) => {
    if (typeof hostWindow[name] !== 'function') return false
    removers.push(modApi.hookFunction(name, 0, callback))
    return true
  }
  try {
    const canvasImages = hook('DrawGetImage', (args, next) => {
      const image = next(args)
      capturing?.watchImage(image)
      return image
    })
    const glImages = hook('GLDrawLoadImage', (args, next) => {
      const texture = next(args)
      capturing?.watchImage(hostWindow.GLDrawImageCache?.get(args[1]))
      return texture
    })
    hook('CharacterAppearanceBuildCanvas', (args, next) => {
      const session = sessions.get(args[0])
      const result = capture(session || null, () => next(args))
      // The game can rebuild this character itself, e.g. after context recovery.
      if (session && !session.drawing) session.scheduleDraw(false)
      return result
    })
    hooksActive = canvasImages || glImages
  } catch (error) {
    for (const remove of removers.reverse()) remove?.()
    throw error
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const session of [...sessions.values()]) session.dispose()
    for (const remove of removers.reverse()) remove?.()
    failedImagesByOutfit.clear()
    hooksActive = false
  }
}

function imageState(image) {
  if (image.complete && image.naturalWidth > 0) return 'ready'
  // BC owns retries in both the 2D and WebGL loaders (three attempts).
  return image.errorcount >= 3 ? 'error' : 'loading'
}

/** One appearance per character, retained until its actual image dependencies settle. */
export function createRenderSession({ data = [], canvas, width = 500, height = 1000, onUpdate = () => {}, timeout = 20000 } = {}) {
  const images = new Map()
  const outfitKey = JSON.stringify(data)
  let character = null
  let frame = null
  let deadline = null
  let disposed = false
  let prepared = false
  let rebuild = false
  const requestFrame = hostWindow.requestAnimationFrame?.bind(hostWindow)
    || (callback => hostWindow.setTimeout(callback, 16))
  const cancelFrame = hostWindow.cancelAnimationFrame?.bind(hostWindow) || hostWindow.clearTimeout.bind(hostWindow)

  const emit = status => {
    if (disposed) return
    if (status.state === 'ready') failedImagesByOutfit.delete(outfitKey)
    else if (status.state === 'error') {
      const failed = [...images.keys()].filter(image => imageState(image) === 'error')
      if (failed.length) {
        failedImagesByOutfit.delete(outfitKey)
        failedImagesByOutfit.set(outfitKey, failed)
        while (failedImagesByOutfit.size > maxFailedOutfits) {
          failedImagesByOutfit.delete(failedImagesByOutfit.keys().next().value)
        }
      }
    }
    try { onUpdate(canvas, status) } catch (error) { console.warn('[VPW] Preview subscriber failed', error) }
  }

  const session = {
    drawing: false,
    watchImage(image) {
      // Dynamic layers can supply a ready-made canvas instead of an Image.
      if (disposed || !image || typeof image.complete !== 'boolean'
        || typeof image.addEventListener !== 'function' || images.has(image)) return
      const changed = event => {
        if (event.type === 'error' && imageState(image) === 'loading') return
        session.scheduleDraw(true)
      }
      images.set(image, changed)
      image.addEventListener('load', changed)
      image.addEventListener('error', changed)
    },
    scheduleDraw(needsRebuild = true) {
      if (disposed) return
      rebuild ||= needsRebuild
      if (frame !== null) return
      frame = requestFrame(() => {
        frame = null
        draw()
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (frame !== null) cancelFrame(frame)
      if (deadline !== null) hostWindow.clearTimeout(deadline)
      for (const [image, changed] of images) {
        image.removeEventListener('load', changed)
        image.removeEventListener('error', changed)
      }
      images.clear()
      if (character) {
        sessions.delete(character)
        // Keep BC's shared image/texture caches, remove only our temporary NPC.
        hostWindow.CharacterDelete(character, false)
      }
    },
  }

  function draw() {
    if (disposed) return
    session.drawing = true
    try {
      const ctx = canvas?.getContext('2d')
      if (!ctx) throw new Error('Preview canvas is unavailable')
      capture(session, () => {
        if (!prepared) {
          hostWindow.CharacterNaked(character, false)
          hostWindow.ServerAppearanceLoadFromBundle(character, character.AssetFamily, data, character.MemberNumber)
          hostWindow.CharacterRefresh(character, false, false)
          prepared = true
        }
        if (rebuild) character.MustDraw = true
        rebuild = false
        ctx.save()
        try {
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          hostWindow.DrawCharacter(character, 0, 0, Math.min(width / 500, height / 1000), true, ctx)
        } finally { ctx.restore() }
      })
      const states = [...images.keys()].map(imageState)
      if (states.includes('error')) {
        emit({ state: 'error', error: 'A preview image failed to load after BC retried it' })
      } else {
        // A redraw can discover more dependencies through BC's dynamic layers.
        emit({ state: states.includes('loading') ? 'loading' : 'ready' })
      }
    } catch (error) {
      emit({ state: 'error', error: error instanceof Error ? error.message : String(error) })
    } finally { session.drawing = false }
  }

  try {
    const required = ['CharacterLoadSimple', 'CharacterNaked', 'ServerAppearanceLoadFromBundle', 'CharacterRefresh', 'CharacterDelete', 'DrawCharacter']
    if (!hooksActive || required.some(name => typeof hostWindow[name] !== 'function')) {
      throw new Error('BC preview rendering is not available')
    }
    character = hostWindow.CharacterLoadSimple('VPWRenderCharacter' + ++characterId)
    if (!character) throw new Error('BC could not create a preview character')
    character.MemberNumber = 1000000000 + characterId
    sessions.set(character, session)
    // A stalled request ends with a retryable error, never a cached partial success.
    deadline = hostWindow.setTimeout(() => emit({ state: 'error', error: 'Preview image loading timed out' }), timeout)
    draw()
  } catch (error) {
    emit({ state: 'error', error: error instanceof Error ? error.message : String(error) })
  }
  return session
}

export const RenderApi = { createRenderSession }
