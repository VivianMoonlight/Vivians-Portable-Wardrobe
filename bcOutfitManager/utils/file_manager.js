export class FileManager {
  constructor(containerElement, _callback) {
    if (!containerElement) throw new Error("Container element required");
    this.container = containerElement;
    this.shadow = containerElement.attachShadow({ mode: 'open' });

    this.currentPath = ['Home'];
    this.viewMode = 'details';
    this.fsRoot = { name: 'Home', type: 'folder', children: [] };

    this.contextTarget = null;

    if (typeof _callback === "function") { this._callback = _callback; }
    else { console.error('Error Creating File System: _callback is not a function.'); }

    const REFRESH_INTERVAL = 60000;

    this._initDOM();
    this._setupEvents();
    this.restoreSave();
    this.refresh();
    setTimeout(() => {
      this._refreshThumbs(this.fsRoot);
    }, 3000);
    this.startThumbAutoRefresh(REFRESH_INTERVAL);
  }

  callback(...args) {
    return this._callback(...args);
  }

  // ================== DOM 初始化 ==================
  _initDOM() {
    const style = document.createElement('style');
    style.textContent = `
      .file-manager { height: 100%; flex:1; display:flex; flex-direction:column; overflow:hidden; font-size:13px; border-radius: 6px;border: 1px solid #ccc;}
      .fm-search { display:flex; gap:4px; align-items:center; padding:4px 6px; border-bottom:1px solid #ddd; }
      .fm-search input { flex:1; padding:4px 6px; border:1px solid #ccc; border-radius:4px; font-size:12px; }
      .fm-path { display:flex; align-items:center; gap:4px; padding:4px 6px; overflow-x:auto; border-bottom:1px solid #ddd; }
      .fm-address-node { padding:2px 6px; border:1px solid #ccc; border-radius:4px; cursor:pointer; white-space:nowrap; }
      .fm-controls { display:flex; align-items:center; gap:6px; padding:4px 6px; border-bottom:1px solid #ddd; }
      .btn { padding:4px 6px; border-radius:4px; border:1px solid #ccc; background:#fff; cursor:pointer; font-size:12px; }
      .btn:active { transform:translateY(1px); }
      .fm-body { flex:1; display:flex; flex-direction:column; overflow:hidden; padding:2px; }
      .up-drop-zone { height:36px; margin-bottom:4px; border:2px dashed #aaa; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:12px; color:#555; display:none; }
      .fm-files { flex:1; overflow:auto; position:relative; padding:4px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 8px; }
      .grid-item { border: 1px solid #ddd; border-radius: 4px; padding: 4px; text-align: center; background: #fff; cursor: pointer; display: flex; flex-direction: column; justify-content: flex-start; align-items: center; gap: 4px; width: 80px; height: 200px; }
      .grid-item.dragging { opacity: 0.5; }
      .details { width:100%; border-collapse:collapse; font-size:12px; }
      .details th, .details td { padding:4px 6px; border-bottom:1px solid #eee; text-align:left; }
      .details tr:hover { background:#fbfbfb; }
      .fm-context-menu { position:fixed; background:#fff; border:1px solid #888; border-radius:6px; padding:4px 0; display:none; z-index:99999; box-shadow:0 4px 12px rgba(0,0,0,0.2); font-size:12px; }
      .fm-context-item { padding:6px 10px; cursor:pointer; }
      .fm-context-item:hover { background:#f0f0f0; }
      .status-bar { height:24px; padding:2px 6px; border-top:1px solid #eee; background:#fafafa; display:flex; align-items:center; justify-content:flex-start; font-size:11px; }
    `;
    this.shadow.appendChild(style);

    // DOM 结构
    this.shadow.innerHTML += `
      <div class="file-manager">
        <div class="fm-search" id="fm-search-bar">
          <input id="search-input" placeholder="Search files..." />
        </div>
        <div class="fm-path" id="fm-address"></div>
        <div class="fm-controls">
          <button id="up-btn" class="btn">←</button>
          <button id="newfolder-btn" class="btn">📁+</button>
          <select id="sort-select" class="btn">
            <option value="name-asc">Name ↑</option>
            <option value="name-desc">Name ↓</option>
            <option value="type">Type</option>
          </select>
          <button id="view-toggle" class="btn">Details View</button>
        </div>
        <div class="fm-body">
          <div class="up-drop-zone" id="up-drop">Drop here to move up</div>
          <div class="fm-files" id="fm-files"></div>
        </div>
        <div id="fm-menu" class="fm-context-menu"></div>
        <div class="status-bar" id="status-bar">0 items</div>
      </div>
    `;

    this.addrDiv = this.shadow.getElementById('fm-address');
    this.filesDiv = this.shadow.getElementById('fm-files');
    this.upDrop = this.shadow.getElementById('up-drop');
    this.menu = this.shadow.getElementById('fm-menu');
    this.searchInput = this.shadow.getElementById('search-input');
    this.sortSelect = this.shadow.getElementById('sort-select');
    this.viewToggle = this.shadow.getElementById('view-toggle');
    this.upBtn = this.shadow.getElementById('up-btn');
    this.newFolderButton = this.shadow.getElementById('newfolder-btn');
  }

  // ================== 事件绑定 ==================
  _setupEvents() {
    document.addEventListener('click', () => this.menu.style.display = 'none');
    this.menu.addEventListener("click", (e) => {
      const action = e.target.dataset.action;
      if (!action) return;
      const folder = this.getNode(this.currentPath);
      if (action === "delete") {
        const ok = confirm(`Are you sure you want to delete "${this.contextTarget.name}"?`);
        if (ok) { this.removeFile(this.currentPath, this.contextTarget); }
      }
      if (action === "rename") {
        const name = prompt("New name", this.contextTarget.name);
        if (name) this.contextTarget.name = name;
      }
      if (action === "export" && this.contextTarget.type === "outfit") {
        const code = LZString.compressToBase64(JSON.stringify(this.contextTarget.data));
        navigator.clipboard.writeText(code)
          .then(() => alert("Current outfit code copied to clipboard"))
          .catch(() => alert("Failed to copy outfit code"));
      }
      this.menu.style.display = "none";
      this.refresh();
    });

    this.upBtn.addEventListener('click', () => { if (this.currentPath.length > 1) { this.currentPath.pop(); this.refresh(); } });
    this.newFolderButton.addEventListener('click', () => {
      const folderName = prompt('New folder name', 'New Folder');
      if (!folderName) return;
      const currentNode = this.getNode(this.currentPath);
      const newFolder = { name: folderName, type: 'folder', children: [] };
      currentNode.children.push(newFolder);
      this._initThumb(newFolder);
      this.refresh();
    });
    this.searchInput.addEventListener('input', () => this.refresh());
    this.sortSelect.addEventListener('change', () => this.refresh());
    this.viewToggle.addEventListener('click', () => {
      this.viewMode = (this.viewMode === 'details') ? 'grid' : 'details';
      this.viewToggle.textContent = this.viewMode === 'details' ? 'Details View' : 'Grid View';
      this.refresh();
    });
    this.upDrop.addEventListener('dragover', ev => { ev.preventDefault(); });
    this.upDrop.addEventListener('drop', ev => {
      ev.preventDefault();
      const data = ev.dataTransfer.getData('text/plain'); if (!data) return;
      let payload; try { payload = JSON.parse(data); } catch (e) { return; }
      if (this.currentPath.length > 1) {
        const fromNode = this.getNode(payload.fromPath);
        const idx = fromNode.children.findIndex(c => c.name === payload.name); if (idx === -1) return;
        const item = fromNode.children.splice(idx, 1)[0];
        const parentNode = this.getNode(this.currentPath.slice(0, -1));
        parentNode.children.push(item);
        this.refresh();
      }
    });

  }

  // ================== 缩略图生成 ==================
  _initThumb(item) {
    if (item.thumbCanvas) return item.thumbCanvas;

    // 1️⃣ 立即创建 canvas 并赋值
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    item.thumbCanvas = canvas; // ✅ 立即可用

    // 2️⃣ 绘制 folder 或异步绘制内容
    if (item.type === "folder") {
      ctx.font = "40px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("📁", canvas.width / 2, canvas.height / 2);
    } else {
      // 异步绘制，不阻塞 canvas 赋值
      setTimeout(() => {
        this.callback({ uiEvent: 'drawThumb', args: { data: item.data, ctx } });
      }, 0);
    }

    return canvas;
  }

  _initAllThumbs(node) {
    if (!node.children) return;
    node.children.forEach(child => {
      this._initThumb(child);
      if (child.type === "folder") this._initAllThumbs(child);
    });
  }

  startThumbAutoRefresh(interval = 1000) {
    if (this._thumbRefreshTimer) clearInterval(this._thumbRefreshTimer);

    this._thumbRefreshTimer = setInterval(() => {
      this._refreshThumbs(this.fsRoot);
    }, interval);
  }

  // 停止缩略图自动刷新
  stopThumbAutoRefresh() {
    if (this._thumbRefreshTimer) clearInterval(this._thumbRefreshTimer);
    this._thumbRefreshTimer = null;
  }

  // 遍历节点，重新绘制已有 canvas
  _refreshThumbs(node) {
    if (!node) return;
    if (node.thumbCanvas && node.type !== "folder") {
      const ctx = node.thumbCanvas.getContext("2d");
      ctx.clearRect(0, 0, node.thumbCanvas.width, node.thumbCanvas.height);
      this.callback({ uiEvent: 'drawThumb', args: { data: node.data, ctx } });
    }
    if (node.children) node.children.forEach(child => this._refreshThumbs(child));
  }

  // ================== 文件系统操作 ==================
  getNode(path) {
    let node = this.fsRoot;
    for (let i = 1; i < path.length; i++) { node = node.children.find(c => c.name === path[i]); }
    return node;
  }

  applySearchAndSort(list) {
    const q = this.searchInput.value.trim().toLowerCase();
    let out = list.slice();
    if (q) {
      const filtered = [];
      function recursiveFilter(node) {
        if (node.name.toLowerCase().includes(q)) filtered.push(node);
        if (node.type === 'folder' && node.children) node.children.forEach(recursiveFilter);
      }
      list.forEach(recursiveFilter);
      out = filtered;
    }
    const sort = this.sortSelect.value;
    if (sort === 'name-asc') out.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'name-desc') out.sort((a, b) => b.name.localeCompare(a.name));
    if (sort === 'type') out.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    return out;
  }

  renderAddress() {
    this.addrDiv.innerHTML = '';
    this.currentPath.forEach((part, idx) => {
      const el = document.createElement('span');
      el.className = 'fm-address-node'; el.textContent = part;
      el.onclick = () => { this.currentPath = this.currentPath.slice(0, idx + 1); this.refresh(); };
      this.addrDiv.appendChild(el);
      if (idx < this.currentPath.length - 1) { const s = document.createElement('span'); s.textContent = '>'; this.addrDiv.appendChild(s); }
    });
  }

  truncateName(folderName, maxLength) {
    if (folderName.length <= maxLength) return folderName;
    return folderName.substring(0, maxLength - 3) + "...";
  }

  attachItemEvents(dom, item) {
    let hovering = false;
    let dragging = false;

    dom.addEventListener("mouseenter", () => {
      hovering = true;
      if (!dragging) this.callback({ uiEvent: "drawFromSave", args: { src: item } });
    });

    dom.addEventListener("mouseleave", () => {
      if (!dragging) {
        hovering = false;
        this.callback({ uiEvent: "leave", args: { src: item } });
      }
    });

    dom.onclick = () => {
      if (item.type === "folder") {
        this.currentPath.push(item.name);
        this.refresh();
      } else {
        this.callback({ uiEvent: "applyFromSave", args: { src: item } });
      }
    };

    dom.addEventListener("dragstart", ev => {
      dragging = true;
      dom.classList.add("dragging");
      ev.dataTransfer.setData("text/plain", JSON.stringify({ fromPath: this.currentPath, name: item.name }));
      if (this.currentPath.length > 1) this.upDrop.style.display = "flex";
      if (!hovering) {
        hovering = true;
        this.callback({ uiEvent: "drawFromSave", args: { src: item } });
      }
    });

    dom.addEventListener("dragend", ev => {
      dragging = false;
      dom.classList.remove("dragging");
      this.upDrop.style.display = "none";
      const rect = dom.getBoundingClientRect();
      if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) {
        hovering = false;
        this.callback({ uiEvent: "leave", args: { src: item } });
      }
    });

    dom.addEventListener("dragover", ev => ev.preventDefault());
    dom.addEventListener("drop", ev => { ev.preventDefault(); this.handleDrop(ev, item); });

    dom.oncontextmenu = ev => {
      ev.preventDefault();
      this.showContextMenu(ev.clientX, ev.clientY, item);
    };
  }

  // ================== 渲染文件 ==================
  renderFiles() {
    const node = this.getNode(this.currentPath);
    const children = node.children || [];
    const list = this.applySearchAndSort(children);
    this.filesDiv.innerHTML = '';
    this.shadow.getElementById('status-bar').textContent = `${list.length} items`;

    // GRID MODE
    if (this.viewMode === "grid") {
      const grid = document.createElement("div");
      grid.className = "grid";

      list.forEach(item => {
        const it = document.createElement("div");
        it.className = "grid-item";
        it.draggable = true;
        it.innerHTML = "";
        it.appendChild(item.thumbCanvas);

        const label = document.createElement("div");
        label.textContent = this.truncateName(item.name, 15);
        it.appendChild(label);

        this.attachItemEvents(it, item);
        grid.appendChild(it);
      });

      this.filesDiv.appendChild(grid);
      return;
    }

    // TABLE MODE
    const table = document.createElement("table");
    table.className = "details";
    table.innerHTML = `<thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th></tr></thead>`;
    const tbody = document.createElement("tbody");

    list.forEach(item => {
      const tr = document.createElement("tr");
      tr.draggable = true;
      tr.innerHTML = `
        <td>${this.truncateName(item.name, 15)}</td>
        <td>${item.type}</td>
        <td>${item.size || "-"}</td>
        <td>${item.mtime ? new Date(item.mtime).toLocaleString() : "-"}</td>
      `;
      this.attachItemEvents(tr, item);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    this.filesDiv.appendChild(table);
  }

  handleDrop(ev, targetItem) {
    const data = ev.dataTransfer.getData('text/plain');
    if (!data) return;
    let payload;
    try { payload = JSON.parse(data); } catch (e) { return; }

    const fromNode = this.getNode(payload.fromPath);
    const idx = fromNode.children.findIndex(c => c.name === payload.name);
    if (idx === -1) return;

    const movingItem = fromNode.children.splice(idx, 1)[0];
    let destFolder = (targetItem && targetItem.type === 'folder') ? targetItem : this.getNode(this.currentPath);

    if (movingItem.type === 'folder') {
      let pathCheck = [destFolder];
      while (pathCheck.length) {
        const node = pathCheck.pop();
        if (node === movingItem) {
          fromNode.children.splice(idx, 0, movingItem);
          return;
        }
        if (node.children) pathCheck.push(...node.children.filter(c => c.type === 'folder'));
      }
    }

    destFolder.children.push(movingItem);
    this.refresh();
  }

  showContextMenu(x, y, item) {
    const menu = this.menu;
    this.contextTarget = item;
    menu.innerHTML = "";
    if (item.type === "folder") {
      menu.innerHTML = `<div class="fm-context-item" data-action="delete">Delete</div>
                        <div class="fm-context-item" data-action="rename">Rename</div>`;
    } else if (item.type === "outfit") {
      menu.innerHTML = `<div class="fm-context-item" data-action="delete">Delete</div>
                        <div class="fm-context-item" data-action="rename">Rename</div>
                        <div class="fm-context-item" data-action="export">Export</div>`;
    }
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.style.display = "block";
  }

  removeFile(path, node) {
    const parent = this.getNode(path);
    const idx = parent.children.findIndex(c => c === node);
    if (idx !== -1) {
      parent.children.splice(idx, 1);
      this.saveAll();
      this.refresh();
    }
  }

  filterForOnline(node) {
    if (node.type === 'folder') {
      const filteredChildren = node.children
        .map(child => this.filterForOnline(child))
        .filter(child => child !== null);
      return { ...node, children: filteredChildren };
    } else {
      if (node.SaveLocal === true) return null;
      return { ...node };
    }
  }

  stripThumbCanvas(node) {
    const { thumbCanvas, ...copy } = node; // 去掉 thumbCanvas
    if (copy.type === "folder" && copy.children) {
      copy.children = copy.children.map(child => this.stripThumbCanvas(child));
    }
    return copy;
  }

  saveAll() { this.saveToOnlineStorage(); this.saveToLocalStorage(); }

  saveToOnlineStorage() {
    const filtered = this.filterForOnline(this.stripThumbCanvas(this.fsRoot));
    Player.ExtensionSettings.VPWardrobe = LZString.compressToBase64(JSON.stringify(filtered));
    ServerPlayerExtensionSettingsSync("VPWardrobe");
  }

  saveToLocalStorage() {
    const memberNumber = Player.MemberNumber;
    const STORAGE_PREFIX = 'VPWardrobe';
    localStorage.setItem(`${STORAGE_PREFIX}${memberNumber}`, LZString.compressToBase64(JSON.stringify(this.stripThumbCanvas(this.fsRoot))));
  }

  exportBackup() {
    const dataStr = LZString.compressToBase64(JSON.stringify(this.stripThumbCanvas(this.fsRoot)));
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `VPWardrobe_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  async importBackup() {
    const file =  await new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";

    input.onchange = () => {
      const file = input.files[0];
      if (!file) return resolve(null);

      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = err => reject(err);
      reader.readAsText(file);
    };

    input.click();
  });
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const dataStr = e.target.result;
        const json = this.stripThumbCanvas(JSON.parse(LZString.decompressFromBase64(dataStr)));
        this.fsRoot = json;
        this.currentPath = [this.fsRoot.name];
        this._initAllThumbs(this.fsRoot);
        this.refresh();
        alert("Backup loaded successfully!");
      } catch (err) {
        console.error("Failed to load backup:", err);
        alert("Failed to load backup file.");
      }
    };
    reader.readAsText(file);
  }


  async restoreSave(homeName = 'Home') {
    const mergedRoot = { name: homeName, type: 'folder', children: [] };
    const memberNumber = Player.MemberNumber;
    const STORAGE_PREFIX = 'VPWardrobe';
    const onlineData = await new Promise(resolve => {
      const check = () => {
        if (Player.ExtensionSettings) resolve(Player.ExtensionSettings.VPWardrobe);
        else setTimeout(check, 50);
      };
      check();
    });
    const homeOnline = this.stripThumbCanvas((onlineData) ? JSON.parse(LZString.decompressFromBase64(onlineData)) : null);
    const homeLocal = this.stripThumbCanvas(JSON.parse(LZString.decompressFromBase64(localStorage.getItem(`${STORAGE_PREFIX}${memberNumber}`))));

    const mergeFolders = (target, source) => {
      if (!source?.children) return;
      source.children.forEach(child => {
        if (child.type === 'folder') {
          let existingFolder = target.children.find(f => f.type === 'folder' && f.name === child.name);
          if (!existingFolder) {
            existingFolder = { name: child.name, type: 'folder', children: [] };
            target.children.push(existingFolder);
          }
          mergeFolders(existingFolder, child);
        } else {
          const exists = target.children.find(f => JSON.stringify(f) === JSON.stringify(child));
          if (!exists) target.children.push(child);
        }
      });
    };

    mergeFolders(mergedRoot, homeOnline);
    mergeFolders(mergedRoot, homeLocal);

    this.fsRoot = mergedRoot;
    this.currentPath = [homeName];

    this._initAllThumbs(this.fsRoot); // ✅ 生成所有缩略图一次
    this.refresh();
  }

  refresh() { this.renderAddress(); this.renderFiles(); }

  // ==== 公共接口 ====
  addFile(parentPath, file) {
    const node = this.getNode(parentPath);
    if (node && node.type === 'folder') {
      node.children.push(file);
      this._initThumb(file);
      this.saveAll();
      this.refresh();
    }
  }

  getCurrentFolder() { return this.getNode(this.currentPath); }
  getFsRoot() { return this.fsRoot; }
  setCurrentPath(path) { this.currentPath = path.slice(); this.refresh(); }
  getCurrentPath() { return this.currentPath.slice(); }
}
