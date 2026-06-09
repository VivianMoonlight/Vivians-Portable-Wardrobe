/**
 * Pinia-compatible options-store adapter built on Zustand.
 *
 * The wardrobe's two stores (`fileSystemStore`, `workbenchStore`) were written
 * with Pinia's options API: `{ state, getters, actions }` where actions/getters
 * read & write through `this`. Rather than hand-port ~1.4k lines of battle-tested
 * (and un-runtime-testable) game logic, we reuse it verbatim on top of this
 * adapter — which is what actually removes the Vue/Pinia runtime dependency.
 *
 * Reactivity model (deliberately coarse): every action call bumps a private
 * `__rev` counter after it settles; React components subscribe to `__rev`, so
 * any store mutation triggers a re-render and selectors recompute from live
 * state. This also catches in-place mutations of held service instances
 * (FileSystem, RenderService, …) that Pinia's deep proxy used to track. The
 * wardrobe panels are low-frequency, so whole-store invalidation is fine.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'

/**
 * `toRaw` shim. Vue's `toRaw` unwraps reactive proxies; Zustand state holds
 * plain objects and class instances, so identity is the correct behaviour.
 */
export function toRaw<T>(value: T): T {
  return value
}

type AnyState = Record<string, any>
type GetterMap = Record<string, (state: AnyState) => any>
type ActionMap = Record<string, (...args: any[]) => any>

interface StoreDefinition {
  state: () => AnyState
  getters?: GetterMap
  actions?: ActionMap
}

export interface BoundStore {
  /** React hook. With a selector returns the selected slice; without, the ctx. */
  <U>(selector: (ctx: any) => U): U
  (): any
  /** Non-reactive access to the store context (Pinia-style `this`). */
  getState: () => any
  /** Subscribe to raw state changes. */
  subscribe: StoreApi<AnyState>['subscribe']
  /** Underlying zustand vanilla store. */
  readonly api: StoreApi<AnyState>
}

export function defineStore(_id: string, def: StoreDefinition): BoundStore {
  let api: StoreApi<AnyState> | null = null
  let ctx: any = null

  function ensure(): void {
    if (api) return

    api = createStore<AnyState>(() => ({ ...def.state(), __rev: 0 }))
    const getters = def.getters ?? {}
    const actions = def.actions ?? {}

    const notify = (): void => {
      const s = api!.getState()
      // Replace the state ref and bump __rev so subscribers fire exactly once
      // per settled action (intermediate direct `this.x =` writes don't).
      api!.setState({ ...s, __rev: (s.__rev ?? 0) + 1 }, true)
    }

    ctx = new Proxy(Object.create(null), {
      get(_target, prop: string | symbol) {
        if (typeof prop === 'symbol') return undefined
        if (prop === '$notify') return notify
        if (prop === '$api') return api
        if (prop in getters) return getters[prop](api!.getState())
        if (prop in actions) {
          return (...args: any[]) => {
            // Only notify if the action actually mutated state. Every `this.x = …`
            // goes through the `set` trap -> a fresh state object, so a changed
            // top-level ref means a real mutation. Read-only "actions" (e.g.
            // isPreviewLockedOn, searchFiles) make no assignment, so they must
            // NOT bump — otherwise calling one during render is an infinite loop
            // (React error #185).
            const before = api!.getState()
            const maybeNotify = () => {
              if (api!.getState() !== before) notify()
            }
            const result = actions[prop].apply(ctx, args)
            if (result && typeof (result as Promise<unknown>).then === 'function') {
              return (result as Promise<unknown>).finally(maybeNotify)
            }
            maybeNotify()
            return result
          }
        }
        return api!.getState()[prop]
      },
      set(_target, prop: string, value: unknown) {
        if (typeof prop === 'string') api!.setState({ [prop]: value })
        return true
      },
      has(_target, prop: string) {
        const s = api!.getState()
        return prop in s || prop in getters || prop in actions
      },
    })
  }

  const useBound = ((selector?: (ctx: any) => any) => {
    ensure()
    if (selector) {
      // Selector callers opt into fine-grained subscriptions. Keep selectors on
      // stable state refs/primitives; fresh derived objects belong in component
      // useMemo so unrelated store actions do not wake the component.
      return useStore(api!, () => selector(ctx))
    }
    // Subscribe to the revision counter to drive re-renders; the actual value is
    // computed from the live ctx so consumers returning fresh arrays/objects are
    // safe (no getSnapshot caching pitfalls).
    useStore(api!, (s) => s.__rev)
    return ctx
  }) as BoundStore

  useBound.getState = () => {
    ensure()
    return ctx
  }
  useBound.subscribe = ((listener: any) => {
    ensure()
    return api!.subscribe(listener)
  }) as BoundStore['subscribe']
  Object.defineProperty(useBound, 'api', {
    get() {
      ensure()
      return api
    },
  })

  return useBound
}
