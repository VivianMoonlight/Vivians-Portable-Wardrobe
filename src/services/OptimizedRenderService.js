/**
 * OptimizedRenderService.js
 * Performance-optimized rendering service that maintains persistent character instance
 * for efficient incremental rendering.
 */
import { toRaw } from "vue";
import { hostWindow, doc, setTimeoutHost } from '@/utils/host-window.js';
import { createCanvas, get2DContext } from '@/utils/canvas.js';
import { isEqual } from 'lodash-es';
import { normalizeForFastPath } from '@/services/NormalizationPolicy';
import {
    isFastPathNormalizationEnabled,
    isRenderSafetyTelemetryEnabled
} from '@/config/featureFlags';

// Constants for character ID generation
const RANDOM_ID_SUBSTRING_LENGTH = 7;
const MEMBER_NUMBER_BASE = 1000000000;
const MEMBER_NUMBER_RANGE = 1000000;

function createPerfStats() {
    return {
        totalRenders: 0,
        fastPathHits: 0,
        incrementalHits: 0,
        fullReloadHits: 0,
        fullReloadReasons: {
            forcedOption: 0,
            duplicateOrInvalidGroup: 0,
            unsafeHiddenRawChange: 0,
            unknown: 0
        },
        unsafeGeneralParamRejects: 0,
        unsafeHiddenRawSamples: 0,
        itemsProcessed: 0,
        itemsReused: 0,
        normalizationRuns: 0,
        normalizationFallbacks: 0
    };
}

export class OptimizedRenderService {
    constructor({
        drawCallbacks,
        previewwidth = 500,
        previewheight = 1000,
        characterId = null
    } = {}) {
        this.drawCallbacks = drawCallbacks;
        this.previewwidth = previewwidth;
        this.previewheight = previewheight;
        this.defaultAppearance = [];

        // Persistent character instance
        this.displayCharacter = null;
        // Generate unique character ID: skip '0.' prefix and take next 7 chars safely
        this.characterId = characterId || `optimizedDisplay_${Date.now()}_${Math.random().toString(36).substring(2).slice(0, RANDOM_ID_SUBSTRING_LENGTH)}`;

        // Canvas registry: item -> canvas
        this.canvasRegistry = new WeakMap();

        // Track if initialized
        this.initialized = false;
        this.previousDataCache = [];
        this.previousComparableCache = [];
        // Cache processed Appearance items for incremental updates
        // Map: groupName -> AppearanceItem
        this.previousAppearanceCache = new Map();
        // Performance monitoring
        this.perfStats = createPerfStats();
        this._lastNormalizationEnabled = isFastPathNormalizationEnabled();
        this._safetyTelemetryEnabled = isRenderSafetyTelemetryEnabled();
    }

    /**
     * Initialize persistent character instance
     */
    _initializeCharacter() {
        if (this.initialized && this.displayCharacter) {
            return true;
        }

        try {
            this.displayCharacter = hostWindow.CharacterLoadSimple(this.characterId);
            if (!this.displayCharacter) {
                console.error('[OptimizedRenderService] Failed to create display character');
                return false;
            }

            // Set member number to avoid conflicts with real players
            this.displayCharacter.MemberNumber = MEMBER_NUMBER_BASE + Math.floor(Math.random() * MEMBER_NUMBER_RANGE);

            // Initialize as naked
            hostWindow.ServerAppearanceLoadFromBundle(
                toRaw(this.displayCharacter),
                this.displayCharacter.AssetFamily || 'Female3DCG',
                [],
                this.displayCharacter.MemberNumber
            );
            hostWindow.CharacterNaked(toRaw(this.displayCharacter));
            hostWindow.CharacterRefresh(toRaw(this.displayCharacter));

            this.initialized = true;
            // Store default appearance (filter out invalid items, extract raw objects)
            this.defaultAppearance = (this.displayCharacter.Appearance || [])
                .map(item => toRaw(item))
                .filter(item =>
                    item && item.Asset && item.Asset.Group
                );
            return true;
        } catch (e) {
            console.error('[OptimizedRenderService] Character initialization failed:', e);
            this.initialized = false;
            return false;
        }
    }

