/**
 * render_api.js
 * Simplified rendering functions for drawing outfit data on canvas elements.
 */

/**
 * Draws a thumbnail-sized character preview at 0.16 zoom with no offset
 * @param {Object} params - Parameters object
 * @param {Array} params.data - Outfit data array to render
 * @param {HTMLCanvasElement} params.canvas - Canvas element to draw on
 * 
 * @example
 * const thumbCanvas = document.createElement('canvas');
 * thumbCanvas.width = 80;
 * thumbCanvas.height = 160;
 * drawThumb({ data: outfitData, canvas: thumbCanvas });
 */

import { hostWindow } from './host-window.js';


function getZoom(width, height){
    const DEFAULT_WIDTH = 500;
    const DEFAULT_HEIGHT = 1000;
    const zoomX = width / DEFAULT_WIDTH;
    const zoomY = height / DEFAULT_HEIGHT;
    return Math.min(zoomX, zoomY);
}



export function drawThumb({ data = [], canvas = null, width = 500, height = 1000 } = {}) {
    const zoom = getZoom(width, height);
    drawDataOnCanvas({
        data,
        canvas,
        options: {
            zoom: zoom,
            xshift: 0,
            yshift: 0
        }
    });  
}

/**
 * Draws a full-size character preview at 1.0 zoom
 * @param {Object} params - Parameters object
 * @param {Array} params.data - Outfit data array to render
 * @param {HTMLCanvasElement} params.canvas - Canvas element to draw on
 * @param {Object} params.character - Optional persistent character instance (for optimized rendering)
 * 
 * @example
 * const previewCanvas = document.getElementById('preview');
 * drawPreview({ data: outfitData, canvas: previewCanvas });
 */
export function drawPreview({ data = [], canvas = null, width = 1000, height = 2000, character = null } = {}) {
    const zoom = getZoom(width, height);
    
    // If persistent character provided, use it directly
    if (character) {
        const ctx = canvas?.getContext('2d');
        if (!ctx) {
            console.error("[render_api] drawPreview: Could not get canvas context");
            return;
        }
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        try {
            // Draw using provided persistent character
            hostWindow.DrawCharacter(character, 0, 0, zoom, true, ctx);
        } catch (e) {
            console.error("[render_api] drawPreview: Error drawing character:", e);
        }
        return;
    }
    
    // Fallback to legacy method (create temporary character)
    drawDataOnCanvas({
        data,
        canvas,
        options: {
            zoom: zoom,
            xshift: 0,
            yshift: 0
        }
    });  
}

/**
 * Core rendering function that creates a temporary character, applies outfit data,
 * and draws to canvas with configurable zoom and offsets
 * @param {Object} params - Parameters object
 * @param {Array} params.data - Outfit data array to render
 * @param {HTMLCanvasElement} params.canvas - Canvas element to draw on
 * @param {Object} params.options - Rendering options
 * @param {number} [params.options.zoom=1] - Zoom level for rendering
 * @param {number} [params.options.xshift=0] - Horizontal offset
 * @param {number} [params.options.yshift=0] - Vertical offset
 * 
 * @example
 * drawDataOnCanvas({
 *   data: outfitData,
 *   canvas: previewCanvas,
 *   options: { zoom: 0.5, xshift: 100, yshift: 50 }
 * });
 */
export function drawDataOnCanvas({ data = [], canvas = null, options = {} } = {}) {
    const zoom = options.zoom || 1;
    const Xshift = options.xshift || 0;
    const Yshift = options.yshift || 0;
    
    if (!data || !canvas) {
        console.warn("[render_api] drawDataOnCanvas: data and canvas are required");
        return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error("[render_api] drawDataOnCanvas: Could not get canvas context");
        return;
    }
    
    const displayCharacter = hostWindow.CharacterLoadSimple("displayCharacter"+Math.random().toString(36).substring(12));
    if (!displayCharacter) {
        console.error("[render_api] drawDataOnCanvas: Failed to create display character");
        return;
    }
    displayCharacter.MemberNumber = 1000000000+Math.floor(Math.random()*1000000);
    // 删除上面的代码会导致与LSCG的兼容性问题！！！
    hostWindow.CharacterNaked(displayCharacter);
    hostWindow.CharacterRefresh(displayCharacter);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    try {
        hostWindow.ServerAppearanceLoadFromBundle(
            displayCharacter,
            displayCharacter.AssetFamily,
            data,
            displayCharacter.MemberNumber
        );
        hostWindow.CharacterRefresh(displayCharacter);
        hostWindow.DrawCharacter(displayCharacter, Xshift, Yshift, zoom, true, ctx);
    } catch (e) {
        console.error("[render_api] drawDataOnCanvas: Error drawing character on canvas:", e);
    } finally {
        hostWindow.CharacterDelete(displayCharacter);
    }
}


export const RenderApi = {
    drawThumb,
    drawPreview,
    drawDataOnCanvas
};