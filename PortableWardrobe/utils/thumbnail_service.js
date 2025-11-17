export class ThumbnailService {
    constructor({ drawCallback, width = 80, height = 160, pollInterval = 1000 } = {}) {
        if (typeof drawCallback !== 'function') throw new Error('drawCallback required');
        this.drawCallback = drawCallback;
        this.width = width; this.height = height;
        this.pollInterval = pollInterval;
        this.registry = new WeakMap(); // item -> {canvas, lastHash, timerId}
    }

    _createCanvas() {
        const canvas = document.createElement('canvas');
        canvas.width = this.width; canvas.height = this.height;
        return canvas;
    }

    startFor(item) {
        if (this.registry.has(item)) return this.registry.get(item).canvas;
        const canvas = this._createCanvas();
        const meta = { canvas, lastHash: null, stopped: false };
        this.registry.set(item, meta);

        const ctx = canvas.getContext('2d');

        if (item.type === 'folder') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = '40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('📁', canvas.width / 2, canvas.height / 2);
            return canvas;
        }

        const hashImage = (imgData) => {
            const data = imgData.data; let hash = 0;
            for (let i = 0; i < data.length; i += 20) { hash = (hash * 31 + data[i]) >>> 0; }
            return hash;
        };

        const empty = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const emptyhs = hashImage(empty)

        const loop = async (count = 0) => {
            if (meta.stopped) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            try {
                await this.drawCallback({ data: item.data, ctx, canvas });
            } catch (e) {
                console.warn("drawCallback error:", e);
            }
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const cur = hashImage(img);
            console.log(`Updating thumb of ${item.name}, retry:[${count}]`);
            // I know someone who have an empty outfit
            if (meta.lastHash === cur && (cur !== emptyhs || count > 5)) { meta.stopped = true; }
            meta.lastHash = cur;
            // 下一轮循环
            meta.timerId = setTimeout(() => loop(count + 1), this.pollInterval);
        };


        meta.timerId = setTimeout(() => loop(0), this.pollInterval);
        return canvas;
    }

    stopFor(item) {
        const meta = this.registry.get(item);
        if (!meta) return;
        meta.stopped = true;
        if (meta.timerId) clearTimeout(meta.timerId);
        this.registry.delete(item);
    }
}