    /**
     * Create preview canvas
     */
    _createPreviewCanvas() {
        return createCanvas(this.previewwidth, this.previewheight);
    }

    /**
     * Get 2D context helper
     */
    _get2DContext(canvas, { willReadFrequently = false } = {}) {
        return get2DContext(canvas, willReadFrequently ? { willReadFrequently: true } : {});
    }

    _getBundleGroupName(bundleItem) {
        return bundleItem?.Group || bundleItem?.Asset?.Group?.Name || null;
    }

    _getOpacityValue(bundleItem) {
        const rawOpacity = bundleItem?.Property?.Opacity;
        if (rawOpacity === undefined || rawOpacity === null) {
            return 1;
        }
        const numericOpacity = Number(rawOpacity);
        return Number.isFinite(numericOpacity) ? numericOpacity : 1;
    }

    _getOpacityEntries(rawOpacity) {
        if (rawOpacity === undefined || rawOpacity === null) {
            return [1];
        }

        if (Array.isArray(rawOpacity)) {
            return rawOpacity.map((entry) => {
                const n = Number(entry);
                return Number.isFinite(n) ? n : 1;
            });
        }

        if (typeof rawOpacity === 'object') {
            const values = Object.values(rawOpacity);
            if (!values.length) {
                return [1];
            }
            return values.map((entry) => {
                const n = Number(entry);
                return Number.isFinite(n) ? n : 1;
            });
        }

        const numericOpacity = Number(rawOpacity);
        return [Number.isFinite(numericOpacity) ? numericOpacity : 1];
    }

    _isFullyOpaqueOpacity(rawOpacity) {
        const entries = this._getOpacityEntries(rawOpacity);
        return entries.every(value => value >= 1);
    }

    _buildComparableBundle(rawBundleData, normalizationEnabled = isFastPathNormalizationEnabled()) {
        if (!Array.isArray(rawBundleData)) return [];

        if (!normalizationEnabled) {
            return rawBundleData;
        }

        try {
            this.perfStats.normalizationRuns++;
            return normalizeForFastPath(rawBundleData);
        } catch (e) {
            this.perfStats.normalizationFallbacks++;
            console.warn('[OptimizedRenderService] Fast-path normalization fallback:', e);
            return rawBundleData;
        }
    }

    _buildBundleMap(bundleData = []) {
        if (!Array.isArray(bundleData)) return null;

        const map = new Map();
        for (const bundleItem of bundleData) {
            const groupName = this._getBundleGroupName(bundleItem);
            if (!groupName || map.has(groupName)) {
                return null;
            }
            map.set(groupName, bundleItem);
        }
        return map;
    }

    _sortBundleDataByGroup(bundleData = []) {
        if (!Array.isArray(bundleData)) return [];

        return bundleData.sort((left, right) => {
            const leftGroup = String(this._getBundleGroupName(left) || '');
            const rightGroup = String(this._getBundleGroupName(right) || '');
            return leftGroup.localeCompare(rightGroup);
        });
    }

    _updateFastPathCaches(rawBundleData, comparableBundleData = null) {
        const nextRawCache = Array.isArray(rawBundleData) ? structuredClone(rawBundleData) : [];
        const nextComparableSource = Array.isArray(comparableBundleData) ? comparableBundleData : rawBundleData;
        const nextComparableCache = Array.isArray(nextComparableSource) ? structuredClone(nextComparableSource) : [];

        this.previousDataCache = this._sortBundleDataByGroup(nextRawCache);
        this.previousComparableCache = this._sortBundleDataByGroup(nextComparableCache);
    }

    invalidateFastPathCaches({ clearAppearanceCache = false } = {}) {
        this.previousDataCache = [];
        this.previousComparableCache = [];
        if (clearAppearanceCache) {
            this.previousAppearanceCache.clear();
        }
    }

