/**
 * Manages thumbnail generation with polling-based updates until rendering stabilizes.
 * Uses image hashing to detect when rendering is complete.
 *
 * Performance note:
 * - We create the small thumbnail canvas's 2D context with { willReadFrequently: true }
 *   because we call getImageData repeatedly for hashing. This avoids repeated expensive
 *   readbacks on some browsers (Chrome warns otherwise).
 * - bigCanvas is used as a higher-resolution render target and we typically don't read it,
 *   so we use a normal context for it.
 */
import { doc, setTimeoutHost, clearTimeoutHost } from '@/utils/host-window.js';
import { createCanvas, get2DContext } from '@/utils/canvas.js';

export class RenderService {
    constructor({ drawCallbacks, thumbwidth = 250, thumbheight = 500, previewwidth = 500, previewheight = 1000, pollInterval = 500 } = {}) {
        this.drawCallbacks = drawCallbacks;
        this.thumbwidth = thumbwidth;
        this.thumbheight = thumbheight;
        this.pollInterval = pollInterval;
        this.previewwidth = previewwidth;
        this.previewheight = previewheight;

        // item -> { canvas, lastHash, stopped, timerId, resolvePromise, promise }
        this.registry = new WeakMap();

        // item -> { promise, resolve, reject, timer }
        // keep pending waiters for getThumbCanvas()
        this._pending = new WeakMap();

        // BC drawing uses shared global scratch canvases, so serialize render calls.
        this._renderQueue = Promise.resolve();
    }

    _createThumbCanvas() {
        return createCanvas(this.thumbwidth, this.thumbheight);
    }

    _createPreviewCanvas() {
        return createCanvas(this.previewwidth, this.previewheight);
    }

    /**
     * Helper to obtain 2D context with graceful fallback.
     * For canvases where we will frequently call getImageData, request { willReadFrequently: true }.
     */
    _get2DContext(canvas, { willReadFrequently = false } = {}) {
        return get2DContext(canvas, willReadFrequently ? { willReadFrequently: true } : {});
    }

    _enqueueRender(task) {
        const run = this._renderQueue.then(task, task);
        this._renderQueue = run.catch(() => { });
        return run;
    }

    _getDataKey(data) {
        try {
            return JSON.stringify(Array.isArray(data) ? data : []);
        } catch {
            return String(Date.now());
        }
    }

    /**
     * 返回当前已创建的 canvas（即使还在渲染中也会返回），或 null
     */
    _getCanvas(item) {
        const meta = this.registry.get(item);
        return meta && meta.canvas ? meta.canvas : null;
    }

    removeCanvas(item) {
        this.stopFor(item);
    }


    /**
     * 返回一个 Promise，在渲染稳定（轮询结束）时 resolve canvas。
     * 如果 canvas 已稳定则立即 resolve。
     */
    getCanvas(item, { timeout = 5000 } = {}) {
        if (!item) return Promise.resolve(null);

        // 如果已经可用并且已经停止（稳定），立即返回已稳定 canvas
        const meta = this.registry.get(item);
        if (meta && meta.stopped) return Promise.resolve(meta.canvas);

        // 如果已经存在 pending waiter，返回它
        if (this._pending.has(item)) return this._pending.get(item).promise;

        // 否则创建一个等待 promise
        let resolveFn, rejectFn;
        const promise = new Promise((resolve, reject) => {
            resolveFn = resolve;
            rejectFn = reject;
        });
        const record = { promise, resolve: resolveFn, reject: rejectFn, timer: null };
        this._pending.set(item, record);

        // 超时保护
        if (timeout && timeout > 0) {
            record.timer = setTimeoutHost(() => {
                if (this._pending.has(item)) {
                    this._pending.delete(item);
                    record.reject(new Error('Thumbnail timeout'));
                }
            }, timeout);
        }

        // 确保 generation 已经启动
       /*  try {
            this.startThumbFor(item);
        } catch (err) {
            // ignore
        } */

        return promise;
    }



