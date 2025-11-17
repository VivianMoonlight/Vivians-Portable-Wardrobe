const timestamp = new Date().getTime();

const FileSystem = (await import(`../utils/file_system.js?ts=${timestamp}`)).FileSystem;
const ThumbnailService = (await import(`../utils/thumbnail_service.js?ts=${timestamp}`)).ThumbnailService;
const StorageAdapter = (await import(`../utils/storage_adapter.js?ts=${timestamp}`)).StorageAdapter;
const FileManagerView = (await import(`../ui/file_manager_view.js?ts=${timestamp}`)).FileManagerView;
const HistoryRecord = (await import(`../utils/history_record.js?ts=${timestamp}`)).HistoryRecord;

export class FileManagerController {
    constructor({ container, callback, storageAdapters = {}, compressor = null, drawCallback } = {}) {
        if (!container) throw new Error('container required');
        this.callback = typeof callback === 'function' ? callback : (o => console.warn('no callback', o));

        this.fs = new FileSystem('Home');
        this.onView = this.fs;
        this.thumb = new ThumbnailService({ drawCallback: drawCallback || (({ data, ctx }) => { }), width: 80, height: 160 });
        this.storage = new StorageAdapter({ local: storageAdapters.local || StorageAdapter.defaultLocal(), online: storageAdapters.online || {}, compressor });
        this.view = new FileManagerView(container, { onEvent: this._onViewEvent.bind(this) });

        this.currentPath = [this.onView.getRoot().name];
        this.viewMode = 'grid';

        this.historyRecord = new HistoryRecord('History', 20);

        this.workMode = 'normal'; // normal | history

        this._initFromStorage();
        this.refresh();
    }