    _recordFullReloadReason(reason = 'unknown') {
        const keyByReason = {
            'forced-option': 'forcedOption',
            'duplicate-or-invalid-group': 'duplicateOrInvalidGroup',
            'unsafe-hidden-raw-change': 'unsafeHiddenRawChange'
        };
        const key = keyByReason[reason] || 'unknown';

        if (!this.perfStats.fullReloadReasons || typeof this.perfStats.fullReloadReasons !== 'object') {
            this.perfStats.fullReloadReasons = {
                forcedOption: 0,
                duplicateOrInvalidGroup: 0,
                unsafeHiddenRawChange: 0,
                unknown: 0
            };
        }

        this.perfStats.fullReloadReasons[key] = (this.perfStats.fullReloadReasons[key] || 0) + 1;
    }

    _collectUnsafeDiffKeys(previousRawItem, nextRawItem) {
        const changedTopLevelKeys = [];
        const previousKeys = previousRawItem && typeof previousRawItem === 'object'
            ? Object.keys(previousRawItem)
            : [];
        const nextKeys = nextRawItem && typeof nextRawItem === 'object'
            ? Object.keys(nextRawItem)
            : [];
        const keySet = new Set([...previousKeys, ...nextKeys]);

        for (const key of keySet) {
            if (!isEqual(previousRawItem?.[key], nextRawItem?.[key])) {
                changedTopLevelKeys.push(key);
            }
        }

        const previousProperty = previousRawItem?.Property && typeof previousRawItem.Property === 'object'
            ? previousRawItem.Property
            : {};
        const nextProperty = nextRawItem?.Property && typeof nextRawItem.Property === 'object'
            ? nextRawItem.Property
            : {};
        const propertyKeys = new Set([...Object.keys(previousProperty), ...Object.keys(nextProperty)]);
        const changedPropertyKeys = [];

        for (const key of propertyKeys) {
            if (!isEqual(previousProperty[key], nextProperty[key])) {
                changedPropertyKeys.push(key);
            }
        }

        return {
            changedTopLevelKeys,
            changedPropertyKeys
        };
    }

    _recordUnsafeGeneralParamReject(previousRawItem, nextRawItem, context = {}) {
        this.perfStats.unsafeGeneralParamRejects++;

        if (!this._safetyTelemetryEnabled) {
            return;
        }

        const { changedTopLevelKeys, changedPropertyKeys } = this._collectUnsafeDiffKeys(previousRawItem, nextRawItem);
        this.perfStats.unsafeHiddenRawSamples++;
        console.warn('[OptimizedRenderService] Unsafe raw change sample:', {
            context,
            changedTopLevelKeys,
            changedPropertyKeys
        });
    }

    _isSafeGeneralParamUpdate(previousBundleItem, nextBundleItem) {
        if (!previousBundleItem || !nextBundleItem) {
            return false;
        }

        if (this._getBundleGroupName(previousBundleItem) !== this._getBundleGroupName(nextBundleItem)) {
            return false;
        }

        if ((previousBundleItem.Name || null) !== (nextBundleItem.Name || null)) {
            return false;
        }

        const previousOpaque = this._isFullyOpaqueOpacity(previousBundleItem?.Property?.Opacity);
        const nextOpaque = this._isFullyOpaqueOpacity(nextBundleItem?.Property?.Opacity);
        const crossesOpacityBoundary = previousOpaque !== nextOpaque;
        if (crossesOpacityBoundary) {
            return false;
        }

        const { Color: previousColor, Property: previousProperty = {}, ...previousRest } = previousBundleItem;
        const { Color: nextColor, Property: nextProperty = {}, ...nextRest } = nextBundleItem;

        if (!isEqual(previousRest, nextRest)) {
            return false;
        }

        const {
            Shift: previousShift,
            Opacity: previousOpacityProperty,
            LayerOverrides: previousLayerOverrides,
            OverridePriority: previousOverridePriority,
            ...previousPropertyRest
        } = previousProperty || {};
        const {
            Shift: nextShift,
            Opacity: nextOpacityProperty,
            LayerOverrides: nextLayerOverrides,
            OverridePriority: nextOverridePriority,
            ...nextPropertyRest
        } = nextProperty || {};

        if (!isEqual(previousPropertyRest, nextPropertyRest)) {
            return false;
        }

        if (!isEqual(previousColor, nextColor)) {
            return true;
        }
        if (!isEqual(previousShift, nextShift)) {
            return true;
        }
        if (!isEqual(previousOpacityProperty, nextOpacityProperty)) {
            return true;
        }
        if (!isEqual(previousLayerOverrides, nextLayerOverrides)) {
            return true;
        }
        if (!isEqual(previousOverridePriority, nextOverridePriority)) {
            return true;
        }

        return false;
    }

