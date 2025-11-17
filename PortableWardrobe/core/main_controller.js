const { FileManagerController } = await import(`../core/file_manager_controller.js?${Date.now()}`);
const { FilterManager } = await import(`./filter_manager.js?${Date.now()}`);
const { OutfitController } = await import('./outfit_controller.js?' + Date.now());
const { createFloatingOutfitWidget } = await import('../ui/main_ui_view.js?' + Date.now());
const { drawThumb } = await import('../utils/drawer.js?' + Date.now());
const { getOutfitData } = await import(`../utils/drawer.js?${Date.now()}`);

const VERSION_NUMBER = 0.1

export class UIManager {
    constructor() {
        this.fileManager = null;
        this.filterManager = null;
        this.outfitController = null;
        this.targetCharacter = null;
        this.isOpen = false;
        this._floatingOutfitWidget = null;
    }

    async init() {
        // 文件管理器

        this._floatingOutfitWidget = await createFloatingOutfitWidget(this, VERSION_NUMBER);

        this.fileManager = new FileManagerController({
            container: this._floatingOutfitWidget.fileManagerArea,
            callback: this.callback.bind(this),
            storageAdapters: {
                online: {
                    get: () => Player.ExtensionSettings?.VPWardrobe,
                    set: val => { Player.ExtensionSettings.VPWardrobe = val; ServerPlayerExtensionSettingsSync("VPWardrobe"); }
                },
                local: {
                    get: () => localStorage.getItem(`VPWardrobe${Player.MemberNumber}`),
                    set: val => localStorage.setItem(`VPWardrobe${Player.MemberNumber}`, val)
                }
            },
            compressor: window.LZString ? { compress: s => LZString.compressToBase64(s), decompress: s => LZString.decompressFromBase64(s) } : null,
            drawCallback: drawThumb
        });

        // 筛选器
        const filterData = await new Promise(resolve => {
            const check = () => AssetGroupMap ? resolve(AssetGroupMap) : setTimeout(check, 50);
            check();
        });
        this.filterManager = new FilterManager(this._floatingOutfitWidget.filterManagerArea, filterData);

        // OutfitController
        this.outfitController = new OutfitController({
            fileManager: this.fileManager,
            filterManager: this.filterManager
        });

        // 浮动窗口

        this._floatingOutfitWidget.createMainButton(this.outfitController);
    }

    hookDrawCharacter(modApi) {
        modApi.hookFunction("DrawCharacter", 5, (args, next) => {
            const [C] = args;
            if (C.CharacterID === "displayCharacter") {
                const originalIsPlayer = C.IsPlayer;
                C.IsPlayer = () => true;
                const result = next(args);
                C.IsPlayer = originalIsPlayer;
                return result;
            }
            return next(args);
        });

        modApi.hookFunction("ValidationResolveAppearanceDiff", 4, (args, next) => {
            const [groupName, previousItem, newItem, params] = args;
            const C = params.C;
            if (C.CharacterID === "displayCharacter") {
                return { item: newItem, valid: true };
            }
            return next(args);
        });
    }

    hookHistory(modApi) {
        /*  modApi.hookFunction("DrawCharacter", 6, (args, next) => {
             const [C] = args;
 
 
             // If we're in outfit manager and this is our displayChar, make it act like a player character
             if (C === Player) {  // We set ID to -1 for our displayChar
                 //this.historyManager.pushHistory(getOutfitData(C));
             }
             // If we're the player hook history recorder;
             return next(args);
         });
  */
        modApi.hookFunction("CharacterRefresh", 10, (args, next) => {
            const [C] = args;
            if (C.IsPlayer()) {
                this.fileManager.addHistoryRecord(getOutfitData(C));
            }
            return next(args);
        });
    }

    setTargetCharacter(character) {
        this.targetCharacter = character;
        this.outfitController.setTargetCharacter(character);
    }

    async drawOutfitMenu() {
        if (!this._floatingOutfitWidget) return;
        if (this.isOpen) {
            this.setTargetCharacter(CurrentCharacter || Player);
            this.outfitController.drawPreview({ src: { data: [], blockSet: this.filterManager.getFullSet() } }, this._floatingOutfitWidget);
            this._floatingOutfitWidget.update();
            this._floatingOutfitWidget.open();
        } else {
            this._floatingOutfitWidget.close();
            this.setTargetCharacter(null);
        }
    }

    callback({ uiEvent = '', args = {} } = {}) {
        switch (uiEvent) {
            case 'drawFromSave':
                this.outfitController.drawPreview(args, this._floatingOutfitWidget);
                break;
            case 'refreshDraw':
                this.outfitController.drawPreview({ src: { data: [], blockSet: this.filterManager.getFullSet() } }, this._floatingOutfitWidget);
                break;
            case 'applyFromSave':
                this.outfitController.applyToCurrentCharacter(args);
                break;
            case 'clearPreview':
                this.outfitController.drawPreview({ src: { data: [], blockSet: this.filterManager.getFullSet() } }, this._floatingOutfitWidget);
                break;
            case 'ImportOutfitFromBCX':
                this.outfitController.importOutfitFromBCX(args.code);
                break;
            case 'saveCurrentOutfit':
                // Only allow saving if the target character is the player
                // Will be replaced by a permission check later
                if (this.targetCharacter !== Player) break;
                this.outfitController.saveCurrentOutfit();
                break;
            case 'exportBackup':
                this.fileManager.exportBackup();
                break;
            case 'importBackup':
                this.fileManager.importBackup();
                break;
            case 'toggleHistoryMode':
                this.fileManager.ToggleWorkMode(this.fileManager.workMode === 'normal' ? 'history' : 'normal');
                break;
        }
    }
}
