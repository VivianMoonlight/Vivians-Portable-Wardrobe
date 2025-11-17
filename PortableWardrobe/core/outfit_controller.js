const { getOutfitData, createDisplayCharacter, loadOutfitOnCharacter } = await import('../utils/drawer.js?' + Date.now());

export class OutfitController {
    constructor({ fileManager, filterManager }) {
        this.fileManager = fileManager;
        this.filterManager = filterManager;
        this.targetCharacter = null;
    }

    setTargetCharacter(character) {
        this.targetCharacter = character;
    }

    saveCurrentOutfit() {
        if (!this.targetCharacter || this.targetCharacter !== Player) return;
        const outfitname = prompt("Outfit name", "New Outfit");
        const outfitData = getOutfitData(this.targetCharacter);
        this.fileManager.addFile(this.fileManager.currentPath, { name: outfitname, type: 'outfit', data: outfitData });
    }

    importOutfitFromBCX(code) {
        const outfitname = prompt("Outfit name", "New Outfit");
        const outfitData = JSON.parse(LZString.decompressFromBase64(code.trim()));
        this.fileManager.addFile(this.fileManager.currentPath, { name: outfitname, type: 'outfit', data: outfitData });
    }

    applyToCurrentCharacter({ src = {} } = {}) {
        if (!src.data || !this.targetCharacter) return;
        const blockSet = this.filterManager.getActiveSet(true);
        loadOutfitOnCharacter(this.targetCharacter, src.data, blockSet);
        CharacterRefresh(this.targetCharacter);
        try {
            ChatRoomCharacterUpdate(this.targetCharacter);
        } finally { }
    }

    drawPreview({ src = {} } = {}, floatingWidget) {
        if (!src.data) return;
        const displayCharacter = createDisplayCharacter(this.targetCharacter);
        const blockSet = src.blockSet || this.filterManager.getActiveSet(true);
        loadOutfitOnCharacter(displayCharacter, src.data, blockSet);
        floatingWidget.drawOnDisplayCanvas(displayCharacter, 0, 0, 1, true);
        floatingWidget.update();
        CharacterDelete(displayCharacter);
    }

}