    _tryApplyGeneralParamUpdate(newBundleData, comparableBundleData = null) {
        if (!Array.isArray(newBundleData) || !Array.isArray(this.previousDataCache)) {
            return false;
        }

        if (!Array.isArray(this.displayCharacter?.Appearance)) {
            return false;
        }

        const comparableData = Array.isArray(comparableBundleData) ? comparableBundleData : newBundleData;
        if (!Array.isArray(comparableData)) {
            return false;
        }

        const previousComparable = Array.isArray(this.previousComparableCache) && this.previousComparableCache.length
            ? this.previousComparableCache
            : this.previousDataCache;

        if (previousComparable.length === 0 || previousComparable.length !== comparableData.length) {
            return false;
        }

        const previousComparableMap = this._buildBundleMap(previousComparable);
        const nextComparableMap = this._buildBundleMap(comparableData);
        const previousRawMap = this._buildBundleMap(this.previousDataCache);
        const nextRawMap = this._buildBundleMap(newBundleData);

        if (!previousComparableMap || !nextComparableMap || !previousRawMap || !nextRawMap) {
            return false;
        }

        if (previousComparableMap.size !== nextComparableMap.size || previousRawMap.size !== nextRawMap.size) {
            return false;
        }

        const changedItems = [];
        for (const [groupName, nextComparableItem] of nextComparableMap.entries()) {
            const previousComparableItem = previousComparableMap.get(groupName);
            if (!previousComparableItem) {
                return false;
            }

            const previousRawItem = previousRawMap.get(groupName);
            const nextRawItem = nextRawMap.get(groupName);
            if (!previousRawItem || !nextRawItem) {
                return false;
            }

            const comparableChanged = !isEqual(previousComparableItem, nextComparableItem);
            const rawChanged = !isEqual(previousRawItem, nextRawItem);

            if (!comparableChanged && rawChanged && !this._isSafeGeneralParamUpdate(previousRawItem, nextRawItem)) {
                // Normalization can hide unrelated object updates; only allow raw-safe updates.
                this._recordUnsafeGeneralParamReject(previousRawItem, nextRawItem, {
                    stage: '_tryApplyGeneralParamUpdate',
                    groupName
                });
                return false;
            }

            if (comparableChanged || rawChanged) {
                changedItems.push({ groupName, previousRawItem, nextRawItem });
            }
        }

        if (changedItems.length === 0) {
            return true;
        }

        if (!changedItems.every(({ previousRawItem, nextRawItem }) => this._isSafeGeneralParamUpdate(previousRawItem, nextRawItem))) {
            return false;
        }

        for (const { groupName, previousRawItem, nextRawItem } of changedItems) {
            const appearanceItem = toRaw(this.displayCharacter.Appearance.find(current => current?.Asset?.Group?.Name === groupName));
            if (!appearanceItem) {
                return false;
            }

            const previousProperty = previousRawItem?.Property || {};
            const nextProperty = nextRawItem?.Property || {};

            if (Object.prototype.hasOwnProperty.call(nextRawItem, 'Color')) {
                appearanceItem.Color = structuredClone(toRaw(nextRawItem.Color));
            } else if (Object.prototype.hasOwnProperty.call(previousRawItem || {}, 'Color')) {
                delete appearanceItem.Color;
            }

            if (!appearanceItem.Property) {
                appearanceItem.Property = {};
            }

            const applyOrDeleteProperty = (propertyKey) => {
                if (Object.prototype.hasOwnProperty.call(nextProperty, propertyKey)) {
                    appearanceItem.Property[propertyKey] = structuredClone(toRaw(nextProperty[propertyKey]));
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(previousProperty, propertyKey)) {
                    delete appearanceItem.Property[propertyKey];
                }
            };

            applyOrDeleteProperty('Shift');
            applyOrDeleteProperty('Opacity');
            applyOrDeleteProperty('LayerOverrides');
            applyOrDeleteProperty('OverridePriority');

            if (Object.keys(appearanceItem.Property).length === 0) {
                delete appearanceItem.Property;
            }
        }

        return true;
    }

