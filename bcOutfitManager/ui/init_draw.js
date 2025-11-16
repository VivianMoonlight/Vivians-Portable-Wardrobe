const { getOutfitData, createDisplayCharacter, loadOutfitOnCharacter } = await import(`../utils/drawer.js?${Date.now()}`);
const { FileManager } = await import(`../utils/file_manager.js?${Date.now()}`);
const { FilterManager } = await import(`./filter_manager.js?${Date.now()}`);


export class UIManager {
    constructor() {
        this.fileManager = null;
        this.filterManager = null;
        this.isOpen = false;
        this.targetCharacter = null;
    }




    hookDrawCharacter(modApi) {
        modApi.hookFunction("DrawCharacter", 4, (args, next) => {
            const [C] = args;

            // If we're in outfit manager and this is our displayChar, make it act like a player character
            if (C.CharacterID === "displayCharacter") {  // We set ID to -1 for our displayChar
                const originalIsPlayer = C.IsPlayer;
                C.IsPlayer = () => true;  // Temporarily make it act like a player character
                const result = next(args);
                C.IsPlayer = originalIsPlayer;  // Restore original IsPlayer
                return result;
            }

            return next(args);
        });

        modApi.hookFunction("ValidationResolveAppearanceDiff", 4, (args, next) => {
            const [groupName, previousItem, newItem, params] = args;
            const C = params.C;
            // If we're in outfit manager and this is our displayChar, make it act like a player character
            if (C.CharacterID === "displayCharacter") {  // We set ID to -1 for our displayCharr
                return { item: newItem, valid: true };
            }

            return next(args);
        });
    }

    // Replace or add this function in your codebase:
    async drawOutfitMenu() {
        // Ensure single instance per UIManager
        if (!this._floatingOutfitWidget) {
            this._floatingOutfitWidget = await createFloatingOutfitWidget(this);
        }
        if (this.isOpen) {
            this._floatingOutfitWidget.open();
            this.drawPreview({ src: { data: [], blockSet: this.filterManager.getFullSet() } }, 0, 0, 1, true);
            // update the widget's state and re-render
            this._floatingOutfitWidget.update();
        }
    };


    saveCurrentOutfit() {
        const outfitname = prompt("Outfit name", "New Outfit");
        const outfitData = getOutfitData(this.targetCharacter);

        this.fileManager.addFile(this.fileManager.currentPath, { name: outfitname, type: 'outfit', data: outfitData });
    };

    ImportOutfitFromBCX(code) {
        const outfitname = prompt("Outfit name", "New Outfit");
        const outfitData = JSON.parse(LZString.decompressFromBase64(code.trim()));
        this.fileManager.addFile(this.fileManager.currentPath, { name: outfitname, type: 'outfit', data: outfitData });
    };

    callback({ uiEvent = '', args = {} } = {}) {
        if (!uiEvent) { return }
        else if (uiEvent === 'drawFromSave') { this.drawPreview(args); }
        else if (uiEvent === 'applyFromSave') { this.applyToCurrentCharacter(args); }
        else if (uiEvent === 'drawThumb') { this.drawPreviewOnCanvas(args); }
    }


    drawPreview({ src = {} } = {}) {
        if (!src.data) { return }
        const displayCharacter = createDisplayCharacter(this.targetCharacter);
        const blockSet = (src.blockSet) ? (src.blockSet) : this.filterManager.getActiveSet(true);
        loadOutfitOnCharacter(displayCharacter, src.data, blockSet);
        this._floatingOutfitWidget.drawOnDisplayCanvas(displayCharacter, 0, 0, 1, true);
        this._floatingOutfitWidget.update();
        CharacterDelete(displayCharacter);
    }

    drawPreviewOnCanvas({ data = {}, ctx = {} } = {}) {
        if (!data) { return }
        if (!ctx) { return }
        const displayCharacter = createDisplayCharacter(this.targetCharacter);
        loadOutfitOnCharacter(displayCharacter, data, new Set());
        CharacterRefresh(displayCharacter);
        DrawCharacter(displayCharacter, 0, 0, 0.16, true, ctx);
        CharacterDelete(displayCharacter);
    }

    applyToCurrentCharacter({ src = {} } = {}) {
        if (!src.data) { return }
        if (!this.targetCharacter) { return }
        const replaceSet = this.filterManager.getActiveSet(true);
        loadOutfitOnCharacter(this.targetCharacter, src.data, replaceSet);
        CharacterRefresh(this.targetCharacter);
        try {
            ChatRoomCharacterUpdate(this.targetCharacter);
        }
        finally { }
    }

