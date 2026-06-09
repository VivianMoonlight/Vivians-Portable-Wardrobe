/**
 * Typed React access to the (JS, loosely-typed) Zustand-backed stores.
 *
 * The large file-system store stays plain JS while it is being migrated from
 * its original options-style shape. These thin wrappers give components a
 * clear, documented contract without re-typing the whole 1.4k-line store.
 *
 * Calling a store hook with no selector subscribes to the store's revision
 * counter and returns the live store context, so reads see current state and
 * any action re-renders the component.
 */
// @ts-ignore — plain JS store module
import { useFileSystemStore as rawFs } from './fileSystemStore.js'
// @ts-ignore — plain JS store module
import { useWorkbenchStore as rawWb } from './workbenchStore.js'

export interface FileNode {
  name: string
  type?: string
  data?: unknown[]
  children?: FileNode[]
  cloudSync?: boolean
  __thumbRefresh?: number
}

export interface SearchHit {
  item: FileNode
  path: string[]
}

/** Subset of the fileSystem store surface consumed by the React UI. */
export interface FsCtx {
  // state
  fs: any
  fileTreeVersion: number
  currentPath: string[]
  renderer: any
  character: any
  characterItem: unknown[]
  previewItem: { name?: string; data?: unknown[] } | null
  activeItem: { data?: unknown[] } | null
  lockedItem: FileNode | null
  thumbnailRefreshVersion: number
  activeFilters: string[]
  cloudQuota: {
    usedBytes?: number
    limitBytes?: number
    usageRatio?: number
    isWarning?: boolean
    isOverLimit?: boolean
  }
  // getters
  currentNode: { children?: FileNode[] } | null
  filteredItems: FileNode[]
  // actions
  initialize: (character?: any, options?: Record<string, unknown>) => Promise<void>
  moveTo: (path: string[]) => void
  addFile: (file: Partial<FileNode>) => void
  removeFile: (item: FileNode, parentPath?: string[]) => void
  moveFile: (name: string, fromPath?: string[], toPath?: string[]) => void
  saveAll: () => void
  setActiveItem: (item: FileNode | -1, options?: { ignoreLock?: boolean }) => void
  togglePreviewLock: (item: FileNode) => boolean
  isPreviewLockedOn: (item: FileNode) => boolean
  clearSelection: () => void
  applyFilteredOutfitToCharacter: (opts?: { outfitData?: unknown[]; mode?: string }) => boolean
  applyCurrentPreviewToCharacter: () => boolean
  startThumbnailGeneration: (item: FileNode) => void
  refreshThumbnails: (items?: FileNode[] | null) => void
  searchFiles: (query: string) => SearchHit[]
  setNodeCloudSync: (item: FileNode, enabled: boolean, opts?: { recursive?: boolean }) => boolean
  refreshCloudQuotaStats: (snapshot?: unknown) => unknown
  // history
  getHistoryRecords: () => Array<{ name: string; data?: unknown[] }>
  loadHistoryRecord: (record: unknown) => void
  deleteHistoryRecord: (record: unknown) => boolean
  clearHistory: () => void
  // filters / slot controls
  filterSnapshot: { groups?: unknown[]; visibleGroups?: unknown[]; items?: unknown[] }
  defaultReplaceMode: string
  slotControlMap: Record<string, { mode?: string; locked?: boolean }>
  slotPresenceMap: Record<string, { inCharacter?: boolean; inHover?: boolean }>
  getSlotControlState: (key: string) => { mode: string; locked?: boolean }
  setSlotMode: (key: string, mode: string) => boolean
  setAllSlotModes: (mode: string) => void
  setGroupSlotModes: (groupID: string, mode: string) => void
  setDefaultReplaceMode: (mode: string) => void
  // escalating scope toggles + their tri-state for button styling
  smartSetAllMode: (mode: string) => boolean
  smartSetGroupMode: (groupID: string, mode: string) => boolean
  getAllModeState: (mode: string) => 'none' | 'partial' | 'full'
  getGroupModeState: (groupID: string, mode: string) => 'none' | 'partial' | 'full'
  reapplyDefaultMode: () => void
}

export interface WardrobeUi {
  searchScope: 'current' | 'all'
  sortBy: 'recent' | 'name' | 'type'
  fileViewMode: 'large' | 'small' | 'list'
  leftPanelCollapsed: boolean
  rightPanelCollapsed: boolean
}

/** Subset of the workbench store surface consumed by the React UI. */
export interface WbCtx {
  activeTab: string
  wardrobeUi: WardrobeUi
  setActiveTab: (tab: string) => void
  setWardrobeUi: (partial: Partial<WardrobeUi>) => void
}

/** Reactive access to the fileSystem store (live context). */
export function useFs(): FsCtx {
  return rawFs() as FsCtx
}

/** Fine-grained reactive access. Select stable state refs/primitives only. */
export function useFsSelector<U>(selector: (ctx: FsCtx) => U): U {
  return rawFs(selector as any) as U
}

/** Non-reactive access for event handlers / one-off reads. */
export function getFs(): FsCtx {
  return rawFs.getState() as FsCtx
}

/** Reactive access to the workbench store. */
export function useWb(): WbCtx {
  return rawWb() as WbCtx
}

/** Fine-grained reactive access to the workbench store. */
export function useWbSelector<U>(selector: (ctx: WbCtx) => U): U {
  return rawWb(selector as any) as U
}

/** Non-reactive workbench access for event handlers. */
export function getWb(): WbCtx {
  return rawWb.getState() as WbCtx
}
