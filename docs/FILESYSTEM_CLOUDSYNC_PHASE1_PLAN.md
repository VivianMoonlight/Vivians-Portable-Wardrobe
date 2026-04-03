# Filesystem Cloud Sync Plan (Phase 1 + Phase 2 + Phase 3 Core)

Date: 2026-04-03
Scope: Implement Phase 1 foundation, Phase 2 backend capabilities, and Phase 3 core persistence split

## Goal

Establish a backward-compatible filesystem node model that supports future cloud-sync granularity, and fix local persistence key construction to avoid key mismatch.

## Phase Breakdown

1. Phase 1 (this change):
- Normalize filesystem nodes on all key paths.
- Add cloud-sync-ready fields with safe defaults.
- Preserve compatibility with existing saved data.
- Fix local storage key construction bug in file store.

2. Phase 2 (this change):
- Build cloud-sync filtered tree snapshot.
- Add cloud payload size estimation and quota stats foundation.
- Add node-level and folder-recursive cloudSync toggling APIs.

3. Phase 3 core (this change):
- Keep local persistence as full snapshot.
- Persist only cloudSync-enabled subtree to online storage.
- Hard block cloud write when estimated cloud payload exceeds 180KB.

4. Phase 3 UI (this change):
- File-item cloud sync toggle in file cards (folder toggle applies recursively).
- Global cloud usage bar in file manager area.

5. Phase 3+ (not in this change):
- Richer cloud error presentation (badges/tooltips/history).

## Implemented in Phase 1

### A. FileSystem node normalization

Applied in:
- constructor default root creation
- fromJSON
- fromMultipleJSON
- addFile
- addFolder
- moveItem merge path

Normalized fields:
- cloudSync: boolean (default true)
- updatedAt: number | null
- inheritCloudSync: boolean for folders (default true)

Behavior notes:
- Existing file/folder/outfit/character node types remain compatible.
- Any node with children is normalized as a folder.
- Non-folder nodes are treated as leaf nodes and keep their original type when present.

### B. Local key fix in fileSystemStore

Fixed incorrect precedence in save/load local key expression.

Old (buggy):
- 'VPWardrobe_local' + hostWindow.Player ? hostWindow.Player.MemberNumber : 'DEFAULT'

New:
- A dedicated helper builds stable scoped keys:
  - VPWardrobe_local_<member>
  - VPWardrobe_history_<member>

Compatibility:
- loadAll tries the legacy buggy key as fallback and logs migration intent.

## Validation checklist

1. Existing storage loads without schema migration errors.
2. New files/folders are normalized with cloud-ready fields.
3. saveAll/loadAll read/write a stable local key.
4. loadAll still works if only legacy local key exists.
5. buildCloudSyncTree returns only cloud-enabled subtree (with root envelope).
6. refreshCloudQuotaStats reports payload size and over-limit state.

## Implemented in Phase 2

### A. StorageAdapter capability extension

Added methods:
- serializeForSave(obj)
- estimatePayloadBytes(obj)

These methods use the same compression path as persistence, so quota estimates match saved payload behavior.

### B. fileSystemStore cloud snapshot and quota model

Added state:
- cloudQuota: limit/warn ratio/used bytes/ratio/warning and over-limit flags
- cloudSyncStats: total vs enabled nodes/folders/leaves + payload bytes
- cloudSyncTreePreview: filtered snapshot for future cloud save pipeline and UI usage

Added actions:
- buildCloudSyncTree()
- collectCloudSyncStats()
- refreshCloudQuotaStats(snapshot?)
- setNodeCloudSync(node, enabled, options)
- setPathCloudSync(path, enabled, options)

Wired refresh points:
- saveAll() now refreshes quota stats using the current snapshot.
- loadAll() refreshes quota stats after merge/load.

## Implemented in Phase 3 core

### A. Persistence path split

- saveAll() now writes local full snapshot first.
- Online write now uses cloudSync-filtered tree only.

### B. 180KB hard block for cloud writes

- saveAll() checks refreshCloudQuotaStats(snapshot) before online write.
- If over limit, cloud write is skipped and warning is logged.
- Local write still succeeds.

## Implemented in Phase 3 UI

### A. File-item cloud sync toggle

- Added per-item cloud sync toggle button in FileItem.
- Folder toggle calls recursive cloudSync application.

### B. Global cloud usage bar

- Added cloud usage card and progress bar in FileManager.
- Uses cloudQuota state for used/limit display and warning/over-limit styling.

## Out of scope

- File-level cloud error badges and panel-level UI integration