    renderPreviewWithItem(item) {
        if (item && item.type && item.type === 'folder') {
            // folders do not have previews
            return;
        }
        if (!item || !item.data){
            console.error('[RenderService] renderPreviewWithItem: item is required');
            return;
        }

        if (!this.drawCallbacks || typeof this.drawCallbacks.drawPreview !== 'function') {
            console.error('[RenderService] renderPreviewWithItem: drawPreview callback not defined');
            return;
        }

        /*  if (!this.previewItem || !this.previewItem.canvas) {
             const canvas = this._createPreviewCanvas();
             const meta = {
                 canvas,
                 lastHash: null,
                 stopped: false,
                 timerId: null
             };
             this.previewItem = meta;
         } */

        const dataKey = this._getDataKey(item.data);
        if (this.registry.has(item) === false) {
            const canvas = this._createPreviewCanvas();
            const meta = {
                canvas,
                lastHash: null,
                stopped: false,
                timerId: null,
                dataKey
            };
            this.registry.set(item, meta);
        }
        const meta = this.registry.get(item);
        meta.dataKey = dataKey;
        if (meta.timerId) {
            clearTimeoutHost(meta.timerId);
            meta.timerId = null;
        }
        const ctx = this._get2DContext(meta.canvas, { willReadFrequently: true });
        if (!ctx) {
            console.error('[RenderService] renderPreviewWithItem: Failed to get canvas context');
            meta.stopped = true;
            return;
        }
        ctx.clearRect(0, 0, meta.canvas.width, meta.canvas.height);
        try {
            // I guess this fucntion is not async so we just call it directly
            this.drawCallbacks.drawPreview({
                data: item.data,
                ctx: ctx,
                canvas: meta.canvas,
                width: meta.canvas.width,
                height: meta.canvas.height
            });

        } catch (e) {
            console.warn('[RenderService] renderPreviewWithItem: drawCallback error:', e);
        }
        meta.stopped = true;
    }

    /**
     * 开始为 item 生成缩略图。立即返回 canvas（同步），同时在后台轮询更新该 canvas。
     * 如果已存在会直接返回已有 canvas（不会重复启动）。
     */
    startThumbFor(item, retry = 6 ) {
        if (!item) {
            console.error('[RenderService] startThumbFor: item is required');
            return null;
        }

        // 若已有启动则返回已有 canvas
        const dataKey = this._getDataKey(item.data);
        const existing = this.registry.get(item);
        if (existing) {
            if (existing.dataKey === dataKey) return existing.canvas;
            this.stopFor(item);
        }

        const canvas = this._createThumbCanvas();

        // 保留元信息
        let externalResolve;
        const stablePromise = new Promise(resolve => { externalResolve = resolve; });

        const meta = {
            canvas,
            lastHash: null,
            stopped: false,
            timerId: null,
            resolvePromise: externalResolve,
            promise: stablePromise,
            dataKey
        };
        this.registry.set(item, meta);

        // bigCanvas: 临时高分辨率渲染目标（我们通常不从它读像素）
        const bigCanvas = doc.createElement('canvas');
        bigCanvas.width = Math.max(1, this.thumbwidth);
        bigCanvas.height = Math.max(1, this.thumbheight);

        const bigCtx = this._get2DContext(bigCanvas, { willReadFrequently: false });
        // thumbnail ctx: we will read pixels frequently to compute hash -> ask for willReadFrequently
        const ctx = this._get2DContext(canvas, { willReadFrequently: true });

        if (!ctx) {
            console.error('[RenderService] Failed to get canvas context');
            meta.stopped = true;
            // resolve pending waiters if any
            this._resolvePending(item, canvas);
            externalResolve(canvas);
            return canvas;
        }

        if (item.type === 'folder') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = '40px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('📁', canvas.width / 2, canvas.height / 2);
            meta.stopped = true;
            this._resolvePending(item, canvas);
            externalResolve(canvas);
            return canvas;
        }

        // Hashing helper: sample bytes to reduce work
        const hashImage = (imgData, { byteStep = 20 } = {}) => {
            const data = imgData.data;
            let hash = 0;
            // only sample every byteStep bytes (reduces CPU and copying cost)
            for (let i = 0; i < data.length; i += byteStep) {
                hash = (hash * 31 + data[i]) >>> 0;
            }
            return hash;
        };

