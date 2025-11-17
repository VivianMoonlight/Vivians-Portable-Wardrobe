


export class FileManagerView {
  constructor(container, { onEvent = () => {} } = {}) {
    if (!container) throw new Error("Container required");
    this.container = container;
    this.onEvent = onEvent;
    this.RenderMode = "normal";
    this.viewMode = "details";

    this._initDOM();
    this._createContextMenu();
    this._bindUI();
  }

  _initDOM() {
    if (!this.container.shadowRoot) this.root = this.container.attachShadow({ mode: "open" });
    else this.root = this.container.shadowRoot;

    // 省略 CSS
    const style = document.createElement("style");
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
      .fm-context-menu { position:absolute; background:#fff; border:1px solid #888; border-radius:6px; padding:4px 0; display:none; z-index:99999; box-shadow:0 4px 12px rgba(0,0,0,0.2); font-size:12px; }
      .fm-context-item { padding:6px 10px; cursor:pointer; }
      .fm-context-item:hover { background:#f0f0f0; }
      .status-bar { height:24px; padding:2px 6px; border-top:1px solid #eee; background:#fafafa; display:flex; align-items:center; justify-content:flex-start; font-size:11px; }
    `;
    this.root.appendChild(style);

    this.root.innerHTML += `
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
        <div class="status-bar" id="status-bar">0 items</div>
        <div class="fm-context-menu" id="fm-context-menu"></div>
      </div>
    `;

    this.filesDiv = this.root.getElementById("fm-files");
    this.addressDiv = this.root.getElementById("fm-address");
    this.statusDiv = this.root.getElementById("status-bar");
    this.upBtn = this.root.getElementById("up-btn");
    this.newFolderBtn = this.root.getElementById("newfolder-btn");
    this.searchInput = this.root.getElementById("search-input");
    this.sortSelect = this.root.getElementById("sort-select");
    this.viewToggle = this.root.getElementById("view-toggle");
  }

  _createContextMenu() {
    this.menu = this.root.getElementById("fm-context-menu");
/*     this.menu.className = "fm-context-menu";
    this.menu.style.position = "absolute";
    this.menu.style.display = "none";
    this.menu.style.zIndex = "9999"; */
    this.root.appendChild(this.menu);

    this.menu.addEventListener("click", (e) => {
      const action = e.target.getAttribute("data-action");
      if (action) this._emit(`contextMenu:${action}`, this.contextTarget);
      this.menu.style.display = "none";
    });

    // 点击 Shadow 内其他位置关闭菜单
    this.root.addEventListener("click", () => {
      this.menu.style.display = "none";
    });
  }

  _bindUI() {
    document.addEventListener("click", () => this._emit("globalClick"));
    this.upBtn.addEventListener("click", () => this._emit("up"));
    this.newFolderBtn.addEventListener("click", () => this._emit("newFolder"));
    this.searchInput.addEventListener("input", () => this._emit("search"));
    this.sortSelect.addEventListener("change", () => this._emit("sort"));
    this.viewToggle.addEventListener("click", () => this._emit("toggleView"));
  }

  _emit(name, payload) {
    this.onEvent({ type: name, payload });
  }

  setRenderMode(mode) {
    this.RenderMode = mode;
    if (mode === "history") {
      this.upBtn.style.display = "none";
      this.newFolderBtn.style.display = "none";
    } else {
      this.upBtn.style.display = "inline-block";
      this.newFolderBtn.style.display = "inline-block";
    }
  }

  renderButtons() {
    this.viewToggle.textContent = this.viewMode === "grid" ? "Details View" : "Grid View";
  }

  renderAddress(path) {
    this.addressDiv.innerHTML = "";
    path.forEach((p, i) => {
      const span = document.createElement("span");
      span.textContent = p;
      span.style.padding = "2px 6px";
      span.style.cursor = "pointer";
      span.addEventListener("click", () => this._emit("addressClick", i));
      this.addressDiv.appendChild(span);
      if (i < path.length - 1) {
        this.addressDiv.appendChild(Object.assign(document.createElement("span"), { textContent: " > " }));
      }
    });
  }

  showContextMenu(clientX, clientY, item) {
    this.contextTarget = item;
    const menu = this.menu;

    const hostRect = this.root.host.getBoundingClientRect();
    let localX = clientX - hostRect.left;
    let localY = clientY - hostRect.top;

    // 填充菜单内容
    menu.innerHTML = "";
    if (item.type === "folder") {
      menu.innerHTML = `
        <div class="fm-context-item" data-action="delete">Delete</div>
        <div class="fm-context-item" data-action="rename">Rename</div>`;
    } else if (item.type === "outfit") {
      menu.innerHTML = `
        <div class="fm-context-item" data-action="delete">Delete</div>
        <div class="fm-context-item" data-action="rename">Rename</div>
        <div class="fm-context-item" data-action="export">Export</div>`;
    }

    // 菜单自动调整，保证不超出 shadow host 边界
    const menuRect = menu.getBoundingClientRect();
    const hostWidth = hostRect.width;
    const hostHeight = hostRect.height;

    if (localX + menuRect.width > hostWidth) localX = hostWidth - menuRect.width;
    if (localY + menuRect.height > hostHeight) localY = hostHeight - menuRect.height;
    if (localX < 0) localX = 0;
    if (localY < 0) localY = 0;

    menu.style.left = localX + "px";
    menu.style.top = localY + "px";
    menu.style.display = "block";
  }

  clearFiles() {
    this.filesDiv.innerHTML = "";
  }

  truncateName(name = "", maxLength = 15) {
    return name.length <= maxLength ? name : name.slice(0, maxLength - 3) + "...";
  }

  renderFiles(list, { viewMode = "details", attachItem = () => {} } = {}) {
    this.clearFiles();
    this.statusDiv.textContent = `${list.length} items`;
    this.viewMode = viewMode;

    if (viewMode === "grid") {
      const grid = document.createElement("div");
      grid.className = "grid";
      list.forEach((item) => {
        const el = document.createElement("div");
        el.className = "grid-item";
        el.draggable = true;
        if (item.thumbCanvas) el.appendChild(item.thumbCanvas);
        const label = document.createElement("div");
        label.textContent = this.truncateName(item.name);
        el.appendChild(label);
        attachItem(el, item);

        // 右键菜单事件
        el.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.showContextMenu(e.clientX, e.clientY, item);
        });

        grid.appendChild(el);
      });
      this.filesDiv.appendChild(grid);
      return;
    }

    const table = document.createElement("table");
    table.className = "details";
    table.innerHTML = `<thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    list.forEach((item) => {
      const tr = document.createElement("tr");
      tr.draggable = true;
      tr.innerHTML = `<td>${this.truncateName(item.name)}</td><td>${item.type}</td><td>${item.size || "-"}</td><td>${
        item.mtime ? new Date(item.mtime).toLocaleString() : "-"
      }</td>`;
      attachItem(tr, item);

      tr.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, item);
      });

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    this.filesDiv.appendChild(table);
  }
}
