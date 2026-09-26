import { hostWindow, setTimeoutHost, clearTimeoutHost } from '@/utils/host-window.js';
import { createCanvas } from '@/utils/canvas.js';

/** Visible consumers share event-driven render sessions and a bounded canvas cache. */
export class RenderService {
    constructor({
        drawCallbacks, thumbwidth = 250, thumbheight = 500,
        previewwidth = 500, previewheight = 1000,
        maxCacheBytes = 16 * 1024 * 1024, maxThumbnails = 2, startsPerFrame = 2,
        canvasFactory = createCanvas,
        scheduleFrame = (callback) => hostWindow.requestAnimationFrame
            ? hostWindow.requestAnimationFrame(callback) : setTimeoutHost(callback, 16),
        cancelFrame = (id) => hostWindow.cancelAnimationFrame
            ? hostWindow.cancelAnimationFrame(id) : clearTimeoutHost(id),
    } = {}) {
        Object.assign(this, {
            drawCallbacks, thumbwidth, thumbheight, previewwidth, previewheight,
            canvasFactory, scheduleFrame, cancelFrame,
        });
        this.maxCacheBytes = Math.max(0, maxCacheBytes);
        this.maxThumbnails = Math.max(1, maxThumbnails);
        this.startsPerFrame = Math.max(1, startsPerFrame);
        // The weak item lookup contains keys only, never an evicted canvas.
        this.registry = new WeakMap();
        this.entries = new Map();
        this.observers = new Map();
        this.cache = new Map();
        this.cacheBytes = 0;
        this.activeThumbnails = 0;
        this.activePreviews = 0;
        this.nextObserver = 0;
        this.frame = null;
        this.pumping = false;
        this.previewKey = null;
    }

    _describe(item, preview) {
        if (!item || !Array.isArray(item.data)) throw new Error('An outfit is required for rendering');
        const dataKey = JSON.stringify(item.data);
        const width = preview ? this.previewwidth : this.thumbwidth;
        const height = preview ? this.previewheight : this.thumbheight;
        const key = `${width}x${height}:${dataKey}`;
        let meta = this.registry.get(item);
        if (!meta) {
            meta = { keys: new Map(), observers: new Set(), preview: false };
            this.registry.set(item, meta);
        }
        const previousKey = meta.keys.get(preview);
        if (previousKey && previousKey !== key) {
            for (const id of [...meta.observers]) {
                if (this.observers.get(id)?.key === previousKey) this._unsubscribe(id);
            }
        }
        meta.keys.set(preview, key);
        if (preview) meta.preview = true;
        return { key, dataKey, width, height, preview, meta };
    }

    _entry(description) {
        let entry = this.entries.get(description.key);
        if (!entry) {
            entry = {
                key: description.key, data: JSON.parse(description.dataKey),
                width: description.width, height: description.height,
                preview: description.preview, phase: 'queued', canvas: null,
                observers: new Set(), generation: 0, session: null,
            };
            this.entries.set(entry.key, entry);
        } else if (entry.phase === 'queued' && description.preview) {
            entry.preview = true;
        }
        this._touch(entry.key);
        return entry;
    }

    _selectPreview(key) {
        if (this.previewKey === key) return;
        this.previewKey = key;
        for (const entry of [...this.entries.values()]) {
            if (entry.preview && entry.key !== key && entry.phase !== 'ready') {
                this._drop(entry, { state: 'error', error: new Error('Rendering cancelled') });
            }
        }
    }

    /** Mark the latest preview without rendering it until its canvas is visible. */
    renderPreviewWithItem(item) {
        if (!item || item.type === 'folder') return;
        this._selectPreview(this._describe(item, true).key);
    }

    observe(item, callback, { preview = false } = {}) {
        let description;
        try {
            description = this._describe(item, preview);
        } catch (error) {
            this._call(callback, null, { state: 'error', error });
            return () => {};
        }
        if (preview) this._selectPreview(description.key);
        const entry = this._entry(description);
        const id = ++this.nextObserver;
        this.observers.set(id, { key: entry.key, callback, meta: description.meta });
        description.meta.observers.add(id);
        entry.observers.add(id);
        this._call(callback, entry.canvas, { state: entry.phase === 'ready' ? 'ready' : 'loading' });
        this._requestPump();
        return () => this._unsubscribe(id);
    }

    _call(callback, canvas, status) {
        try { callback(canvas, status); }
        catch (error) { console.warn('[RenderService] Render observer failed:', error); }
    }

    _notify(entry, status) {
        for (const id of [...entry.observers]) {
            const observer = this.observers.get(id);
            if (observer) this._call(observer.callback, entry.canvas, status);
        }
    }

    _unsubscribe(id) {
        const observer = this.observers.get(id);
        if (!observer) return;
        this.observers.delete(id);
        observer.meta.observers.delete(id);
        const entry = this.entries.get(observer.key);
        if (!entry) return;
        entry.observers.delete(id);
        if (!entry.observers.size && entry.phase !== 'ready') this._drop(entry);
    }

    _next() {
        const queued = [...this.entries.values()].filter((entry) => entry.phase === 'queued');
        return (!this.activePreviews && queued.find((entry) => entry.preview))
            || (this.activeThumbnails < this.maxThumbnails && queued.find((entry) => !entry.preview));
    }

    _requestPump() {
        if (this.pumping || this.frame !== null || !this._next()) return;
        this.frame = this.scheduleFrame(() => {
            this.frame = null;
            this.pumping = true;
            try {
                for (let count = 0; count < this.startsPerFrame; count++) {
                    const entry = this._next();
                    if (!entry) break;
                    this._start(entry);
                }
            } finally {
                this.pumping = false;
                this._requestPump();
            }
        });
    }