        // capture empty image hash
        let empty;
        try {
            empty = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (e) {
            // If getImageData fails (cross-origin etc), fallback to a default empty buffer-like object
            empty = { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) };
        }
        const emptyhs = hashImage(empty);

        let lastHashes = [];
        const maxEmptyRetry = Math.max(retry * 6, 24);

        const loop = async (count = 0) => {
            if (meta.stopped) return;

            // render into big canvas
            try {
                await this._enqueueRender(() => {
                    if (meta.stopped) return false;
                    if (bigCtx) bigCtx.clearRect(0, 0, bigCanvas.width, bigCanvas.height);
                    // drawCallback is expected to draw into provided ctx/canvas
                    return this.drawCallbacks.drawThumb({
                        data: item.data,
                        ctx: bigCtx || /* fallback */ ctx,
                        canvas: bigCanvas,
                        width: bigCanvas.width,
                        height: bigCanvas.height
                    });
                });
            } catch (e) {
                console.warn('[RenderService] drawCallback error:', e);
            }
            if (meta.stopped) return;

            // 将 bigCanvas 缩放绘制到 thumbnail canvas（这一步不会读回像素）
            try {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(
                    bigCanvas, 0, 0, bigCanvas.width, bigCanvas.height,
                    0, 0, canvas.width, canvas.height
                );
            } catch (e) {
                // drawImage occasionally might fail in some environments — ignore to continue loop
                console.warn('[RenderService] drawImage failed:', e);
            }

            // 读取像素并哈希（这是性能关键点，willReadFrequently 请求会减轻成本）
            let img;
            try {
                img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            } catch (e) {
                // 如果 getImageData 继续失败，则退化为最简单的处理：标记稳定并 resolve
                console.warn('[RenderService] getImageData failed, aborting hash:', e);
                meta.stopped = true;
                meta.timerId = null;
                externalResolve(canvas);
                this._resolvePending(item, canvas);
                return;
            }
            const cur = hashImage(img);
            lastHashes.push(cur);
            if (lastHashes.length > 2) lastHashes.shift();

            const isStable = lastHashes.length === 2 &&
                lastHashes[0] === lastHashes[1] &&
                //lastHashes[1] === lastHashes[2] &&
                //lastHashes[2] === lastHashes[3] &&
                meta.lastHash === cur;
            const isEmpty = cur === emptyhs;

            if (isStable && (!isEmpty || count > maxEmptyRetry)) {
                meta.stopped = true;
                meta.timerId = null;
                // resolve stable promise and pending waiters
                externalResolve(canvas);
                this._resolvePending(item, canvas);
                return;
            }
            meta.lastHash = cur;

            // schedule next loop
            meta.timerId = setTimeoutHost(() => loop(count + 1), this.pollInterval);
        };

        // defer loop start to next tick
        meta.timerId = setTimeoutHost(() => loop(0), 0);

        return canvas;
    }

    /**
     * 停止并清理 item 的生成（并 reject 未完成的 waiters）
     */
    stopFor(item) {
        if (!item) return;
        const meta = this.registry.get(item);
        if (!meta) return;
        meta.stopped = true;
        if (meta.timerId) clearTimeoutHost(meta.timerId);
        this.registry.delete(item);

        // reject any pending getThumbCanvas waiters
        const pend = this._pending.get(item);
        if (pend) {
            if (pend.timer) clearTimeoutHost(pend.timer);
            try { pend.reject(new Error('Thumbnail generation stopped')); } catch { }
            this._pending.delete(item);
        }
    }

    /**
     * 内部：当生成完成或需要 resolve 等待者时调用
     */
    _resolvePending(item, canvas) {
        const pend = this._pending.get(item);
        if (pend) {
            if (pend.timer) clearTimeoutHost(pend.timer);
            try { pend.resolve(canvas); } catch { }
            this._pending.delete(item);
        }
    }
}
