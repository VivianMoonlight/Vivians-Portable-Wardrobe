/**
 * Simplified rendering functions for drawing outfit data on canvas elements.
 */
import { hostWindow } from './host-window.js';

const DEFAULT_WIDTH = 500;
const DEFAULT_HEIGHT = 1000;
const MAX_RENDER_CHARACTER_POOL_SIZE = 4;
const RENDER_CHARACTER_PREFIX = 'VPWRenderCharacter';

let renderCharacterId = 0;
const renderCharacterPool = [];

function getZoom(width, height) {
    const zoomX = width / DEFAULT_WIDTH;
    const zoomY = height / DEFAULT_HEIGHT;
    return Math.min(zoomX, zoomY);
}

function getCanvasContext(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try {
        return canvas.getContext('2d');
    } catch (e) {
        console.error("[render_api] Could not get canvas context:", e);
        return null;
    }
}

function clearCanvas(ctx, canvas) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
}

function acquireRenderCharacter() {
    const pooled = renderCharacterPool.pop();
    if (pooled) return pooled;

    if (typeof hostWindow.CharacterLoadSimple !== 'function') {
        console.error("[render_api] CharacterLoadSimple is not available");
        return null;
    }

    const character = hostWindow.CharacterLoadSimple(`${RENDER_CHARACTER_PREFIX}${renderCharacterId++}`);
    if (!character) return null;

    character.MemberNumber = 1000000000 + renderCharacterId;
    return character;
}

function releaseRenderCharacter(character) {
    if (!character) return;
    if (renderCharacterPool.length < MAX_RENDER_CHARACTER_POOL_SIZE) {
        renderCharacterPool.push(character);
        return;
    }
    if (typeof hostWindow.CharacterDelete === 'function') {
        hostWindow.CharacterDelete(character);
    }
}

function prepareRenderCharacter(character, data) {
    if (!character) return false;
    if (typeof hostWindow.CharacterNaked !== 'function'
        || typeof hostWindow.ServerAppearanceLoadFromBundle !== 'function'
        || typeof hostWindow.CharacterRefresh !== 'function') {
        console.error("[render_api] Required character rendering functions are not available");
        return false;
    }

    hostWindow.CharacterNaked(character);
    hostWindow.ServerAppearanceLoadFromBundle(
        character,
        character.AssetFamily,
        Array.isArray(data) ? data : [],
        character.MemberNumber
    );
    hostWindow.CharacterRefresh(character);
    return true;
}

function drawCharacterToCanvas(character, canvas, ctx, x, y, zoom) {
    if (typeof hostWindow.DrawCharacter !== 'function') {
        console.error("[render_api] DrawCharacter is not available");
        return false;
    }

    clearCanvas(ctx, canvas);
    ctx.save();
    try {
        hostWindow.DrawCharacter(character, x, y, zoom, true, ctx);
        return true;
    } finally {
        ctx.restore();
    }
}

/**
 * Draws a thumbnail-sized character preview.
 * @param {Object} params
 * @param {Array} params.data
 * @param {HTMLCanvasElement|OffscreenCanvas} params.canvas
 * @param {number} params.width
 * @param {number} params.height
 * @returns {boolean}
 */
export function drawThumb({ data = [], canvas = null, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT } = {}) {
    const zoom = getZoom(width, height);
    return drawDataOnCanvas({
        data,
        canvas,
        options: {
            zoom,
            xshift: 0,
            yshift: 0
        }
    });
}

/**
 * Draws a full-size character preview.
 * @param {Object} params
 * @param {Array} params.data
 * @param {HTMLCanvasElement|OffscreenCanvas} params.canvas
 * @param {number} params.width
 * @param {number} params.height
 * @param {Object} params.character
 * @returns {boolean}
 */
export function drawPreview({ data = [], canvas = null, width = 1000, height = 2000, character = null } = {}) {
    const zoom = getZoom(width, height);
    const ctx = getCanvasContext(canvas);
    if (!ctx) {
        console.error("[render_api] drawPreview: Could not get canvas context");
        return false;
    }

    if (character) {
        try {
            return drawCharacterToCanvas(character, canvas, ctx, 0, 0, zoom);
        } catch (e) {
            console.error("[render_api] drawPreview: Error drawing character:", e);
            return false;
        }
    }

    return drawDataOnCanvas({
        data,
        canvas,
        options: {
            zoom,
            xshift: 0,
            yshift: 0
        }
    });
}

/**
 * Core rendering function that applies outfit data to a pooled temporary character
 * and draws it to a canvas.
 * @param {Object} params
 * @param {Array} params.data
 * @param {HTMLCanvasElement|OffscreenCanvas} params.canvas
 * @param {Object} params.options
 * @param {number} [params.options.zoom=1]
 * @param {number} [params.options.xshift=0]
 * @param {number} [params.options.yshift=0]
 * @returns {boolean}
 */
export function drawDataOnCanvas({ data = [], canvas = null, options = {} } = {}) {
    const zoom = options.zoom || 1;
    const xshift = options.xshift || 0;
    const yshift = options.yshift || 0;

    if (!data || !canvas) {
        console.warn("[render_api] drawDataOnCanvas: data and canvas are required");
        return false;
    }

    const ctx = getCanvasContext(canvas);
    if (!ctx) {
        console.error("[render_api] drawDataOnCanvas: Could not get canvas context");
        return false;
    }

    const displayCharacter = acquireRenderCharacter();
    if (!displayCharacter) {
        console.error("[render_api] drawDataOnCanvas: Failed to create display character");
        return false;
    }

    try {
        if (!prepareRenderCharacter(displayCharacter, data)) return false;
        return drawCharacterToCanvas(displayCharacter, canvas, ctx, xshift, yshift, zoom);
    } catch (e) {
        console.error("[render_api] drawDataOnCanvas: Error drawing character on canvas:", e);
        return false;
    } finally {
        releaseRenderCharacter(displayCharacter);
    }
}

export const RenderApi = {
    drawThumb,
    drawPreview,
    drawDataOnCanvas
};