    _start(entry) {
        entry.phase = 'active';
        if (entry.preview) this.activePreviews++;
        else this.activeThumbnails++;
        const generation = ++entry.generation;
        const onUpdate = (canvas, status) => {
            if (this.entries.get(entry.key) !== entry || entry.generation !== generation || entry.phase !== 'active') return;
            if (canvas) entry.canvas = canvas;
            if (status.state === 'error') {
                this._drop(entry, status);
                return;
            }
            const terminal = status.state === 'ready';
            if (terminal) {
                this._releaseSlot(entry);
                entry.phase = status.state;
                this._disposeSession(entry);
            }
            this._notify(entry, status);
            if (terminal) {
                if (status.state === 'ready' && entry.canvas) this._cache(entry);
                else this._drop(entry);
                this._requestPump();
            }
        };
        try {
            entry.canvas ||= this.canvasFactory(entry.width, entry.height);
            const session = this.drawCallbacks.createRenderSession({
                data: entry.data, canvas: entry.canvas,
                width: entry.width, height: entry.height, onUpdate,
            });
            // A warm BC image cache can finish during createRenderSession itself.
            if (entry.phase !== 'active') session?.dispose();
            else entry.session = session;
        } catch (error) {
            onUpdate(entry.canvas, { state: 'error', error });
        }
    }

    _releaseSlot(entry) {
        if (entry.phase !== 'active') return;
        if (entry.preview) this.activePreviews--;
        else this.activeThumbnails--;
    }

    _disposeSession(entry) {
        const session = entry.session;
        entry.session = null;
        try { session?.dispose(); }
        catch (error) { console.warn('[RenderService] Render cleanup failed:', error); }
    }

    _touch(key) {
        if (!this.cache.has(key)) return;
        const bytes = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, bytes);
    }

    _cache(entry) {
        // An observer may have cancelled or replaced this generation in its callback.
        if (this.entries.get(entry.key) !== entry) return;
        const bytes = entry.width * entry.height * 4;
        this.cache.set(entry.key, bytes);
        this.cacheBytes += bytes;
        while (this.cacheBytes > this.maxCacheBytes) {
            const key = this.cache.keys().next().value;
            this._drop(this.entries.get(key));
        }
    }

    _drop(entry, status = null) {
        if (!entry || this.entries.get(entry.key) !== entry) return;
        const callbacks = status
            ? [...entry.observers].map((id) => this.observers.get(id)?.callback).filter(Boolean)
            : [];
        const canvas = entry.canvas;
        this.entries.delete(entry.key);
        entry.generation++;
        this._releaseSlot(entry);
        entry.phase = 'disposed';
        if (this.cache.has(entry.key)) {
            this.cacheBytes -= this.cache.get(entry.key);
            this.cache.delete(entry.key);
        }
        for (const id of entry.observers) this._unsubscribe(id);
        entry.observers.clear();
        entry.canvas = null;
        this._disposeSession(entry);
        // A terminal callback may immediately subscribe to a new generation.
        for (const callback of callbacks) this._call(callback, canvas, status);
        if (this.frame !== null && !this._next()) {
            this.cancelFrame(this.frame);
            this.frame = null;
        }
        this._requestPump();
    }

    _getCanvas(item) {
        const meta = item && this.registry.get(item);
        const key = meta?.keys.get(meta.preview);
        this._touch(key);
        return this.entries.get(key)?.canvas ?? null;
    }

    /** Compatibility for callers that await a finished canvas. No polling is used. */
    getCanvas(item, { timeout = 0, preview = this.registry.get(item)?.preview ?? false } = {}) {
        if (!item) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            let unsubscribe;
            let timer;
            let finished = false;
            const finish = (canvas, status) => {
                if (status.state === 'loading') return;
                finished = true;
                if (timer) clearTimeoutHost(timer);
                unsubscribe?.();
                if (status.state === 'error') reject(status.error);
                else resolve(canvas);
            };
            unsubscribe = this.observe(item, finish, { preview });
            if (finished) unsubscribe();
            else if (timeout > 0) {
                timer = setTimeoutHost(() => {
                    unsubscribe();
                    reject(new Error('Thumbnail timeout'));
                }, timeout);
            }
        });
    }

    startThumbFor(item) {
        if (!item || item.type === 'folder') return null;
        const description = this._describe(item, false);
        const entry = this._entry(description);
        entry.canvas ||= this.canvasFactory(entry.width, entry.height);
        let unsubscribe;
        let finished = false;
        unsubscribe = this.observe(item, (_canvas, status) => {
            if (status.state !== 'loading') {
                finished = true;
                unsubscribe?.();
            }
        });
        if (finished) unsubscribe();
        return entry.canvas;
    }

    stopFor(item) {
        const meta = item && this.registry.get(item);
        if (!meta) return;
        const ids = [...meta.observers];
        const callbacks = ids.map((id) => this.observers.get(id)?.callback).filter(Boolean);
        this.registry.delete(item);
        for (const id of ids) this._unsubscribe(id);
        const status = { state: 'error', error: new Error('Rendering cancelled') };
        for (const callback of callbacks) this._call(callback, null, status);
    }

    removeCanvas(item) {
        const entries = [...(this.registry.get(item)?.keys.values() ?? [])]
            .map((key) => this.entries.get(key));
        this.registry.delete(item);
        const status = { state: 'error', error: new Error('Rendering cancelled') };
        for (const entry of entries) this._drop(entry, status);
    }
}