    static exampleLocal() { return { get: k => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) }; }

    async _initFromStorage() {
        // attempt online then local
        try {
            const online = this.storage.loadOnline(() => window.Player && Player.ExtensionSettings ? Player.ExtensionSettings.VPWardrobe : null);
            const memberNumber = window.Player ? Player.MemberNumber : 'guest';
            const local = this.storage.loadLocal(memberNumber);
            const mergedRoot = { name: this.fs.getRoot().name, type: 'folder', children: [] };
            if (online) FileSystem.mergeRoots(mergedRoot, online);
            if (local) FileSystem.mergeRoots(mergedRoot, local);
            this.fs.fromJSON(mergedRoot);
            this._initAllThumbs(this.fs.getRoot());
        } catch (e) { console.error(e); }
    }




    _initAllThumbs(node) {
        if (!node || !node.children) return;
        node.children.forEach(child => {
            child.thumbCanvas = this.thumb.startFor(child);
            if (child.type === 'folder') this._initAllThumbs(child);
        });
    }

    _onViewEvent(ev) {
        const { type, payload } = ev;
        if (type === 'up') {
            if (this.currentPath.length > 1) { this.currentPath.pop(); this.refresh(); }
        }
        if (type === 'newFolder') {
            const name = prompt('New folder name', 'New Folder');
            if (!name) return;
            const node = this.fs.getNode(this.currentPath);
            const folder = { name, type: 'folder', children: [] };
            node.children.push(folder);
            folder.thumbCanvas = this.thumb.startFor(folder);
            this._saveAll(); this.refresh();
        }
        if (type === 'search' || type === 'sort' || type === 'toggleView') {
            if (type === 'toggleView') this.viewMode = this.viewMode === 'details' ? 'grid' : 'details';
            this.refresh();
        }
        if (type === 'addressClick') {
            const idx = payload;
            this.currentPath = this.currentPath.slice(0, idx + 1);
            this.refresh();
        }
        if (type.startsWith('contextMenu:')) {
            const action = type.split(':')[1];
            const item = payload;
            if (action === 'delete') {
                if (confirm('Delete?')) {
                    this.onView.removeFile(this.currentPath, item);
                    this._saveAll();
                    this.refresh();
                }
            }
            if (action === 'rename') {
                const n = prompt('New name', item.name);
                if (n) {
                    item.name = n;
                    this._saveAll();
                    this.refresh();
                }
            }
            if (action === 'export' && item.type === 'outfit') {
                try {
                    const code = this.storage.compressor ? this.storage.compressor.compress(JSON.stringify(item.data)) : JSON.stringify(item.data);
                    navigator.clipboard.writeText(code);
                    alert('Copied');
                } catch (e) {
                    alert('Fail');
                }
            }
        }
        if (type === 'contextmenu') {
            const e = payload;
            this.view.showContextMenu(e.clientX, e.clientY, this.view.contextTarget);
        }
    }

    applySearchAndSort(list) {
        const q = this.view.searchInput.value.trim().toLowerCase();
        let out = list.slice();
        if (q) {
            const filtered = [];
            function rf(node) {
                if (node.name.toLowerCase().includes(q)) filtered.push(node);
                if (node.type === 'folder' && node.children) node.children.forEach(rf);
            }
            list.forEach(rf); out = filtered;
        }
        const sort = this.view.sortSelect.value;
        if (sort === 'name-asc') {
            out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        }
        if (sort === 'name-desc') {
            out.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
        }
        if (sort === 'type') {
            out.sort((a, b) => {
                const t = (a.type || "").localeCompare(b.type || "");
                if (t !== 0) return t;
                return (a.name || "").localeCompare(b.name || "");
            });
        }
        return out;
    }



    _attachItemEvents(dom, item) {
        let hovering = false, dragging = false;
        dom.addEventListener('mouseenter', () => { hovering = true; if (!dragging) this.callback({ uiEvent: 'drawFromSave', args: { src: item } }); });
        dom.addEventListener('mouseleave', () => { if (!dragging) { hovering = false; this.callback({ uiEvent: 'refreshDraw', args: { src: item } }); } });
        dom.onclick = () => { if (item.type === 'folder') { this.currentPath.push(item.name); this.refresh(); } else { this.callback({ uiEvent: 'applyFromSave', args: { src: item } }); } };

        dom.addEventListener('dragstart', ev => {
            dragging = true; dom.classList.add('dragging');
            ev.dataTransfer.setData('text/plain', JSON.stringify({ fromPath: this.currentPath, name: item.name }));
            if (this.currentPath.length > 1) dom.ownerDocument.getElementById('up-drop')?.style?.setProperty('display', 'flex');
            if (!hovering) { hovering = true; this.callback({ uiEvent: 'drawFromSave', args: { src: item } }); }
        });

        dom.addEventListener('dragend', ev => {
            dragging = false; dom.classList.remove('dragging');
            this.view.root.getElementById('up-drop')?.style?.setProperty('display', 'none');
            const rect = dom.getBoundingClientRect();
            if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) {
                hovering = false; this.callback({ uiEvent: 'leave', args: { src: item } });
            }
        });

        dom.addEventListener('dragover', ev => ev.preventDefault());
        dom.addEventListener('drop', ev => { ev.preventDefault(); this._handleDrop(ev, item); });

        /* dom.oncontextmenu = ev => {
            ev.preventDefault(); const action = prompt('rename/delete/export?'); if (action === 'delete') { if (confirm('Delete?')) { this.onView.removeFile(this.currentPath, item); this._saveAll(); this.refresh(); } } if (action === 'rename') { const n = prompt('New name', item.name); if (n) { item.name = n; this._saveAll(); this.refresh(); } } if (action === 'export' && item.type === 'outfit') { try { const code = window.LZString ? LZString.compressToBase64(JSON.stringify(item.data)) : JSON.stringify(item.data); navigator.clipboard.writeText(code); alert('Copied'); } catch (e) { alert('Fail'); } }
        }; */

        dom.addEventListener('contextmenu', e => {
            e.preventDefault();
            this.view.showContextMenu(e.clientX, e.clientY, item);

        });
    }

    _handleDrop(ev, targetItem) {
        const data = ev.dataTransfer.getData('text/plain'); if (!data) return;
        let payload; try { payload = JSON.parse(data); } catch (e) { return; }
        const fromNode = this.onView.getNode(payload.fromPath);
        const idx = fromNode.children.findIndex(c => c.name === payload.name);
        if (idx === -1) return;
        const movingItem = fromNode.children.splice(idx, 1)[0];
        const destFolder = (targetItem && targetItem.type === 'folder') ? targetItem : this.onView.getNode(this.currentPath);
        destFolder.children.push(movingItem);
        this._saveAll(); this.refresh();
    }

    _saveAll() {
        const member = window.Player ? Player.MemberNumber : 'guest';
        const stripped = this.fs.stripThumbs(this.fs.getRoot());
        try { this.storage.saveLocal(member, stripped); } catch (e) { }
        try { this.storage.saveOnline(member, stripped); } catch (e) { }
    }

    refreshRenderMode() {
        this.view.setRenderMode(this.workMode);
    }

    renderAddress() { this.view.renderAddress(this.currentPath); }

    renderButtons() { this.view.renderButtons(); }

    renderFiles() {
        const node = this.onView.getNode(this.currentPath);
        const children = node.children || [];
        const list = this.applySearchAndSort(children);
        this.view.renderFiles(list, { viewMode: this.viewMode, attachItem: this._attachItemEvents.bind(this) });
    }

    refresh() { this.refreshRenderMode(); this.renderButtons(); this.renderAddress(); this.renderFiles(); }

    addFile(parentPath, file) {
        if (this.workMode === 'history') return null;
        const newFile = this.onView.addFile(parentPath, file);
        newFile.thumbCanvas = this.thumb.startFor(newFile);
        this._saveAll(); this.refresh();
        return newFile;
    }

    exportBackup() {
        const stripped = this.fs.stripThumbs(this.fs.getRoot());
        const dataStr = JSON.stringify(stripped, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'bcOutfitManager_backup.json'; document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    importBackup() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'application/json';
        input.onchange = e => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = evt => {
                try {
                    const uncompressed = this.storage.compressor ? this.storage.compressor.decompress(evt.target.result) : evt.target.result;
                    const json = JSON.parse(uncompressed);
                    const newRoot = { name: this.fs.getRoot().name, type: 'folder', children: [] };
                    FileSystem.mergeRoots(newRoot, json);
                    this.fs.fromJSON(newRoot);
                    this._initAllThumbs(this.fs.getRoot());
                    this._saveAll(); this.refresh();
                } catch (err) {
                    alert('Invalid backup file');
                }
            };
            reader.readAsText(file);
        }
        input.click();
    }

    addHistoryRecord(file) {
        if (this.workMode === 'history') return null;
        const newFile = this.historyRecord.addRecord(file);
        newFile.thumbCanvas = this.thumb.startFor(newFile);
        this._saveAll(); return newFile;
    }

    ToggleWorkMode(newMode = 'normal') {
        if (newMode !== 'normal' && newMode !== 'history') return;
        if (this.workMode === newMode) return;
        if (this.workMode === 'normal' && newMode === 'history') {
            // save current path
            this.onView = this.historyRecord.fs;
            this.currentPath = [this.onView.getRoot().name];
            this.workMode = 'history';
            this.refresh();
        } else if (this.workMode === 'history' && newMode === 'normal') {
            // restore to fs
            this.onView = this.fs;
            this.currentPath = [this.onView.getRoot().name];
            this.workMode = 'normal';
            this.refresh();
        }
    }

}