    _syncAppearanceCacheFromCharacter() {
        this.previousAppearanceCache.clear();
        const appearanceList = Array.isArray(this.displayCharacter?.Appearance)
            ? this.displayCharacter.Appearance
            : [];

        for (const appearanceItem of appearanceList) {
            const groupName = appearanceItem?.Asset?.Group?.Name;
            if (!groupName) continue;
            this.previousAppearanceCache.set(groupName, toRaw(appearanceItem));
        }
    }

    _applyFullReload(rawBundleData, family, memberNumber, reason = 'unknown') {
        hostWindow.ServerAppearanceLoadFromBundle(
            toRaw(this.displayCharacter),
            family,
            rawBundleData,
            memberNumber
        );

        this.perfStats.fullReloadHits++;
        this._recordFullReloadReason(reason);
        this._syncAppearanceCacheFromCharacter();
        console.log(`[Perf] Full reload (${reason})`);
    }

    _drawPreviewFrame(rawItemData, ctx, canvas) {
        this.drawCallbacks.drawPreview({
            data: rawItemData,
            ctx,
            canvas,
            width: canvas.width,
            height: canvas.height,
            character: toRaw(this.displayCharacter)
        });
    }

    _finalizeRenderFrame(rawItemData, comparableData, ctx, canvas) {
        this._updateFastPathCaches(rawItemData, comparableData);
        hostWindow.CharacterRefresh(toRaw(this.displayCharacter));
        this._drawPreviewFrame(rawItemData, ctx, canvas);
    }

    _collectIncrementalChangedGroups({
        previousRawMap,
        nextRawMap,
        previousComparableMap = null,
        nextComparableMap = null
    }) {
        const changedGroups = new Set();
        const hasComparableMaps = previousComparableMap instanceof Map && nextComparableMap instanceof Map;

        for (const [groupName, nextRawItem] of nextRawMap.entries()) {
            const previousRawItem = previousRawMap.get(groupName);
            if (!previousRawItem) {
                changedGroups.add(groupName);
                continue;
            }

            const rawChanged = !isEqual(previousRawItem, nextRawItem);
            let comparableChanged = null;

            if (hasComparableMaps) {
                const previousComparableItem = previousComparableMap.get(groupName);
                const nextComparableItem = nextComparableMap.get(groupName);

                if (!previousComparableItem || !nextComparableItem) {
                    return null;
                }

                comparableChanged = !isEqual(previousComparableItem, nextComparableItem);

                if (!comparableChanged && rawChanged && !this._isSafeGeneralParamUpdate(previousRawItem, nextRawItem)) {
                    // Comparable says unchanged, but raw object changed with non-safe fields.
                    // Force caller to choose full reload to keep host state correct.
                    this._recordUnsafeGeneralParamReject(previousRawItem, nextRawItem, {
                        stage: '_collectIncrementalChangedGroups',
                        groupName
                    });
                    return null;
                }
            }

            if (comparableChanged || rawChanged) {
                changedGroups.add(groupName);
            }
        }

        return changedGroups;
    }

