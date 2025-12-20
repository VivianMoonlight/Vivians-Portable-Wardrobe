/**
 * OptimizedRenderService.js
 * Performance-optimized rendering service that maintains persistent character instance
 * for efficient incremental rendering.
 */
import { toRaw } from "vue";
import { hostWindow, doc, setTimeoutHost } from '@/utils/host-window.js';
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
        const canvas = doc.createElement('canvas');
        canvas.width = this.previewwidth;
        canvas.height = this.previewheight;
        return canvas;
    }

    /**
     * Get 2D context helper
     */
    _get2DContext(canvas, { willReadFrequently = false } = {}) {
        if (!canvas) return null;
        try {
            return canvas.getContext('2d', willReadFrequently ? { willReadFrequently: true } : undefined);
        } catch (e) {
            try {
                return canvas.getContext('2d');
            } catch (e2) {
                return null;
            }
        }
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
            //find changed items compared to previous data cache
            const changeditems = toRaw(item.data).filter(newItem => {
                return !this.previousDataCache.find(prevItem => isEqual(newItem, prevItem));
            });


            // Update character appearance using persistent instance
            const family = this.displayCharacter.AssetFamily || 'Female3DCG';
            const memberNumber = this.displayCharacter.MemberNumber;


            // Apply new appearance data
            if (options.useLoadFromBundle) {
                hostWindow.ServerAppearanceLoadFromBundle(
                    toRaw(this.displayCharacter),
                    family,
                    toRaw(item.data),
                    memberNumber
                );
            } else {
                //use hostWindow.ServerBundledItemToAppearanceItem

                const newItems = toRaw(item.data).map(bundleItem =>
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
            this.previousDataCache = structuredClone(toRaw(item.data)).sort((a, b) => a.Group.localeCompare(b.Group));

            // Refresh only once
            hostWindow.CharacterRefresh(toRaw(this.displayCharacter));

            // Draw with callback
            this.drawCallbacks.drawPreview({
                data: toRaw(item.data),
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