    createMainButton() {
        const manager = this;
        manager.targetCharacter = CurrentCharacter || Player;
        let hasPermission = true;

        // Avoid duplicate buttons
        const oldButton = document.getElementById("OutfitManagerFloatBtn");
        if (oldButton) oldButton.remove();

        // --- Create floating button ---
        const btn = document.createElement("div");
        btn.id = "OutfitManagerFloatBtn";

        btn.style.position = "fixed";
        btn.style.left = "2vw";
        btn.style.bottom = "12vh";
        btn.style.width = "60px";
        btn.style.height = "60px";
        btn.style.borderRadius = "50%";
        btn.style.background = hasPermission ? "#ffffffcc" : "#ffb6c1cc";
        btn.style.backdropFilter = "blur(6px)";
        btn.style.display = "flex";
        btn.style.alignItems = "center";
        btn.style.justifyContent = "center";
        btn.style.cursor = "pointer";
        btn.style.zIndex = "5000";
        btn.style.boxShadow = "0 4px 10px rgba(0,0,0,0.2)";
        btn.style.transition = "background 0.2s, transform 0.2s";

        // --- Icon ---
        const img = document.createElement("img");
        img.src = new URL("./image.png", import.meta.url).href;   // 你原本的图标
        img.style.width = "75%";
        img.style.height = "75%";
        img.style.pointerEvents = "none";
        btn.appendChild(img);

        // --- Hover effect ---
        btn.addEventListener("mouseenter", () => {
            manager.targetCharacter = (CurrentCharacter) ? CurrentCharacter : Player;
            hasPermission =
                manager.targetCharacter.MemberNumber === Player.MemberNumber ||
                manager.targetCharacter.AllowItem;
            btn.style.background = hasPermission ? "#ccffff" : "#ffb6c1";
            btn.style.transform = "scale(1.07)";
        });
        btn.addEventListener("mouseleave", () => {
            manager.targetCharacter = (CurrentCharacter) ? CurrentCharacter : Player;
            hasPermission =
                manager.targetCharacter.MemberNumber === Player.MemberNumber ||
                manager.targetCharacter.AllowItem;
            btn.style.background = hasPermission ? "#ffffffcc" : "#ffb6c1cc";
            btn.style.transform = "scale(1.0)";
        });

        // --- Click behavior ---
        btn.addEventListener("click", () => {
            manager.targetCharacter = (CurrentCharacter) ? CurrentCharacter : Player;
            hasPermission =
                manager.targetCharacter.MemberNumber === Player.MemberNumber ||
                manager.targetCharacter.AllowItem;
            if (!hasPermission) {
                ShowOutfitNotification("You don’t have permission to interact with this player");
                return;
            }
            manager.isOpen = true;
            manager.drawOutfitMenu();
        });

        document.body.appendChild(btn);
    }
}