    /**
     * Render preview with optimized character reuse
     */
    renderPreviewWithItem(item, options = {}) {
        // Skip folders
        if (item && item.type && item.type === 'folder') {
            return;
        }

        if (!item || !item.data) {
            console.error('[OptimizedRenderService] renderPreviewWithItem: item is required');
            return;
        }

        if (!this.drawCallbacks || typeof this.drawCallbacks.drawPreview !== 'function') {
            console.error('[OptimizedRenderService] renderPreviewWithItem: drawPreview callback not defined');
            return;
        }

        // Initialize character if needed
        if (!this._initializeCharacter()) {
            console.error('[OptimizedRenderService] Failed to initialize character');
            return;
        }

        // Get or create canvas for this item
        let canvas = this.canvasRegistry.get(item);
        if (!canvas) {
            canvas = this._createPreviewCanvas();
            this.canvasRegistry.set(item, canvas);
        }

        const ctx = this._get2DContext(canvas);
        if (!ctx) {
            console.error('[OptimizedRenderService] Failed to get canvas context');
            return;
        }

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        try {
            let rawItemData = toRaw(item.data);

            // Filter out null/undefined items and items without proper structure
            if (Array.isArray(rawItemData)) {
                rawItemData = rawItemData.filter(bundleItem => {
                    if (!bundleItem) {
                        console.warn('[OptimizedRenderService] Found null/undefined item in data, skipping');
                        return false;
                    }
                    // Check if item has Group directly or has Name+Group structure
                    const hasGroup = bundleItem.Group || (bundleItem.Name && bundleItem.Group !== undefined);
                    if (!hasGroup) {
                        console.warn('[OptimizedRenderService] Found item without Group property, skipping:', bundleItem);
                        return false;
                    }
                    return true;
                });
            }

            const normalizationEnabled = isFastPathNormalizationEnabled();
            if (this._lastNormalizationEnabled !== normalizationEnabled) {
                this.previousComparableCache = [];
                this._lastNormalizationEnabled = normalizationEnabled;
            }
            const comparableData = this._buildComparableBundle(rawItemData, normalizationEnabled);

            // Update character appearance using persistent instance
            const family = this.displayCharacter.AssetFamily || 'Female3DCG';
            const memberNumber = this.displayCharacter.MemberNumber;
            this.perfStats.totalRenders++;
            const perfStart = performance.now();

            // Apply new appearance data
            if (options.useLoadFromBundle) {
                this._applyFullReload(rawItemData, family, memberNumber, 'forced-option');
            } else {
                const usedFastPath = this._tryApplyGeneralParamUpdate(rawItemData, comparableData);
                if (usedFastPath) {
                    this.perfStats.fastPathHits++;
                    console.log(`[Perf] Fast path: ${(performance.now() - perfStart).toFixed(2)}ms`);
                    this._finalizeRenderFrame(rawItemData, comparableData, ctx, canvas);
                    return;
                }

                // OPTIMIZED INCREMENTAL UPDATE
                // Only process changed items, reuse cached Appearance for unchanged items
                // Build maps for efficient lookup. If duplicate groups are detected,
                // fall back to host bundle loader to preserve ordering semantics.
                const previousBundleMap = this._buildBundleMap(this.previousDataCache);
                const newBundleMap = this._buildBundleMap(rawItemData);
                if (!previousBundleMap || !newBundleMap) {
                    this._applyFullReload(rawItemData, family, memberNumber, 'duplicate-or-invalid-group');
                    this._finalizeRenderFrame(rawItemData, comparableData, ctx, canvas);
                    return;
                }

                const previousComparable = Array.isArray(this.previousComparableCache) && this.previousComparableCache.length
                    ? this.previousComparableCache
                    : this.previousDataCache;
                const previousComparableMap = this._buildBundleMap(previousComparable);
                const nextComparableMap = this._buildBundleMap(comparableData);

                const changedGroups = this._collectIncrementalChangedGroups({
                    previousRawMap: previousBundleMap,
                    nextRawMap: newBundleMap,
                    previousComparableMap,
                    nextComparableMap
                });
                if (!changedGroups) {
                    this._applyFullReload(rawItemData, family, memberNumber, 'unsafe-hidden-raw-change');
                    this._finalizeRenderFrame(rawItemData, comparableData, ctx, canvas);
                    return;
                }

                this.perfStats.incrementalHits++;

                // Check for removals (items in previous but not in new)
                const removedGroups = new Set();
                for (const groupName of previousBundleMap.keys()) {
                    if (!newBundleMap.has(groupName)) {
                        removedGroups.add(groupName);
                    }
                }

                console.log(`[Perf] Incremental: ${changedGroups.size} changed, ${removedGroups.size} removed, ${newBundleMap.size - changedGroups.size} reused`);

                // Build new Appearance array
                const newAppearance = [];
                let itemsProcessed = 0;
                let itemsReused = 0;

                // Process each item in the new bundle
                for (const [groupName, bundleItem] of newBundleMap.entries()) {
                    if (changedGroups.has(groupName)) {
                        // Process changed/added items
                        itemsProcessed++;

                        const bundleItemWithoutProperties = { ...toRaw(bundleItem) };
                        delete bundleItemWithoutProperties.Property;

                        const baseItem = hostWindow.ServerBundledItemToAppearanceItem(
                            family,
                            toRaw(bundleItemWithoutProperties)
                        );

                        hostWindow.ValidationSanitizeProperties(
                            toRaw(this.displayCharacter),
                            toRaw(baseItem)
                        );

                        // Merge properties
                        const finalbundleItem = toRaw(bundleItem);
                        finalbundleItem.Property = {
                            ...baseItem.Property,
                            ...toRaw(bundleItem.Property)
                        };

                        const finalItem = hostWindow.ServerBundledItemToAppearanceItem(
                            family,
                            toRaw(finalbundleItem)
                        );

                        hostWindow.ValidationSanitizeProperties(
                            toRaw(this.displayCharacter),
                            toRaw(finalItem)
                        );

                        // Validate item has required structure before adding
                        if (finalItem && finalItem.Asset && finalItem.Asset.Group) {
                            newAppearance.push(toRaw(finalItem));
                            // Update cache with raw object
                            this.previousAppearanceCache.set(groupName, toRaw(finalItem));
                        } else {
                            console.warn(`[OptimizedRenderService] Invalid finalItem for group ${groupName}, skipping`);
                        }
                    } else {
                        // Reuse cached Appearance item (already raw from cache)
                        itemsReused++;
                        const cachedItem = this.previousAppearanceCache.get(groupName);
                        if (cachedItem && cachedItem.Asset && cachedItem.Asset.Group) {
                            newAppearance.push(toRaw(cachedItem));
                        } else if (cachedItem) {
                            console.warn(`[OptimizedRenderService] Invalid cached item for group ${groupName}, reprocessing`);
                            this.previousAppearanceCache.delete(groupName);
                            // Fallback: reprocess
                            const appearanceItem = hostWindow.ServerBundledItemToAppearanceItem(
                                family,
                                toRaw(bundleItem)
                            );
                            hostWindow.ValidationSanitizeProperties(
                                toRaw(this.displayCharacter),
                                toRaw(appearanceItem)
                            );
                            if (appearanceItem && appearanceItem.Asset && appearanceItem.Asset.Group) {
                                newAppearance.push(toRaw(appearanceItem));
                                this.previousAppearanceCache.set(groupName, toRaw(appearanceItem));
                            } else {
                                console.warn(`[OptimizedRenderService] Failed to reprocess item for group ${groupName}`);
                            }
                        } else {
                            // Fallback: process if not in cache (shouldn't happen normally)
                            console.warn(`[Perf] Cache miss for unchanged group: ${groupName}`);
                            const appearanceItem = hostWindow.ServerBundledItemToAppearanceItem(
                                family,
                                toRaw(bundleItem)
                            );
                            hostWindow.ValidationSanitizeProperties(
                                toRaw(this.displayCharacter),
                                toRaw(appearanceItem)
                            );
                            if (appearanceItem && appearanceItem.Asset && appearanceItem.Asset.Group) {
                                newAppearance.push(toRaw(appearanceItem));
                                this.previousAppearanceCache.set(groupName, toRaw(appearanceItem));
                            } else {
                                console.warn(`[OptimizedRenderService] Failed to process fallback item for group ${groupName}`);
                            }
                        }
                    }
                }

                // Remove deleted items from cache
                for (const groupName of removedGroups) {
                    this.previousAppearanceCache.delete(groupName);
                }

                // Fill in with default appearance items for groups not in newBundleMap
                const coveredGroups = new Set(newBundleMap.keys());
                for (const defaultItem of this.defaultAppearance) {
                    const groupName = defaultItem?.Asset?.Group?.Name;
                    if (groupName && !coveredGroups.has(groupName)) {
                        newAppearance.push(toRaw(defaultItem));
                    }
                }

                // Extract raw objects from all items before assignment
                this.displayCharacter.Appearance = newAppearance
                    .map(appearanceItem => toRaw(appearanceItem))
                    .filter(appearanceItem =>
                        appearanceItem && appearanceItem.Asset && appearanceItem.Asset.Group
                    );

                // Update stats
                this.perfStats.itemsProcessed += itemsProcessed;
                this.perfStats.itemsReused += itemsReused;

                const perfTime = (performance.now() - perfStart).toFixed(2);
                console.log(`[Perf] Incremental render: ${perfTime}ms (processed: ${itemsProcessed}, reused: ${itemsReused})`);
                console.log(`[Perf] Stats: ${this.perfStats.fastPathHits} fast, ${this.perfStats.incrementalHits} incremental, ${this.perfStats.fullReloadHits} full of ${this.perfStats.totalRenders} total`);
            }

            this._finalizeRenderFrame(rawItemData, comparableData, ctx, canvas);

        } catch (e) {
            console.warn('[OptimizedRenderService] renderPreviewWithItem error:', e);
        }
    }

