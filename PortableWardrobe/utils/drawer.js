export function getOutfitData(C) {
    const outfitData = C.Appearance.filter(item => {
        const group = item?.Asset?.Group;
        return group;
        //return group && (
        //group.Clothing ||
        //group.Name.includes("Item") ||
        //group.Name.includes("BodyMarkings") ||
        //HairList.includes(group.Name)
        //);
    }).map(item => ({
        IsItem: (item.Asset.Group.Category === "Item"),
        Name: item.Asset.Name,
        Group: item.Asset.Group.Name,
        Color: Array.isArray(item.Color) ? [...item.Color] :
            (typeof item.Color === "string" && item.Color !== "" &&
                item.Color.toLowerCase() !== "default") ? item.Color : undefined,
        Property: item.Property ? { ...item.Property } : undefined,
        Craft: item.Craft ? { ...item.Craft } : undefined
    }));

    if (outfitData.length === 0) {
        ErrorHandler.showError("No clothing or restraints found to save as an outfit.");
        return;
    }
    return outfitData;
}

function filterOutfitData(original, filter, reverse = false) {
    return original.filter(item => reverse ? (!filter.has(item.Group)) : (filter.has(item.Group)))
}


function overrideOutfitData(original, override) {
    const overrideSet = new Set(override.map(item => item.Group));
    let newData = original.filter(item => !(overrideSet.has(item.Group)));
    newData = newData.concat(override);
    return newData;
}




export function loadOutfitOnCharacter(C, outfitData, blockSet) {
    const originalOutfitList = structuredClone(ServerAppearanceBundle(C.Appearance));

    /*for (const item of outfitData) {
            const asset = AssetGet(C.AssetFamily, item.Group, item.Name);
            const bondageSkill = Player.Skill.find(skill => skill.Type === "Bondage");
            const newItem = {
                Asset: asset,
                Color: item.Color || "Default",
                Property: item.Property ? { ...item.Property } : undefined,
                Difficulty: asset.Difficulty !== undefined ? asset.Difficulty + (bondageSkill ? bondageSkill.Level : 0) : 0
            };
            if (item.Craft) newItem.Craft = item.Craft;
            processedOutfitList.push(newItem);
        } */

    const lockedSet = new Set(C.Appearance.filter(item => InventoryItemHasEffect(InventoryGet(C, item.Asset.Group.Name), "Lock")).map(item => item.Asset.Group.Name));

    const cosplaySet = new Set(C.Appearance.filter(item => (item.Asset.BodyCosplay && C.OnlineSharedSettings?.BlockBodyCosplay)).map(item => item.Asset.Group.Name));

    const backgroundSet = new Set(C.Appearance.filter(item => (!item.Asset.Group.AllowNone)).map(item => item.Asset.Group.Name));

    const backgroundOutfitList = filterOutfitData(originalOutfitList, backgroundSet);
    const lockedOutfitList = filterOutfitData(originalOutfitList, lockedSet.union(cosplaySet).union(blockSet));
    const processedOutfitList = filterOutfitData(outfitData, blockSet, true);

    let finalOutfitList = [];
    finalOutfitList = overrideOutfitData(finalOutfitList, backgroundOutfitList);
    finalOutfitList = overrideOutfitData(finalOutfitList, processedOutfitList);
    finalOutfitList = overrideOutfitData(finalOutfitList, lockedOutfitList);


    ServerAppearanceLoadFromBundle(
        C,
        C.AssetFamily,
        finalOutfitList,
        Player.MemberNumber
    );
}

export function createDisplayCharacter(Character = null) {
    let C;
    if (Character) { C = Character; }
    else if (CurrentCharacter) { C = CurrentCharacter; }
    else { C = Player; }

    let displayCharacter = CharacterLoadSimple("displayCharacter");

    const appearanceBundle = structuredClone(ServerAppearanceBundle(C.Appearance));

    // 3. Load the bundle onto the dummy character
    ServerAppearanceLoadFromBundle(
        displayCharacter,
        C.AssetFamily,
        appearanceBundle,
        Player.MemberNumber
    );

    return displayCharacter;
}


export function drawThumb({ data = {}, ctx = {} } = {}) {
        if (!data || !ctx) return;
        const displayCharacter = createDisplayCharacter();
        loadOutfitOnCharacter(displayCharacter, data, new Set());
        CharacterRefresh(displayCharacter);
        DrawCharacter(displayCharacter, 0, 0, 0.16, true, ctx);
        CharacterDelete(displayCharacter);
}





