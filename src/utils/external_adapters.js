/**
 * external_adapters.js
 * Centralizes and safely wraps all calls to external game engine functions with error handling.
 * Provides defensive checks and appropriate fallback values for all external interactions.
 */

import { hostWindow } from './host-window.js';

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
     * Exports outfit data as compressed BCX code and copies to clipboard
     * @param {string} name - Outfit name
     * @param {Array} dataList - Outfit data list
     * @returns {string} Compressed BCX code
     */

    exportOutfitAsBCX(name, dataList) {
        const code = LZString.compressToBase64(JSON.stringify(dataList));
        //copy to clipboard
        try {
            hostWindow.navigator.clipboard.writeText(code);
            console.log("[ExternalAdapter] Outfit BCX code copied to clipboard");
        } catch (e) {
            console.error("[ExternalAdapter] Failed to copy BCX code to clipboard:", e);
        }
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
            hostWindow.ServerAppearanceLoadFromBundle(C, family, bundle, memberNumber);
            return true;
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
        if (!family || !group || !name) return null;
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
     * Applies outfit bundle to character with refresh and chat room update
     * @param {Character} C - Target character
     * @param {Array} outfitBundle - Outfit bundle to apply
     * @returns {boolean} True if successful, false otherwise
     */
    applyOutfitToCharacter(C, outfitBundle) {


        if (!C) {
            console.error("[ExternalAdapter] applyOutfitToCharacter: Character is required");
            return false;
        }
        if (!Array.isArray(outfitBundle)) {
            console.error("[ExternalAdapter] applyOutfitToCharacter: outfitBundle must be an array");
            return false;
        }
        if (!C.IsPlayer() && (!hostWindow.Player.CanInteract() ||
            C.IsEnclose() ||
            (InventoryGet(C, "ItemNeck") !== null &&
                InventoryGet(C, "ItemNeck").Asset.Name == "ClubSlaveCollar") ||
            hostWindow.InventoryIsBlockedByDistance(C))) {
            console.error("[ExternalAdapter] applyOutfitToCharacter: Cannot change clothes on this character");
            return false;
        }
        if (C.IsPlayer() && !hostWindow.Player.CanChangeClothesOn(hostWindow.Player)) {
            console.error("[ExternalAdapter] applyOutfitToCharacter: Player cannot change their own clothes right now");
            return false;
        }

        const success = ExternalAdapter.serverAppearanceLoad(
            C,
            C.AssetFamily,
            outfitBundle,
            C.MemberNumber
        );

        if (success) {

            ExternalAdapter.refreshCharacter(C);
            ExternalAdapter.chatRoomUpdate(C);

            if (!C.IsPlayer()) {
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

    sendRetriveOutfitNotification(C) {
        if (!C) {
            console.error("[ExternalAdapter] sendRetriveOutfitNotification: Character is required");
            return;
        }
        if (C.IsPlayer()) {
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