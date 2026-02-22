/**
 * OptimizedRenderService.js
 * Performance-optimized rendering service that maintains persistent character instance
 * for efficient incremental rendering.
 */
import { toRaw } from "vue";
import { hostWindow, doc, setTimeoutHost } from '@/utils/host-window.js';
import { createCanvas, get2DContext } from '@/utils/canvas.js';
import { isEqual } from 'lodash-es';

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
            this.defaultAppearance = this.displayCharacter.Appearance || [];
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

    _tryApplyGeneralParamUpdate(newBundleData) {
        if (!Array.isArray(newBundleData) || !Array.isArray(this.previousDataCache)) {
            return false;
        }

        if (!Array.isArray(this.displayCharacter?.Appearance)) {
            return false;
        }

        if (this.previousDataCache.length === 0 || this.previousDataCache.length !== newBundleData.length) {
            return false;
        }

        const previousMap = new Map();
        const nextMap = new Map();

        for (const previousItem of this.previousDataCache) {
            const groupName = this._getBundleGroupName(previousItem);
            if (!groupName || previousMap.has(groupName)) {
                return false;
            }
            previousMap.set(groupName, previousItem);
        }

        for (const nextItem of newBundleData) {
            const groupName = this._getBundleGroupName(nextItem);
            if (!groupName || nextMap.has(groupName)) {
                return false;
            }
            nextMap.set(groupName, nextItem);
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

        for (const { groupName, nextItem } of changedItems) {
            const appearanceItem = this.displayCharacter.Appearance.find(current => current?.Asset?.Group?.Name === groupName);
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
            const rawItemData = toRaw(item.data);

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
                const usedFastPath = this._tryApplyGeneralParamUpdate(rawItemData);
                if (usedFastPath) {
                    this.previousDataCache = structuredClone(rawItemData).sort((a, b) => a.Group.localeCompare(b.Group));
                    hostWindow.CharacterRefresh(toRaw(this.displayCharacter));

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

                //find changed items compared to previous data cache
                const changeditems = rawItemData.filter(newItem => {
                    return !this.previousDataCache.find(prevItem => isEqual(newItem, prevItem));
                });

                //use hostWindow.ServerBundledItemToAppearanceItem

                const newItems = rawItemData.map(bundleItem =>
                    hostWindow.ServerBundledItemToAppearanceItem(
                        family,
                        toRaw(bundleItem))
                );

                const appearanceData = toRaw(this.defaultAppearance).filter(item => !newItems.find(newItem => newItem.Asset.Group.Name === item.Asset.Group.Name)).concat(newItems)

                //santize only changed items
                //since we sorted above, use sequential comparison for efficiency
                //note that previousDataCache is also sorted but not necessarily in the same  length


                this.displayCharacter.Appearance = appearanceData;


                const newChangedItems = changeditems.map(bundleItem => {
                    const bundleItemWithoutProperties = { ...toRaw(bundleItem) };
                    delete bundleItemWithoutProperties.Property;
                    const baseItem = hostWindow.ServerBundledItemToAppearanceItem(
                        family,
                        toRaw(bundleItemWithoutProperties))
                    hostWindow.ValidationSanitizeProperties(
                        toRaw(this.displayCharacter),
                        toRaw(baseItem)
                    );
                    //merge both properties, override base with new ones if has conflicting keys
                    const finalbundleItem = toRaw(bundleItem);
                    finalbundleItem.Property = {
                        ...baseItem.Property,
                        ...toRaw(bundleItem.Property)
                    }
                    const finalItem = hostWindow.ServerBundledItemToAppearanceItem(
                        family,
                        toRaw(finalbundleItem))
                    hostWindow.ValidationSanitizeProperties(
                        toRaw(this.displayCharacter),
                        toRaw(finalItem)
                    );
                    return finalItem;
                }


                );


                /* if (newChangedItems.length > 0) {
                    newChangedItems.forEach(item => {
                        hostWindow.ValidationSanitizeProperties(
                            toRaw(this.displayCharacter),
                            toRaw(item)
                        );
                    });
                } */
                //merge unchanged items back

                const finalAppearance = appearanceData.filter(item => {
                    return !newChangedItems.find(newItem => newItem.Asset.Group.Name === item.Asset.Group.Name);
                }).concat(newChangedItems);


                this.displayCharacter.Appearance = finalAppearance;

                //update Cache

            }
            this.previousDataCache = structuredClone(rawItemData).sort((a, b) => a.Group.localeCompare(b.Group));

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
