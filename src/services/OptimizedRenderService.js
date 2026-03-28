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
import { isFastPathNormalizationEnabled } from '@/config/featureFlags';

// Constants for character ID generation
const RANDOM_ID_SUBSTRING_LENGTH = 7;
const MEMBER_NUMBER_BASE = 1000000000;
const MEMBER_NUMBER_RANGE = 1000000;

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
        this.perfStats = {
            totalRenders: 0,
            fastPathHits: 0,
            incrementalHits: 0,
            fullReloadHits: 0,
            itemsProcessed: 0,
            itemsReused: 0,
            normalizationRuns: 0,
            normalizationFallbacks: 0
        };
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

    _buildComparableBundle(rawBundleData) {
        if (!Array.isArray(rawBundleData)) return [];

        if (!isFastPathNormalizationEnabled()) {
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

        const previousOpacity = this._getOpacityValue(previousBundleItem);
        const nextOpacity = this._getOpacityValue(nextBundleItem);
        if (previousOpacity === 1 && nextOpacity < 1) {
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
            ...previousPropertyRest
        } = previousProperty || {};
        const {
            Shift: nextShift,
            Opacity: nextOpacityProperty,
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

        const previousMap = new Map();
        const nextMap = new Map();
        const nextRawMap = new Map();

        for (const previousItem of previousComparable) {
            const groupName = this._getBundleGroupName(previousItem);
            if (!groupName || previousMap.has(groupName)) {
                return false;
            }
            previousMap.set(groupName, previousItem);
        }

        for (const nextItem of comparableData) {
            const groupName = this._getBundleGroupName(nextItem);
            if (!groupName || nextMap.has(groupName)) {
                return false;
            }
            nextMap.set(groupName, nextItem);
        }

        for (const nextRawItem of newBundleData) {
            const groupName = this._getBundleGroupName(nextRawItem);
            if (!groupName || nextRawMap.has(groupName)) {
                return false;
            }
            nextRawMap.set(groupName, nextRawItem);
        }

        if (previousMap.size !== nextMap.size) {
            return false;
        }

        const changedItems = [];
        for (const [groupName, nextItem] of nextMap.entries()) {
            const previousItem = previousMap.get(groupName);
            if (!previousItem) {
                return false;
            }
            if (!isEqual(previousItem, nextItem)) {
                changedItems.push({ groupName, previousItem, nextItem });
            }
        }

        if (changedItems.length === 0) {
            return true;
        }

        if (!changedItems.every(({ previousItem, nextItem }) => this._isSafeGeneralParamUpdate(previousItem, nextItem))) {
            return false;
        }

        for (const { groupName } of changedItems) {
            const nextItem = nextRawMap.get(groupName);
            if (!nextItem) {
                return false;
            }

            const appearanceItem = toRaw(this.displayCharacter.Appearance.find(current => current?.Asset?.Group?.Name === groupName));
            if (!appearanceItem) {
                return false;
            }

            appearanceItem.Color = structuredClone(toRaw(nextItem.Color));
            if (!appearanceItem.Property) {
                appearanceItem.Property = {};
            }

            if (Object.prototype.hasOwnProperty.call(nextItem.Property || {}, 'Shift')) {
                appearanceItem.Property.Shift = structuredClone(toRaw(nextItem.Property.Shift));
            }

            if (Object.prototype.hasOwnProperty.call(nextItem.Property || {}, 'Opacity')) {
                appearanceItem.Property.Opacity = nextItem.Property.Opacity;
            }
        }

        return true;
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

            // Update character appearance using persistent instance
            const family = this.displayCharacter.AssetFamily || 'Female3DCG';
            const memberNumber = this.displayCharacter.MemberNumber;


            // Apply new appearance data
            if (options.useLoadFromBundle) {
                hostWindow.ServerAppearanceLoadFromBundle(
                    toRaw(this.displayCharacter),
                    family,
                    rawItemData,
                    memberNumber
                );
            } else {
                const perfStart = performance.now();
                this.perfStats.totalRenders++;
                const comparableData = this._buildComparableBundle(rawItemData);

                const usedFastPath = this._tryApplyGeneralParamUpdate(rawItemData, comparableData);
                if (usedFastPath) {
                    this.perfStats.fastPathHits++;
                    this.previousDataCache = structuredClone(rawItemData).sort((a, b) => a.Group.localeCompare(b.Group));
                    this.previousComparableCache = structuredClone(comparableData).sort((a, b) => a.Group.localeCompare(b.Group));
                    hostWindow.CharacterRefresh(toRaw(this.displayCharacter));

                    console.log(`[Perf] Fast path: ${(performance.now() - perfStart).toFixed(2)}ms`);
                    this.drawCallbacks.drawPreview({
                        data: rawItemData,
                        ctx: ctx,
                        canvas: canvas,
                        width: canvas.width,
                        height: canvas.height,
                        character: toRaw(this.displayCharacter)
                    });
                    return;
                }

                // OPTIMIZED INCREMENTAL UPDATE
                // Only process changed items, reuse cached Appearance for unchanged items
                this.perfStats.incrementalHits++;

                // Build maps for efficient lookup
                const previousBundleMap = new Map();
                this.previousDataCache.forEach(item => {
                    const groupName = this._getBundleGroupName(item);
                    if (groupName) previousBundleMap.set(groupName, item);
                });

                const newBundleMap = new Map();
                rawItemData.forEach(item => {
                    const groupName = this._getBundleGroupName(item);
                    if (groupName) newBundleMap.set(groupName, item);
                });

                // Identify changed items
                const changedGroups = new Set();
                const addedGroups = new Set();
                
                // Check for changes and additions
                for (const [groupName, newBundle] of newBundleMap.entries()) {
                    const prevBundle = previousBundleMap.get(groupName);
                    if (!prevBundle) {
                        addedGroups.add(groupName);
                        changedGroups.add(groupName);
                    } else if (!isEqual(prevBundle, newBundle)) {
                        changedGroups.add(groupName);
                    }
                }

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
                    .map(item => toRaw(item))
                    .filter(item => 
                        item && item.Asset && item.Asset.Group
                    );

                // Update stats
                this.perfStats.itemsProcessed += itemsProcessed;
                this.perfStats.itemsReused += itemsReused;

                const perfTime = (performance.now() - perfStart).toFixed(2);
                console.log(`[Perf] Incremental render: ${perfTime}ms (processed: ${itemsProcessed}, reused: ${itemsReused})`);
                console.log(`[Perf] Stats: ${this.perfStats.fastPathHits} fast, ${this.perfStats.incrementalHits} incremental, ${this.perfStats.fullReloadHits} full of ${this.perfStats.totalRenders} total`);
            }
            this.previousDataCache = structuredClone(rawItemData).sort((a, b) => a.Group.localeCompare(b.Group));
            this.previousComparableCache = structuredClone(this._buildComparableBundle(rawItemData)).sort((a, b) => a.Group.localeCompare(b.Group));

            // Refresh only once
            hostWindow.CharacterRefresh(toRaw(this.displayCharacter));

            // Draw with callback
            this.drawCallbacks.drawPreview({
                data: rawItemData,
                ctx: ctx,
                canvas: canvas,
                width: canvas.width,
                height: canvas.height,
                character: toRaw(this.displayCharacter) // Pass persistent character
            });

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
        this.previousAppearanceCache.clear();
        this.previousDataCache = [];
        this.previousComparableCache = [];

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
        return { ...this.perfStats };
    }

    /**
     * Reset performance statistics
     */
    resetPerfStats() {
        this.perfStats = {
            totalRenders: 0,
            fastPathHits: 0,
            incrementalHits: 0,
            fullReloadHits: 0,
            itemsProcessed: 0,
            itemsReused: 0,
            normalizationRuns: 0,
            normalizationFallbacks: 0
        };
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
