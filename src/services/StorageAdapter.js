/**
 * Abstraction layer for local and online storage with optional compression support.
 *
 * API notes:
 *  - saveLocal(keyOrMember, obj) / loadLocal(keyOrMember)
 *  - saveOnline(key, obj) / loadOnline(key)
 *
 * This adapter accepts flexible "key" argument: string keys (eg. 'filetree')
 * or numeric member ids that will be stringified.
 */
export class StorageAdapter {
    /**
     * Initializes adapter with storage backends and optional compressor
     * @param {Object} params - Configuration object
     * @param {Object} [params.local={}] - Local storage backend with { get(key), set(key, value) }
     * @param {Object} [params.online={}] - Online storage backend with { get(key), set(key, value) }
     * @param {Object} [params.compressor=null] - Optional compressor with { compress(str), decompress(str) }
     */
    constructor({ local = {}, online = {}, compressor = null } = {}) {
        this.local = local;
        this.online = online;
        this.compressor = compressor;
        this.prefix = 'VPWardrobe_';
    }

    _normalizeKey(key) {
        if (key === undefined || key === null) return null;
        return String(key);
    }

    _compress(str) {
        if (str === undefined || str === null) return str;
        return this.compressor ? this.compressor.compress(str) : str;
    }

    _decompress(str) {
        if (str === undefined || str === null) return str;
        return this.compressor ? this.compressor.decompress(str) : str;
    }

    /**
     * Saves JSON object to local storage with arbitrary key.
     * @param {string|number} key - key name or member id
     * @param {Object} obj - object to save
     * @returns {boolean}
     */
    saveLocal(key, obj) {
        if (!this.local || typeof this.local.set !== 'function') {
            console.warn('[StorageAdapter] Local storage not configured');
            return false;
        }
        const k = this._normalizeKey(key);
        if (!k) {
            console.error('[StorageAdapter] saveLocal: key required');
            return false;
        }
        try {
            const payload = this._compress(JSON.stringify(obj));
            this.local.set(this.prefix + k, payload);
            return true;
        } catch (e) {
            console.error('[StorageAdapter] saveLocal failed:', e);
            return false;
        }
    }

    /**
     * Loads JSON object from local storage by key
     * @param {string|number} key
     * @returns {Object|null}
     */
    loadLocal(key) {
        if (!this.local || typeof this.local.get !== 'function') {
            console.warn('[StorageAdapter] Local storage not configured');
            return null;
        }
        const k = this._normalizeKey(key);
        if (!k) {
            console.error('[StorageAdapter] loadLocal: key required');
            return null;
        }
        try {
            const raw = this.local.get(this.prefix + k);
            if (!raw) return null;
            return JSON.parse(this._decompress(raw));
        } catch (e) {
            console.error('[StorageAdapter] loadLocal failed:', e);
            return null;
        }
    }

    /**
     * Saves compressed JSON to online storage.
     * @param {string|number} key
     * @param {Object} obj
     * @returns {*} Result from online storage set operation
     */
    saveOnline(key, obj) {
        if (!this.online || typeof this.online.set !== 'function') {
            console.warn('[StorageAdapter] Online storage not configured');
            return;
        }
        const k = this._normalizeKey(key);
        try {
            const payload = this._compress(JSON.stringify(obj));
            // call set with key where possible
            return this.online.set(k, payload);
        } catch (e) {
            console.error('[StorageAdapter] saveOnline failed:', e);
            return;
        }
    }

    /**
     * Loads and parses JSON from online storage using online.get(key).
     * @param {string|number} key
     * @returns {Object|null}
     */
    loadOnline(key) {
        if (!this.online || typeof this.online.get !== 'function') {
            console.error('[StorageAdapter] Online getter not configured');
            return null;
        }
        const k = this._normalizeKey(key);
        if (!k) {
            console.error('[StorageAdapter] loadOnline: key required');
            return null;
        }
        try {
            const raw = this.online.get(k);
            if (!raw) return null;
            return JSON.parse(this._decompress(raw));
        } catch (e) {
            console.error('[StorageAdapter] loadOnline failed:', e);
            return null;
        }
    }
}