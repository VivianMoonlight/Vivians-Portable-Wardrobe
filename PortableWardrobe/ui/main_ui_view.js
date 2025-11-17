export async function createFloatingOutfitWidget(uiManager, VERSION_NUMBER) {

    const canvasColor = "#adb5bdff";

    // --- Shadow DOM 容器 ---
    const host = document.createElement("div");
    host.id = "bco-outfit-widget-host";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

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
        z-index: 9999;
        display:flex;
        flex-direction: column;
        overflow: hidden;
        user-select: none;

        /* —— 新增：可缩放 —— */
        resize: both;
        overflow: auto !important;

        /* 缩放支持 */
        transform-origin: top left;
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
        max-height: 100%;
        overflow: hidden;
    }

    .left { width: 365px; display:flex; flex-direction: column; gap:10px; }

    .preview {
        flex: 1;
        min-height: 200px;
        max-height: 100%;
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

    .center { width: 340px; display:flex; height: 100%; flex-direction: column; gap:8px; }

    .file-manager {
        position: relative;
        flex:1;
        width: 100%;
        height: 100%;
    }

    .right { width: 240px; display:flex; flex-direction: column; gap:8px; }

    .filter-manager {
        flex:1;
        width: 100%;
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

    #save-new:hover { background: #e8e8e8; }

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

    #import:hover { background: #e8e8e8; }
    `;
    shadow.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.className = "widget";
    wrapper.innerHTML = `
        <div class="header">
            <div style="display:flex;align-items:center;gap:10px">
                <div class="title">${CharacterNickname ? (CharacterNickname(Player) + "'s Portable Wardrobe") : "Portable Wardrobe"}</div>
                <div class="version">v${VERSION_NUMBER}</div>
            </div>
            <div class="controls">
                <button id="history-btn" class="btn" title="History">⏱</button>
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
            </div>

            <div class="right">
                <div class="filter-manager" id="filter-manager-area"></div>
            </div>
        </div>
    `;
    shadow.appendChild(wrapper);

    const displayCanvas = shadow.getElementById("preview-canvas");
    const displayCanvasContext = displayCanvas.getContext("2d");
    const filterManagerArea = shadow.getElementById("filter-manager-area");
    const fileManagerArea = shadow.getElementById("file-manager-area");
    const closeBtn = shadow.getElementById("close-btn");
    const saveNewBtn = shadow.getElementById("save-new");
    const importBtn = shadow.getElementById("import");
    const saveBackupBtn = shadow.getElementById("export-backup-btn");
    const loadBackupBtn = shadow.getElementById("import-backup-btn");
    const historyBtn = shadow.getElementById("history-btn");

    displayCanvasContext.fillStyle = canvasColor;
    displayCanvasContext.fill();

    function drawOnDisplayCanvas(C, X, Y, Zoom, IsHeightResizeAllowed) {
        displayCanvasContext.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        CharacterRefresh(C);
        DrawCharacter(C, X, Y, Zoom, IsHeightResizeAllowed, displayCanvasContext);
    }

    // =============== 修复拖拽 + 限制边界 + 保存位置 ==================
    (function enableDrag(headerEl, containerEl) {
        let dragging = false;
        let startX = 0, startY = 0;
        let offsetX = 0, offsetY = 0;

        // 读取上次位置


        headerEl.addEventListener("pointerdown", e => {
            if (e.target.closest("button") || e.target.closest("input")) return;

            dragging = true;

            const rect = containerEl.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;

            startX = e.clientX;
            startY = e.clientY;

            headerEl.setPointerCapture(e.pointerId);
        });

        headerEl.addEventListener("pointermove", e => {
            if (!dragging) return;

            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;

            // 限制边界（不会拖出屏幕）
            if (newY < 0) newY = 0;

            containerEl.style.left = newX + "px";
            containerEl.style.top = newY + "px";
        });

        headerEl.addEventListener("pointerup", () => {
            dragging = false;

            // 保存位置
        });
    })(shadow.querySelector(".header"), wrapper);



    // =============== Ctrl + 滚轮缩放 + 保存倍率 ==================

    let scale = 1.0;


    wrapper.style.transform = `scale(${scale})`;

    wrapper.addEventListener("wheel", e => {
        if (!e.ctrlKey) return;
        e.preventDefault();

        const delta = -e.deltaY * 0.001;
        scale = Math.min(2.0, Math.max(0.5, scale + delta));

        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.transformOrigin = "top left";


    }, { passive: false });



    // =============== 按钮逻辑保持原样 ===============

    closeBtn.addEventListener('click', () => {
        wrapper.classList.add('hidden')
        uiManager.isOpen = false;
    });
    importBtn.addEventListener('click', () => {
        const code = prompt("Enter BCX Outfit Code", "");
        uiManager.callback({ uiEvent: 'ImportOutfitFromBCX', args: { code: code } });
    });

    saveNewBtn.addEventListener('click', () => {
        uiManager.callback({ uiEvent: 'saveCurrentOutfit' });
    });

    saveBackupBtn.addEventListener('click', () => {
        uiManager.callback({ uiEvent: 'exportBackup' });
        update();
    });

    loadBackupBtn.addEventListener('click', () => {
        uiManager.callback({ uiEvent: 'importBackup' });
        update();
    });

    historyBtn.addEventListener('click', () => {
        uiManager.callback({ uiEvent: 'toggleHistoryMode' });
        update();
    });

    wrapper.classList.add('hidden');

    // --- 浮动按钮 ---
    function createMainButton(outfitController) {
        const manager = uiManager;
        let TemptargetCharacter = CurrentCharacter || Player;
        let hasPermission = true;

        const oldButton = document.getElementById("OutfitManagerFloatBtn");
        if (oldButton) oldButton.remove();

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

        const img = document.createElement("img");
        img.src = new URL("./image.png", import.meta.url).href;
        img.style.width = "75%";
        img.style.height = "75%";
        img.style.pointerEvents = "none";
        btn.appendChild(img);

        btn.addEventListener("mouseenter", () => {
            TemptargetCharacter = CurrentCharacter || Player;
            hasPermission = TemptargetCharacter.MemberNumber === Player.MemberNumber || TemptargetCharacter.AllowItem;
            btn.style.background = hasPermission ? "#ccffff" : "#ffb6c1";
            btn.style.transform = "scale(1.07)";
        });

        btn.addEventListener("mouseleave", () => {
            TemptargetCharacter = CurrentCharacter || Player;
            hasPermission = TemptargetCharacter.MemberNumber === Player.MemberNumber || TemptargetCharacter.AllowItem;
            btn.style.background = "#ffffffcc";
            btn.style.transform = "scale(1.0)";
        });

        btn.addEventListener("click", () => {
            TemptargetCharacter = CurrentCharacter || Player;
            hasPermission = TemptargetCharacter.MemberNumber === Player.MemberNumber || TemptargetCharacter.AllowItem;

            if (!hasPermission) {
                alert("You don’t have permission to interact with this player");
                return;
            }

            manager.isOpen = !manager.isOpen;
            manager.drawOutfitMenu();
        });

        document.body.appendChild(btn);
    }


    function update() { }

    return {
        update,
        open() {
            wrapper.classList.remove('hidden');
            uiManager.isOpen = true;
        },
        close() {
            wrapper.classList.add('hidden');
            uiManager.isOpen = false;
        },
        destroy() { host.remove(); },
        drawOnDisplayCanvas,
        createMainButton,
        fileManagerArea,
        filterManagerArea
    };
}
