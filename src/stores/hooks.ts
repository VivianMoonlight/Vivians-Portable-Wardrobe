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
  rev: [number, string]
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
  proposalAvailable?: boolean
  observed?: {
    wardrobeBytes: number
    otherExtensionsBytes: number
    totalBytes: number
    remainingBytes: number
    limitBytes: number
    usageRatio: number
    isWarning: boolean
    isOverLimit: boolean
  }
  observedSource?: 'login-response' | 'player-cache'
}

export interface WardrobeSyncStatus {
  state: 'idle' | 'pending' | 'submitted' | 'verified' | 'offline' | 'quota' | 'error' | 'conflict'
  localSaved: boolean
  lastSubmittedAt: number | null
  lastVerifiedAt: number | null
  error: string
  errorCode?: string | null
  recoveryAvailable: boolean
  conflicts?: WardrobeSyncConflict[]
}

export interface CloudflareSyncStatus {
  enabled: boolean
  ready: boolean
  syncing: boolean
  pending: boolean
  error: string
  errorCode: string | null
  lastSyncedAt: number | null
  keyAvailable: boolean
  keySavedToBC: boolean
  bcLegacyRetained: boolean | null
  bcLegacyChanged: boolean
}

export interface WardrobeSyncConflict {
  kind: string
  id: string
  field: string
  type: string
  base: unknown
  local: unknown
  remote: unknown
}

export interface WardrobeConflictResolution {
  kind: string
  id: string
  field: string
  choice: 'local' | 'cloud' | 'discard'
}

/** Subset of the fileSystem store surface consumed by the React UI. */
export interface FsCtx {
  // state
  wardrobeIndex: unknown
  outfits: WardrobeOutfit[]
  tags: WardrobeTag[]
  selectedTagId: string | null
  fileTreeVersion: number
  historyVersion: number
  historyStorageStatus: 'loading' | 'ready' | 'archived' | 'conflict' | 'error'
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
  cloudflareSyncStatus: CloudflareSyncStatus
  // actions
  initialize: (character?: any, options?: Record<string, unknown> & { preserveSlotControls?: boolean }) => Promise<void>
  selectTag: (id: string | null) => void
  createTag: (name: string) => Promise<string>
  renameTag: (id: string, name: string) => Promise<boolean>
  deleteTag: (id: string) => Promise<boolean>
  addOutfit: (outfit: { name: string; type: string; data: unknown[]; tagIds?: string[]; cloudSync?: boolean }) => Promise<string>
  updateOutfit: (id: string, changes: Partial<Pick<WardrobeOutfit, 'name' | 'type' | 'data' | 'tagIds' | 'cloudSync'>>) => Promise<boolean>
  updateOutfitIfUnchanged: (id: string, expectedRev: [number, string], changes: Partial<Pick<WardrobeOutfit, 'name' | 'type' | 'data' | 'tagIds' | 'cloudSync'>>) => Promise<boolean>
  removeOutfit: (id: string) => Promise<boolean>
  setOutfitTags: (id: string, tagIds: string[]) => Promise<boolean>
  setOutfitCloudSync: (id: string, enabled: boolean) => Promise<boolean>
  exportWardrobe: () => unknown
  exportRecovery: () => Promise<Array<{ key: string; reason: string; data: unknown }>>
  importWardrobe: (parsed: unknown, options?: { tagName?: string }) => Promise<{ count: number }>
  syncNow: () => Promise<boolean>
  enableCloudflareSync: () => Promise<boolean>
  disableCloudflareSync: () => Promise<boolean>
  syncCloudflareNow: () => Promise<boolean>
  exportCloudflareKey: () => Promise<string>
  importCloudflareKey: (key: string) => Promise<boolean>
  resolveSyncConflict: (resolutions: WardrobeConflictResolution[]) => Promise<unknown>
  setActiveItem: (item: FileNode | -1, options?: { ignoreLock?: boolean }) => void
  selectOutfit: (item: FileNode) => boolean
  togglePreviewLock: (item: FileNode) => boolean
  isPreviewLockedOn: (item: FileNode) => boolean
  clearSelection: () => void
  applyFilteredOutfitToCharacter: (opts?: { outfitData?: unknown[] }) => boolean
  applyCurrentPreviewToCharacter: () => boolean
  applyCurrentPreviewToSelfForced: () => boolean
  startThumbnailGeneration: (item: FileNode) => void
  refreshThumbnails: (items?: FileNode[] | null) => void
  refreshCloudQuotaStats: (snapshot?: unknown) => unknown
  // history
  addToHistory: (data: unknown[]) => void
  getHistoryRecords: () => Array<{ name: string; data?: unknown[] }>
  loadHistoryRecord: (record: unknown) => void
  deleteHistoryRecord: (record: unknown) => boolean
  clearHistory: () => void
  retryHistoryStorage: () => boolean
  exportHistoryBackup: () => Promise<{
    format: string
    version: number
    exportedAt: string
    current: unknown
    archivedLegacyCopies: Array<{ raw: string; data: unknown; archivedAt: string }>
    unarchivedLegacyRaw: string | null
    unarchivedLegacyData: unknown
    archivesUnavailable: boolean
  }>
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
  forceSelfApplyRevision: number
  setActiveTab: (tab: string) => void
  setWardrobeUi: (partial: Partial<WardrobeUi>) => void
  setForceSelfApplyEnabled: (enabled: boolean) => boolean
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
