/**
 * Keep one wardrobe writer per BC account across tabs on the same origin.
 * @param {{ locks?: LockManager, onChange?: (owned: boolean, member: string | null) => void }} options
 */
export function createWardrobeTabLock({ locks = null, onChange = () => {} } = {}) {
  const supported = typeof locks?.request === 'function'
  let generation = 0
  let owner = null
  let pending = null
  let abortWaiting = null
  let releaseHeld = null
  let disposed = false

  const setOwner = member => {
    if (owner === member) return
    owner = member
    onChange(member !== null, member)
  }

  const release = () => {
    generation++
    abortWaiting?.abort()
    abortWaiting = null
    const done = releaseHeld
    releaseHeld = null
    pending?.settle(false)
    pending = null
    setOwner(null)
    done?.()
  }

  const acquire = memberNumber => {
    const member = String(memberNumber)
    if (disposed || !supported || !/^(?:\d+|origin)$/.test(member)) return Promise.resolve(false)
    if (owner === member) return Promise.resolve(true)
    if (pending?.member === member) return pending.promise

    release()
    const ticket = generation
    const controller = new AbortController()
    abortWaiting = controller
    let settle
    const acquired = new Promise(resolve => { settle = resolve })
    pending = { member, promise: acquired, settle }

    Promise.resolve().then(() => locks.request(
      `VPW:wardrobe:${member}`,
      { mode: 'exclusive', signal: controller.signal },
      async lock => {
        if (ticket !== generation || disposed || !lock) {
          settle(false)
          return
        }
        abortWaiting = null
        const held = new Promise(resolve => { releaseHeld = resolve })
        setOwner(member)
        settle(true)
        await held
      },
    )).catch(() => {
      if (ticket === generation) settle(false)
    }).finally(() => {
      if (ticket !== generation) return
      abortWaiting = null
      releaseHeld = null
      pending = null
      setOwner(null)
      settle(false)
    })

    return acquired
  }

  return {
    supported,
    acquire,
    isHeldFor: memberNumber => owner === String(memberNumber),
    token: () => generation,
    release,
    dispose: () => { disposed = true; release() },
  }
}