    /**
     * Remove canvas for item
     */
    removeCanvas(item) {
        if (!item) return;

        if (this.canvasRegistry.has(item)) {
            const canvas = this.canvasRegistry.get(item);
            const ctx = canvas?.getContext('2d');
            if (ctx) {
                try {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                } catch (e) {
                    // Ignore
                }
            }
            this.canvasRegistry.delete(item);
        }
    }

    getPreviewCanvas(item) {
        return this.canvasRegistry.get(item) || null;
    }

    /**
     * Cleanup persistent character and all resources
     */
    destroy() {
        // Clear all canvases
        this.canvasRegistry = new WeakMap();

        // Clear caches
        this.invalidateFastPathCaches({ clearAppearanceCache: true });

        // Delete persistent character
        if (this.displayCharacter) {
            try {
                hostWindow.CharacterDelete(this.displayCharacter);
            } catch (e) {
                console.warn('[OptimizedRenderService] Character cleanup error:', e);
            }
            this.displayCharacter = null;
        }

        this.initialized = false;
    }

    /**
     * Get performance statistics
     */
    getPerfStats() {
        return {
            ...this.perfStats,
            fullReloadReasons: { ...(this.perfStats.fullReloadReasons || {}) }
        };
    }

    /**
     * Reset performance statistics
     */
    resetPerfStats() {
        this.perfStats = createPerfStats();
    }

    /**
     * Force refresh character (useful when external state changes)
     */
    refreshCharacter() {
        if (this.displayCharacter) {
            try {
                hostWindow.CharacterRefresh(toRaw(this.displayCharacter));
            } catch (e) {
                console.warn('[OptimizedRenderService] Refresh error:', e);
            }
        }
    }
}

export default OptimizedRenderService;