// Factory that creates the shadow-DOM floating widget and returns controller
async function createFloatingOutfitWidget(uiManager) {
    // configuration / fallbacks
    const OUTFITS_PER_PAGE = window.OUTFITS_PER_PAGE || 6;
    const VERSION_NUMBER = window.VERSION_NUMBER || "1.0";
    const canvasColor = "#adb5bdff";

    // host & shadow
    const host = document.createElement("div");
    host.id = "bco-outfit-widget-host";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    // styles (isolated)
    const style = document.createElement("style");
    style.textContent = `
    :host { all: initial; }
    .widget {
    position: fixed;
    top: 80px;
    left: 80px;
    width: 820px;
    height: 760px;
    background: rgba(255,255,255,0.95);
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.45);
    font-family: Arial, sans-serif;
    color: #111;
    z-index: 2147483647;
    display:flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
    }
    .header {
    height: 44px;
    background: linear-gradient(180deg,#f3f3f3,#e9e9e9);
    padding: 6px 10px;
    display:flex;
    align-items:center;
    justify-content: space-between;
    cursor: move;
    gap:8px;
    }
    .title { font-weight: 700; font-size: 15px; }
    .controls { display:flex; gap:6px; align-items:center; }
    .controls input[type="text"]{ width:300px; height:28px; padding:4px 8px; font-size:13px; }
    .controls button{ height:30px; padding:0 8px; cursor:pointer; }

    .body {
    display: flex;
    flex: 1 1 auto;
    gap: 10px;
    padding: 10px;
    box-sizing: border-box;
    max-height: 100%; /* widget height - header - footer */
    overflow: hidden; /* 避免内部内容撑开 */
    }

    .left { width: 360px; display:flex; flex-direction: column; gap:10px; }

    .preview {
    flex: 1;
    min-height: 200px; /* 保底高度 */
    max-height: calc(100%); /* 避免挤掉按钮区域 */
    
    }

    .preview img { max-width:100%; max-height:100%; object-fit:contain; }
    .preview canvas {
    width: 100%;
    height: 100%;
    display: block;
    border-radius: 6px;
    object-fit: contain;
    background: #adb5bdff;
    border: 2px solid #646464ff;
    }

    .center { width: 300px; flex:1; display:flex; height: 100%; flex-direction: column; gap:8px; }

    .file-manager {
    flex:1;
    height: 100%;
    }


    .right { width: 180px; display:flex; flex-direction: column; gap:8px; }

    .filter-manager {
    flex:1;
    height: 100%;
    }

    .footer { 
    height:40px; 
    display:flex; 
    align-items:center; 
    justify-content:flex-end; 
    padding:8px 12px; 
    background:transparent;
    border-top:1px solid #eee;
    }

    .version { color:#777; font-size:12px; }
    .hidden { display:none !important; }

    .icon-btn { width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center; border-radius:6px; border:1px solid #ddd; background:#fff; }

    #save-new {
    padding: 6px 10px;
    font-size: 13px;
    border-radius: 6px;
    background: #ffffffff;
    border: 1px solid #ccc;
    cursor: pointer;
    }

    #save-new:hover {
    background: #e8e8e8;
    }

    /* Import 按钮样式 */
    #import {
    width: 120px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: 1px solid #ccc;
    background: #ffffffff;
    cursor: pointer;
    }

    #import:hover {
    background: #e8e8e8;
    }

  `;

    // structure
    const wrapper = document.createElement("div");
    wrapper.className = "widget";
    wrapper.innerHTML = `
        <div class="header">
    <div style="display:flex;align-items:center;gap:10px">
        <div class="title">${CharacterNickname ? (CharacterNickname(Player) + "'s Portable Wardrobe") : "Portable Wardrobe"}</div>
        <div class="version">v${VERSION_NUMBER}</div>
    </div>
    <div class="controls">
        <button id="import-backup-btn" class="btn" title="Load Backup">📂</button>
        <button id="export-backup-btn" class="btn" title="Save Backup">💾</button>
        <button id="close-btn" title="Close">✕</button>
    </div>
    </div>

    <div class="body">
    <div class="left">
        <div class="preview" id="preview-area">
        <canvas id="preview-canvas" width="500" height="1000"></canvas>
        </div>

        <div style="display:flex;gap:6px;justify-content:space-between;">
            <button id="save-new" style="flex:1">Save New Outfit</button>
            <button id="import" class="icon-btn" title="Import">Import</button>
        </div>
    </div>

    <div class="center">
        <div class="file-manager" id="file-manager-area"></div>

        <!-- removed pagination -->
    </div>

    <div class="right">

         <div class="filter-manager" id="filter-manager-area"></div>

         <!-- removed pagination -->

    </div>
    </div>

    <div class="version"></div>
    </div>
  `;

    shadow.appendChild(style);
    shadow.appendChild(wrapper);

    // elements
    const closeBtn = shadow.getElementById("close-btn");
    const saveNewBtn = shadow.getElementById("save-new");
    const importBtn = shadow.getElementById("import");
    const saveBackupBtn = shadow.getElementById("export-backup-btn");
    const loadBackupBtn = shadow.getElementById("import-backup-btn");



    // 创建绘图对象
    const displayCanvas = shadow.getElementById("preview-canvas");
    const displayCanvasContext = shadow.getElementById("preview-canvas").getContext("2d");
    displayCanvasContext.fillStyle = canvasColor;
    displayCanvasContext.fill();




    const fileManagerArea = shadow.getElementById("file-manager-area"); // 作为挂载点
    uiManager.fileManager = new FileManager(fileManagerArea, uiManager.callback.bind(uiManager));

    const filterManagerArea = shadow.getElementById("filter-manager-area"); // 作为挂载点
    const filterData = await new Promise(resolve => {
        const check = () => {
            if (AssetGroupMap) resolve(AssetGroupMap);
            else setTimeout(check, 50); // 每 50ms 检查一次
        };
        check();
    });
    uiManager.filterManager = new FilterManager(filterManagerArea, filterData);


    // dragging
    (function enableDrag(headerEl, containerEl) {
        let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;
        headerEl.addEventListener('pointerdown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = containerEl.getBoundingClientRect();
            origX = rect.left; origY = rect.top;
            headerEl.setPointerCapture(e.pointerId);
        });
        document.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX, dy = e.clientY - startY;
            containerEl.style.left = (origX + dx) + 'px';
            containerEl.style.top = (origY + dy) + 'px';
        });
        document.addEventListener('pointerup', (e) => { dragging = false; });
    })(shadow.querySelector('.header'), wrapper);

    // close
    closeBtn.addEventListener('click', () => wrapper.classList.add('hidden'));

    importBtn.addEventListener('click', () => {
        const code = prompt("Enter BCX Outfit Code", "");
        uiManager.ImportOutfitFromBCX(code);
    });

    // Save new outfit
    saveNewBtn.addEventListener('click', () => {
        uiManager.saveCurrentOutfit();
        update();
    });

    saveBackupBtn.addEventListener('click', () => {
        uiManager.fileManager.exportBackup();
        update();
    });

    loadBackupBtn.addEventListener('click', () => {
        uiManager.fileManager.importBackup();
        update();
    });

    // core render/update function
    function update() {

    }

    // initial render
    update();

    function drawOnDisplayCanvas(C, X, Y, Zoom, IsHeightResizeAllowed) {
        displayCanvasContext.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        CharacterRefresh(C);
        DrawCharacter(C, X, Y, Zoom, IsHeightResizeAllowed, displayCanvasContext);
    }

    drawOnDisplayCanvas(uiManager.targetCharacter, 0, 0, 1, true);








    // expose API to uiManager
    return {
        update,
        open() { wrapper.classList.remove('hidden'); },
        close() {
            uiManager.isOpen = false;
            wrapper.classList.add('hidden');
        },
        destroy() { host.remove(); },
        drawOnDisplayCanvas
    };
}

