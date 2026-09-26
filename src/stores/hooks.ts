/**
 * Typed React access to the (JS, loosely-typed) Zustand-backed stores.
 *
 * The wardrobe store stays plain JS. These wrappers document the indexed
 * library, cloud status, and shared character-preview surface used by the UI.
 *
 * Calling a store hook with no selector subscribes to the store's revision
 * counter and returns the live store context, so reads see current state and
 * any action re-renders the component.
 */
// @ts-ignore — plain JS store module
import { useFileSystemStore as rawFs } from './fileSystemStore.js'
// @ts-ignore — plain JS store module
import { useWorkbenchStore as rawWb } from './workbenchStore.js'

/** Minimal appearance shape shared by history records and saved outfits. */
export interface FileNode {
  id?: string
  name: string
  type?: string
  data?: unknown[]
  cloudSync?: boolean
  __thumbRefresh?: number
}

export interface WardrobeOutfit extends FileNode {
  id: string
  type: string
  data: unknown[]
  tagIds: string[]
  cloudSync: boolean
  vpwLocalFork?: { sourceId: string; sourceRev: [number, string] }
}

export interface WardrobeTag {
  id: string
  name: string
  aliasIds: string[]
}

export interface CloudQuota {
  wardrobeBytes: number
  otherExtensionsBytes: number
  totalBytes: number
  remainingBytes: number
  limitBytes: number
  usageRatio: number
  isWarning: boolean
  isOverLimit: boolean
}

export interface WardrobeSyncStatus {
  state: 'idle' | 'pending' | 'submitted' | 'verified' | 'offline' | 'quota' | 'error'
  localSaved: boolean
  lastSubmittedAt: number | null
  lastVerifiedAt: number | null
  error: string
  recoveryAvailable: boolean
}

/** Subset of the fileSystem store surface consumed by the React UI. */
export interface FsCtx {
  // state
  outfits: WardrobeOutfit[]
  tags: WardrobeTag[]
  selectedTagId: string | null
  fileTreeVersion: number
  historyVersion: number
  renderer: any
  character: any
  characterItem: unknown[]
  previewItem: { name?: string; data?: unknown[] } | null
  activeItem: { data?: unknown[] } | null
  lockedItem: FileNode | null
  thumbnailRefreshVersion: number
  activeFilters: string[]
  cloudQuota: CloudQuota
  syncStatus: WardrobeSyncStatus
  // actions
  initialize: (character?: any, options?: Record<string, unknown> & { preserveSlotControls?: boolean }) => Promise<void>
  selectTag: (id: string | null) => void
  createTag: (name: string) => string
  renameTag: (id: string, name: string) => boolean
  deleteTag: (id: string) => boolean
  addOutfit: (outfit: { name: string; type: string; data: unknown[]; tagIds?: string[]; cloudSync?: boolean }) => string
  updateOutfit: (id: string, changes: Partial<Pick<WardrobeOutfit, 'name' | 'type' | 'data' | 'tagIds' | 'cloudSync'>>) => boolean
  removeOutfit: (id: string) => boolean
  setOutfitTags: (id: string, tagIds: string[]) => boolean
  setOutfitCloudSync: (id: string, enabled: boolean) => boolean
  exportWardrobe: () => unknown
  exportRecovery: () => Array<{ key: string; reason: string; data: unknown }>
  importWardrobe: (parsed: unknown, options?: { tagName?: string }) => { count: number }
  syncNow: () => boolean
  setActiveItem: (item: FileNode | -1, options?: { ignoreLock?: boolean }) => void
  selectOutfit: (item: FileNode) => boolean
  togglePreviewLock: (item: FileNode) => boolean
  isPreviewLockedOn: (item: FileNode) => boolean
  clearSelection: () => void
  applyFilteredOutfitToCharacter: (opts?: { outfitData?: unknown[] }) => boolean
  applyCurrentPreviewToCharacter: () => boolean
  startThumbnailGeneration: (item: FileNode) => void
  refreshThumbnails: (items?: FileNode[] | null) => void
  refreshCloudQuotaStats: (snapshot?: unknown) => unknown
  // history
  addToHistory: (data: unknown[]) => void
  getHistoryRecords: () => Array<{ name: string; data?: unknown[] }>
  loadHistoryRecord: (record: unknown) => void
  deleteHistoryRecord: (record: unknown) => boolean
  clearHistory: () => void
  // filters / slot controls
  filterSnapshot: { groups?: unknown[]; visibleGroups?: unknown[]; items?: unknown[] }
  groupOperations: Record<string, { mode: 'original' | 'incoming'; operation: 'add' | 'replace' | 'full-replace'; baseModes: Record<string, 'original' | 'incoming' | 'empty'> }>
  slotControlMap: Record<string, { mode?: string; locked?: boolean }>
  slotPresenceMap: Record<string, { inCharacter?: boolean; inHover?: boolean }>
  getSlotControlState: (key: string) => { mode: string; locked?: boolean }
  setSlotMode: (key: string, mode: string) => boolean
  setAllSlotModes: (mode: string) => boolean
  setGroupSlotModes: (groupID: string, mode: string) => boolean
  getGroupSourceAction: (groupID: string, mode: string) => { operation: 'add' | 'replace' | 'full-replace'; complete: boolean } | null
  progressGroupSource: (groupID: string, mode: string) => 'add' | 'replace' | 'full-replace' | false
  replaceAllFromSource: (mode: string) => boolean
  preserveBody: () => boolean
  replaceBodyOnly: () => boolean
  getAllModeState: (mode: string) => 'none' | 'partial' | 'full'
  getGroupModeState: (groupID: string, mode: string) => 'none' | 'partial' | 'full'
}

export interface WardrobeUi {
  searchScope: 'current' | 'all'
  sortBy: 'recent' | 'name' | 'type'
  fileViewMode: 'card' | 'list'
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
