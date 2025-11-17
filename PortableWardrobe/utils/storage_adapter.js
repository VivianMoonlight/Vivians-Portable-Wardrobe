export class StorageAdapter {
    constructor({ local = {}, online = {}, compressor = null } = {}) {
        // local: { get(key), set(key, value) }
        // online: { get(key), set(key, value) }
        this.local = local;
        this.online = online;
        // compressor: { compress(str), decompress(str) }
        this.compressor = compressor;
        this.prefix = 'VPWardrobe';
    }

    _compress(str) { return this.compressor ? this.compressor.compress(str) : str; }
    _decompress(str) { return this.compressor ? this.compressor.decompress(str) : str; }

    saveLocal(memberNumber, obj) {
        if (!this.local || typeof this.local.set !== 'function') return;
        const key = `${this.prefix}${memberNumber}`;
        const payload = this._compress(JSON.stringify(obj));
        this.local.set(key, payload);
    }

    loadLocal(memberNumber) {
        if (!this.local || typeof this.local.get !== 'function') return null;
        const key = `${this.prefix}${memberNumber}`;
        const raw = this.local.get(key);
        if (!raw) return null;
        try { return JSON.parse(this._decompress(raw)); } catch (e) { return null; }
    }

    saveOnline(memberNumber, obj) {
        if (!this.online || typeof this.online.set !== 'function') return;
        const payload = this._compress(JSON.stringify(obj));
        return this.online.set(payload);
    }

    loadOnline(getterFn) {
        // getterFn should return a compressed string or null
        if (typeof getterFn !== 'function') return null;
        const raw = getterFn();
        if (!raw) return null;
        try { return JSON.parse(this._decompress(raw)); } catch (e) { return null; }
    }
}
