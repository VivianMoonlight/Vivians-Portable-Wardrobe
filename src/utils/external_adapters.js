/**
 * external_adapters.js
 * Centralizes and safely wraps all calls to external game engine functions with error handling.
 * Provides defensive checks and appropriate fallback values for all external interactions.
 */

import LZString from 'lz-string';
import { hostWindow } from './host-window.js';
import { collectOutfitData } from './AssetApi.js';
import { isHiddenBodySlot, preserveHiddenBodySlots } from '../services/hidden-body-slots.js';
import { isForceSelfApplyEnabled } from '../stores/workbenchStore.js';

function currentAppearanceBundle(character) {
    if (typeof hostWindow.ServerAppearanceBundle === 'function') {
        try {
            const bundle = hostWindow.ServerAppearanceBundle(character.Appearance);
            if (Array.isArray(bundle)) return bundle;
        } catch (error) {
            console.warn('[ExternalAdapter] Could not bundle current appearance:', error);
        }
    }
    return collectOutfitData(character);
}

export const ExternalAdapter = {
    /**
     * Checks if required game functions are available
     * @returns {boolean} True if core functions are available
     */
    isReady() {
        return typeof hostWindow.DrawCharacter === 'function' &&
            typeof hostWindow.CharacterLoadSimple === 'function';
    },

    /**
     * Generic safe wrapper for any game function
     * @param {string} fnName - Name of the function to call
     * @param {...any} args - Arguments to pass to the function
     * @returns {any|null} Function result or null on error
     */
    safe(fnName, ...args) {
        const fn = hostWindow[fnName];
        if (typeof fn !== 'function') {
            console.warn(`[ExternalAdapter] Function not available: ${fnName}`);
            return null;
        }
        try {
            return fn(...args);
        } catch (e) {
            console.error(`[ExternalAdapter] Error calling ${fnName}:`, e);
            return null;
        }
    },

    /**
     * Copies text to clipboard with async API first and execCommand fallback.
     * @param {string} text
     */
    copyTextToClipboard(text) {
        const nav = hostWindow?.navigator;
        if (nav?.clipboard?.writeText) {
            nav.clipboard.writeText(text)
                .then(() => {
                    console.log("[ExternalAdapter] Outfit BCX code copied to clipboard");
                })
                .catch((error) => {
                    console.warn("[ExternalAdapter] Clipboard API write failed, falling back:", error);
                    this.copyTextToClipboardFallback(text);
                });
            return;
        }
        this.copyTextToClipboardFallback(text);
    },

    /**
     * Fallback clipboard copy for environments without navigator.clipboard.
     * @param {string} text
     */
    copyTextToClipboardFallback(text) {
        try {
            const doc = hostWindow?.document;
            if (!doc) {
                throw new Error('document is unavailable');
            }
            const textarea = doc.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.top = '-9999px';
            textarea.style.left = '-9999px';
            doc.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const copied = doc.execCommand('copy');
            doc.body.removeChild(textarea);
            if (copied) {
                console.log("[ExternalAdapter] Outfit BCX code copied to clipboard (fallback)");
            } else {
                console.warn("[ExternalAdapter] Clipboard fallback did not copy text");
            }
        } catch (e) {
            console.error("[ExternalAdapter] Failed to copy BCX code to clipboard:", e);
        }
    },

    /**
     * Exports outfit data as compressed BCX code and copies to clipboard
     * @param {string} name - Outfit name
     * @param {Array} dataList - Outfit data list
     * @returns {string} Compressed BCX code
     */
    exportOutfitAsBCX(name, dataList) {
        const normalizedData = Array.isArray(dataList) ? dataList : [];
        const code = LZString.compressToBase64(JSON.stringify(normalizedData));
        this.copyTextToClipboard(code);
        return code;
    },

    /**
     * Safely loads a simple character for rendering
     * @param {string} id - Character ID to use
     * @returns {Character|null} Character object or null if failed
     */
    loadSimpleCharacter(id = "displayCharacter") {
        if (typeof hostWindow.CharacterLoadSimple !== 'function') {
            console.warn("[ExternalAdapter] CharacterLoadSimple not available");
            return null;
        }
        try {
            return hostWindow.CharacterLoadSimple(id);
        } catch (e) {
            console.error("[ExternalAdapter] CharacterLoadSimple failed:", e);
            return null;
        }
    },

    /**
     * Safely creates appearance bundle from character appearance
     * @param {Array} appearance - Character appearance array
     * @returns {Array} Appearance bundle array, empty on error
     */
    serverAppearanceBundle(appearance) {
        if (!appearance) return [];
        if (typeof hostWindow.ServerAppearanceBundle !== 'function') {
            console.warn("[ExternalAdapter] ServerAppearanceBundle not available");
            return [];
        }
        try {
            return hostWindow.ServerAppearanceBundle(appearance) || [];
        } catch (e) {
            console.error("[ExternalAdapter] ServerAppearanceBundle failed:", e);
            return [];
        }
    },

    /**
     * Safely loads appearance bundle onto character
     * @param {Character} C - Target character
     * @param {string} family - Asset family
     * @param {Array} bundle - Appearance bundle
     * @param {number} memberNumber - Member number
     * @returns {boolean} True if successful, false otherwise
     */
    serverAppearanceLoad(C, family, bundle, memberNumber) {
        if (!C) {
            console.warn("[ExternalAdapter] serverAppearanceLoad: Character is required");
            return false;
        }
        if (typeof hostWindow.ServerAppearanceLoadFromBundle !== 'function') {
            console.warn("[ExternalAdapter] ServerAppearanceLoadFromBundle not available");
            return false;
        }
        try {
            return hostWindow.ServerAppearanceLoadFromBundle(C, family, bundle, memberNumber) !== false;
        } catch (e) {
            console.error("[ExternalAdapter] ServerAppearanceLoadFromBundle failed:", e);
            return false;
        }
    },

    /**
     * Safely draws character on canvas context
     * @param {Character} C - Character to draw
     * @param {number} X - X offset
     * @param {number} Y - Y offset
     * @param {number} Zoom - Zoom level
     * @param {boolean} allowHeight - Allow height adjustment
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     */
    drawCharacter(C, X, Y, Zoom, allowHeight, ctx) {
        if (!C || !ctx) {
            console.warn("[ExternalAdapter] drawCharacter: Character and context are required");
            return;
        }
        if (typeof hostWindow.DrawCharacter !== 'function') {
            console.warn("[ExternalAdapter] DrawCharacter not available");
            return;
        }
        try {
            hostWindow.DrawCharacter(C, X, Y, Zoom, allowHeight, ctx);
        } catch (e) {
            console.error("[ExternalAdapter] DrawCharacter failed:", e);
        }
    },

    /**
     * Safely refreshes character appearance
     * @param {Character} C - Character to refresh
     */
    refreshCharacter(C) {
        if (!C) {
            console.warn("[ExternalAdapter] refreshCharacter: Character is required");
            return;
        }
        if (typeof hostWindow.CharacterRefresh !== 'function') {
            console.warn("[ExternalAdapter] CharacterRefresh not available");
            return;
        }
        try {
            hostWindow.CharacterRefresh(C);
        } catch (e) {
            console.error("[ExternalAdapter] CharacterRefresh failed:", e);
        }
    },

    /**
     * Safely deletes a character
     * @param {Character} C - Character to delete
     */
    deleteCharacter(C) {
        if (!C) return;
        if (typeof hostWindow.CharacterDelete !== 'function') {
            console.warn("[ExternalAdapter] CharacterDelete not available");
            return;
        }
        try {
            hostWindow.CharacterDelete(C);
        } catch (e) {
            console.error("[ExternalAdapter] CharacterDelete failed:", e);
        }
    },

    /**
     * Safely gets inventory item for character and group
     * @param {Character} C - Character
     * @param {string} groupName - Asset group name
     * @returns {object|null} Inventory item or null
     */
    inventoryGet(C, groupName) {
        if (!C || !groupName) return null;
        if (typeof hostWindow.InventoryGet !== 'function') {
            console.warn("[ExternalAdapter] InventoryGet not available");
            return null;
        }
        try {
            return hostWindow.InventoryGet(C, groupName);
        } catch (e) {
            console.error("[ExternalAdapter] InventoryGet failed:", e);
            return null;
        }
    },

    /**
     * Safely checks if inventory item has effect
     * @param {object} item - Inventory item
     * @param {string} effect - Effect name to check
     * @returns {boolean} True if item has effect, false otherwise
     */
    inventoryItemHasEffect(item, effect) {
        if (!item || !effect) return false;
        if (typeof hostWindow.InventoryItemHasEffect !== 'function') {
            console.warn("[ExternalAdapter] InventoryItemHasEffect not available");
            return false;
        }
        try {
            return hostWindow.InventoryItemHasEffect(item, effect);
        } catch (e) {
            console.error("[ExternalAdapter] InventoryItemHasEffect failed:", e);
            return false;
        }
    },

    /**
     * Safely gets asset by family, group, and name
     * @param {string} family - Asset family
     * @param {string} group - Asset group
     * @param {string} name - Asset name
     * @returns {object|null} Asset object or null
     */
    assetGet(family, group, name) {
        // BC uses an empty asset name for its non-customizable arm and hand groups.
        if (!family || !group || typeof name !== 'string') return null;
        if (typeof hostWindow.AssetGet !== 'function') {
            console.warn("[ExternalAdapter] AssetGet not available");
            return null;
        }
        try {
            return hostWindow.AssetGet(family, group, name);
        } catch (e) {
            console.error("[ExternalAdapter] AssetGet failed:", e);
            return null;
        }
    },

    /**
     * Safely gets asset preview path
     * @param {object} asset - Asset object
     * @returns {string} Preview path or empty string
     */
    assetPreviewPath(asset) {
        if (!asset) return '';
        if (typeof hostWindow.AssetGetPreviewPath !== 'function') {
            console.warn("[ExternalAdapter] AssetGetPreviewPath not available");
            return '';
        }
        try {
            return hostWindow.AssetGetPreviewPath(asset);
        } catch (e) {
            console.error("[ExternalAdapter] AssetGetPreviewPath failed:", e);
            return '';
        }
    },

    /**
     * Safely updates character in chat room
     * @param {Character} C - Character to update
     */
    chatRoomUpdate(C) {
        if (!C) return;
        if (typeof hostWindow.ChatRoomCharacterUpdate !== 'function') {
            console.warn("[ExternalAdapter] ChatRoomCharacterUpdate not available");
            return;
        }
        try {
            hostWindow.ChatRoomCharacterUpdate(C);
        } catch (e) {
            console.warn("[ExternalAdapter] ChatRoomCharacterUpdate failed:", e);
        }
    },

    /**
     * Returns true for NPC characters. Online player characters are generally
     * identified by `!IsNpc()` rather than `IsPlayer()`, since `IsPlayer()` is
     * only true for the local player.
     * @param {Character} C
     * @returns {boolean}
     */
    isNpcCharacter(C) {
        if (!C) return false;
        if (typeof C.IsNpc === 'function') {
            try {
                return !!C.IsNpc();
            } catch (e) {
                return false;
            }
        }
        if (typeof C.IsPlayer === 'function') {
            try {
                return !C.IsPlayer() && C !== hostWindow.Player;
            } catch (e) {
                return C !== hostWindow.Player;
            }
        }
        return false;
    },

    /**
     * Returns true for player-controlled characters, including other online
     * players in `Character[]`. Prefer this over `IsPlayer()` for target lists.
     * @param {Character} C
     * @returns {boolean}
     */
    isPlayerControlledCharacter(C) {
        if (!C) return false;
        if (typeof C.IsNpc === 'function') {
            try {
                return !C.IsNpc();
            } catch (e) {
                return C === hostWindow.Player;
            }
        }
        if (typeof C.IsPlayer === 'function') {
            try {
                return !!C.IsPlayer();
            } catch (e) {
                return C === hostWindow.Player;
            }
        }
        return C === hostWindow.Player;
    },

    /**
     * Returns true only for the local player character.
     * @param {Character} C
     * @returns {boolean}
     */
    isSelfCharacter(C) {
        if (!C) return false;
        if (C === hostWindow.Player) return true;
        if (typeof C.IsPlayer === 'function') {
            try {
                return !!C.IsPlayer();
            } catch (e) {
                return false;
            }
        }
        return false;
    },

    /**
     * Checks whether the player can currently change clothes on the target.
     * Kept in sync with applyOutfitToCharacter so UI target lists and the
     * actual apply action agree on what is allowed.
     * @param {Character} C - Target character
     * @returns {boolean}
     */
    canChangeClothesOnCharacter(C) {
        if (!C) return false;

        if (ExternalAdapter.isNpcCharacter(C)) return false;

        const self = ExternalAdapter.isSelfCharacter(C);
        const callPlayerCheck = (method, fallback = true) => {
            if (typeof hostWindow.Player?.[method] !== 'function') return fallback;
            try {
                return !!hostWindow.Player[method]();
            } catch (e) {
                console.warn(`[ExternalAdapter] Player.${method} failed:`, e);
                return false;
            }
        };
        const playerCanInteract = callPlayerCheck('CanInteract');
        const playerCanChangeOwn = callPlayerCheck('CanChangeOwnClothes');

        if (self) {
            return !!playerCanChangeOwn;
        }

        const isEnclosed = typeof C.IsEnclose === 'function' ? C.IsEnclose() : false;
        const neckItem = ExternalAdapter.inventoryGet(C, "ItemNeck");
        const hasClubSlaveCollar = neckItem?.Asset?.Name === "ClubSlaveCollar";
        const blockedByDistance = typeof hostWindow.InventoryIsBlockedByDistance === 'function'
            ? hostWindow.InventoryIsBlockedByDistance(C)
            : false;

        return !!playerCanInteract &&
            !isEnclosed &&
            !hasClubSlaveCollar &&
            !blockedByDistance;
    },

    /**
     * Checks whether a bundle item can be accessed on a target, following the
     * same shape as BCX wardrobe's ValidationCanAccessCheck.
     * @param {Character} C
     * @param {object} item
     * @returns {boolean}
     */
    canAccessBundleItem(C, item) {
        if (!C || !item?.Group || !item?.Name) return false;

        const playerNumber = hostWindow.Player?.MemberNumber;
        if (typeof hostWindow.ValidationIsItemBlockedOrLimited === 'function') {
            try {
                if (hostWindow.ValidationIsItemBlockedOrLimited(C, playerNumber, item.Group, item.Name)) {
                    return false;
                }
            } catch (e) {
                console.warn("[ExternalAdapter] ValidationIsItemBlockedOrLimited failed:", e);
            }
        }

        if (ExternalAdapter.isSelfCharacter(C) && typeof hostWindow.InventoryIsPermissionBlocked === 'function') {
            try {
                if (hostWindow.InventoryIsPermissionBlocked(C, item.Name, item.Group)) {
                    return false;
                }
            } catch (e) {
                console.warn("[ExternalAdapter] InventoryIsPermissionBlocked failed:", e);
            }
        }

        return true;
    },

    _stableStringify(value) {
        if (value === undefined) return '';
        const normalize = (input) => {
            if (Array.isArray(input)) return input.map(normalize);
            if (!input || typeof input !== 'object') return input;
            return Object.keys(input)
                .sort()
                .reduce((acc, key) => {
                    acc[key] = normalize(input[key]);
                    return acc;
                }, {});
        };
        try {
            return JSON.stringify(normalize(value));
        } catch (e) {
            try {
                return JSON.stringify(value);
            } catch (ee) {
                return String(value);
            }
        }
    },

    _colorsEqual(a, b) {
        return ExternalAdapter._stableStringify(a ?? "Default") === ExternalAdapter._stableStringify(b ?? "Default");
    },

    _bundleItemsEquivalent(currentItem, bundleItem) {
        if (!currentItem && !bundleItem) return true;
        if (!currentItem || !bundleItem) return false;
        return currentItem.Asset?.Name === bundleItem.Name &&
            ExternalAdapter._colorsEqual(currentItem.Color, bundleItem.Color) &&
            ExternalAdapter._stableStringify(currentItem.Property ?? {}) === ExternalAdapter._stableStringify(bundleItem.Property ?? {});
    },

    _collectLockedOrBlockedGroups(C) {
        const groups = new Set();
        const appearance = Array.isArray(C?.Appearance) ? C.Appearance : [];

        const visitItem = (item) => {
            if (!item?.Asset?.Group?.Name) return;
            const blocks = [
                ...(Array.isArray(item.Asset?.Block) ? item.Asset.Block : []),
                ...(Array.isArray(item.Property?.Block) ? item.Property.Block : [])
            ];
            for (const block of blocks) {
                if (groups.has(block)) continue;
                groups.add(block);
                const blockedItem = appearance.find(a => a?.Asset?.Group?.Name === block);
                if (blockedItem) visitItem(blockedItem);
            }
        };

        for (const item of appearance) {
            const groupName = item?.Asset?.Group?.Name;
            if (!groupName) continue;
            const inventoryItem = ExternalAdapter.inventoryGet(C, groupName) || item;
            const locked = inventoryItem?.Property?.Effect?.includes?.("Lock") ||
                item?.Property?.Effect?.includes?.("Lock") ||
                ExternalAdapter.inventoryItemHasEffect(inventoryItem, "Lock");
            if (!locked || groups.has(groupName)) continue;
            groups.add(groupName);
            visitItem(item);
        }

        return groups;
    },

    /**
     * Validates an appearance bundle before applying it. This mirrors the
     * important BCX wardrobe checks: target can be changed, every asset exists
     * and is accessible, body cosplay preferences are respected, and locked
     * items or groups blocked by locked items are not altered.
     * @param {Character} C
     * @param {Array} outfitBundle
     * @returns {{ ok: boolean, reason: string, messages: string[] }}
     */
    validateOutfitBundleForCharacter(C, outfitBundle, { forceSelf = false } = {}) {
        const messages = [];

        if (!C) {
            return { ok: false, reason: 'missing-character', messages: ["Character is required"] };
        }
        if (!Array.isArray(outfitBundle)) {
            return { ok: false, reason: 'invalid-bundle', messages: ["Outfit bundle must be an array"] };
        }
        if (forceSelf && (C !== hostWindow.Player || !isForceSelfApplyEnabled())) {
            return { ok: false, reason: 'force-self-disabled', messages: ["Force apply is available only for the local player when enabled"] };
        }
        if (!forceSelf && !ExternalAdapter.canChangeClothesOnCharacter(C)) {
            return { ok: false, reason: 'target-not-interactable', messages: ["Cannot change clothes on this character"] };
        }

        const byGroup = new Map();
        const appearance = Array.isArray(C.Appearance) ? C.Appearance : [];
        for (const item of outfitBundle) {
            if (!item || typeof item.Group !== 'string' || typeof item.Name !== 'string') {
                messages.push("Outfit bundle contains an invalid item");
                continue;
            }
            if (byGroup.has(item.Group)) {
                messages.push(`Duplicate group in outfit bundle: ${item.Group}`);
                continue;
            }
            byGroup.set(item.Group, item);

            // These entries were copied from the live character, not selected
            // by the outfit. BC may serialize their colors in another shape.
            if (isHiddenBodySlot(item.Group)) {
                if (!ExternalAdapter.assetGet(C.AssetFamily, item.Group, item.Name)) {
                    messages.push(`Protected asset not available: ${item.Group}/${item.Name}`);
                }
                continue;
            }

            const currentItem = appearance.find(a => a?.Asset?.Group?.Name === item.Group);
            const changesCurrentItem = !ExternalAdapter._bundleItemsEquivalent(currentItem, item);
            if (!changesCurrentItem) continue;

            const asset = ExternalAdapter.assetGet(C.AssetFamily, item.Group, item.Name);
            if (!asset) {
                messages.push(`Asset not found: ${item.Group}/${item.Name}`);
                continue;
            }
            if (asset.BodyCosplay && C.OnlineSharedSettings?.BlockBodyCosplay && !ExternalAdapter.isSelfCharacter(C)) {
                messages.push(`Body cosplay is blocked for target: ${item.Group}/${item.Name}`);
            }
            if (!forceSelf && !ExternalAdapter.canAccessBundleItem(C, item)) {
                messages.push(`Asset is blocked or inaccessible: ${item.Group}/${item.Name}`);
            }
        }

        const lockedGroups = ExternalAdapter._collectLockedOrBlockedGroups(C);
        for (const group of lockedGroups) {
            if (isHiddenBodySlot(group)) continue;
            const currentItem = appearance.find(a => a?.Asset?.Group?.Name === group);
            const bundleItem = byGroup.get(group);
            if (!ExternalAdapter._bundleItemsEquivalent(currentItem, bundleItem)) {
                messages.push(`Refusing to change locked or lock-blocked group: ${group}`);
            }
        }

        return {
            ok: messages.length === 0,
            reason: messages.length === 0 ? '' : 'bundle-not-allowed',
            messages
        };
    },

    /**
     * Applies outfit bundle to character with refresh and chat room update
     * @param {Character} C - Target character
     * @param {Array} outfitBundle - Outfit bundle to apply
     * @returns {boolean} True if successful, false otherwise
     */
    applyOutfitToCharacter(C, outfitBundle, { forceSelf = false } = {}) {
        if (!C || !Array.isArray(outfitBundle)) return false;
        if (forceSelf && (C !== hostWindow.Player || !isForceSelfApplyEnabled())) return false;

        const protectedBundle = preserveHiddenBodySlots(currentAppearanceBundle(C), outfitBundle);
        const validation = ExternalAdapter.validateOutfitBundleForCharacter(C, protectedBundle, { forceSelf });
        if (!validation.ok) {
            console.error("[ExternalAdapter] applyOutfitToCharacter: invalid outfit bundle", validation.messages);
            return false;
        }

        const previousAppearance = C.Appearance;
        const liveAppearance = Array.isArray(previousAppearance) ? [...previousAppearance] : [];
        const success = ExternalAdapter.serverAppearanceLoad(
            C,
            C.AssetFamily,
            protectedBundle,
            C.MemberNumber
        );

        // BC rebuilds every bundled item. Keep the live protected appearance
        // objects even when it reconstructs or sanitizes their bundle entries.
        const loadedAppearance = C.Appearance;
        const appearanceChanged = loadedAppearance !== previousAppearance ||
            (Array.isArray(loadedAppearance) &&
                (loadedAppearance.length !== liveAppearance.length ||
                    loadedAppearance.some((item, index) => item !== liveAppearance[index])));
        if (appearanceChanged) {
            C.Appearance = preserveHiddenBodySlots(liveAppearance, Array.isArray(loadedAppearance) ? loadedAppearance : []);
        }

        // BC can install a sanitized, partial appearance while returning false.
        // Refresh that actual result so the character canvas and self sync agree.
        if (!success && appearanceChanged) {
            ExternalAdapter.refreshCharacter(C);
            // BC may have broadcast its partial result before returning false.
            if (ExternalAdapter.isSelfCharacter(C)) ExternalAdapter.chatRoomUpdate(C);
        }

        if (success) {

            ExternalAdapter.refreshCharacter(C);
            ExternalAdapter.chatRoomUpdate(C);

            if (!ExternalAdapter.isSelfCharacter(C)) {
                // Send a notification if we've changed clothes on someone else
                ExternalAdapter.refreshCharacter(C);
                ExternalAdapter.chatRoomUpdate(C);
                const Dictionary = new DictionaryBuilder()
                    .sourceCharacter(hostWindow.Player)
                    .destinationCharacter(C)
                    //.text('MISSING TEXT IN "Interface.csv": TestAction',"TAGTEXT SourceCharacter TargetCharacter PronounPossessive")
                    .build();
                hostWindow.ServerSend("ChatRoomChat", { Content: "ChangeClothes", Type: "Action", Dictionary: Dictionary });
                //hostWindow.ServerSend("ChatRoomChat", { Content: "ChangeClothes", Type: "Action", Dictionary: Dictionary });
                //hostWindow.ChatRoomPublishCustomAction("TestAction", false, Dictionary);
            }
        }

        return success;
    },

    /** Bypasses VPW's usual clothing permission precheck for the local player only. */
    applyOutfitToSelfForced(C, outfitBundle) {
        return ExternalAdapter.applyOutfitToCharacter(C, outfitBundle, { forceSelf: true });
    },

    sendRetriveOutfitNotification(C) {
        if (!C) {
            console.error("[ExternalAdapter] sendRetriveOutfitNotification: Character is required");
            return;
        }
        if (ExternalAdapter.isSelfCharacter(C)) {
            // No notification for player
            return;
        }
        const Dictionary = new DictionaryBuilder()
            .sourceCharacter(hostWindow.Player)
            .destinationCharacter(C)
            .text('MISSING TEXT IN "Interface.csv": OutfitRetrieved',"[VPW] SourceCharacter has retrieved the current outfit of TargetCharacter.")
            .build();
        hostWindow.ServerSend("ChatRoomChat", { Content: "OutfitRetrieved", Type: "Action", Dictionary: Dictionary });
    }

};
