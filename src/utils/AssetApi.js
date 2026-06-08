/**
 * outfit_assembler.js
 * Pure data layer for collecting and assembling outfit bundles with proper handling
 * of locked items, body cosplay, and filters.
 */

/**
 * gets asset data from global AssetGroup
 * @return {Promise<Array<{key: string, data: any}>>} Resolves to array of asset group data
 * description of AssetGroup:
 * [ {Name: groupName, Asset: [{Name: assetName, Description: desc, ...}, ...]}, ... ]
 */

import { hostWindow, doc, setTimeoutHost } from './host-window.js';
export async function fetchAssetData() {
  const filterData = await new Promise((resolve, reject) => {
    const start = Date.now();
    const loop = () => {
      try {
        if (hostWindow.AssetGroupMap) return resolve(hostWindow.AssetGroupMap);
        if (Date.now() - start > 8000) return resolve(new Map()); // timeout -> empty map
      } catch (e) {
        return resolve(new Map());
      }
      setTimeoutHost(loop, 50);
    };
    loop();
  });

  try {
    return Array.from(filterData, ([key, value]) => ({ key, data: value }));
  } catch (e) {
    return [];
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getPartGroupName(part) {
  return part?.Group || part?.Asset?.Group?.Name || part?.Asset?.Group?.name || '';
}

function getPartAssetName(part) {
  return part?.Name || part?.Asset?.Name || part?.Asset?.name || '';
}

function getAssetDescriptionFromGame(groupName, assetName, character = null) {
  if (!groupName || !assetName || typeof hostWindow?.AssetGet !== 'function') return '';

  const families = [
    character?.AssetFamily,
    hostWindow?.Player?.AssetFamily,
    'Female3DCG'
  ].filter(Boolean);

  for (const family of families) {
    try {
      const asset = hostWindow.AssetGet(family, groupName, assetName);
      const dynamicDescription =
        typeof asset?.DynamicDescription === 'function'
          ? asset.DynamicDescription(character || hostWindow?.Player)
          : '';
      const description = firstNonEmpty(asset?.Description, dynamicDescription);
      if (description) return description;
    } catch (e) {
      // Try the next available family.
    }
  }
  return '';
}

export function getPartDisplayName(part, character = null) {
  if (!part) return '';

  const directDynamicDescription =
    typeof part?.Asset?.DynamicDescription === 'function'
      ? (() => {
          try {
            return part.Asset.DynamicDescription(character || hostWindow?.Player);
          } catch (e) {
            return '';
          }
        })()
      : '';
  const groupName = getPartGroupName(part);
  const assetName = getPartAssetName(part);

  return firstNonEmpty(
    part?.Craft?.Name,
    part?.Description,
    part?.Asset?.Description,
    directDynamicDescription,
    getAssetDescriptionFromGame(groupName, assetName, character),
    assetName
  );
}

/**
 * Compares two typed asset options for equality
 * @param {JSONObject} optA - First typed asset option
 * @param {JSONObject} optB - Second typed asset option
 * @returns {boolean} True if equal, false otherwise
 */
export function compareTypedAssetOptions(optA, optB) {
  try {
    return JSON.stringify(optA) === JSON.stringify(optB);
  } catch (e) {
    return optA === optB;
  }
}

/**
 * Extracts outfit data from a character's appearance array
 * @param {Character} character - The character to extract outfit data from
 * @returns {Array<Object>} Array of outfit items with structure:
 *   { IsItem, Name, Group, Color?, Property?, Craft? }
 */
export function collectOutfitData(character) {
  if (!character?.Appearance) return [];
  return character.Appearance
    .filter(item => item?.Asset?.Group)
    .map(item => ({
      IsItem: item.Asset.Group.Category === "Item",
      Name: item.Asset.Name,
      Group: item.Asset.Group.Name,
      Color: Array.isArray(item.Color)
        ? [...item.Color]
        : (typeof item.Color === "string" &&
          item.Color !== "" &&
          item.Color.toLowerCase() !== "default")
          ? item.Color
          : undefined,
      Property: item.Property ? { ...item.Property } : undefined,
      Craft: item.Craft ? { ...item.Craft } : undefined
    }));
}

/**
 * Assembles outfit data from multiple outfit data arrays, with later arrays overriding earlier ones
 * by group membership.
 * @param {Array<Array<Object>>} outfitDataArray - Array of outfit data arrays to merge
 * example: [{data: OutfitData1, filterList: List1}, {data: OutfitData2, filterList: List2}, ...]
 * @returns {Array<Object>} Merged outfit data array
 */
export function stackOutfitData(outfitDataArray) {
  let final = [];
  for (const { data, filterList } of outfitDataArray) {
    if (!data || !filterList) continue;
    const filterSet = new Set(filterList);
    final = _filterOverride(final, data, filterSet);
  }
  return final;
}

/**
 * Get the name dict of a typed asset options from Group + Name of the asset
 * @param {string} group - The asset group name
 * @param {string} name - The asset name
 * @returns {Array<Object>|null} Array of name dicts for the typed asset options, or null if not found
 */
export function getTypedAssetOptions(group, name) {
  const keyDict = group + name;
  if (typeof TypedItemDataLookup === 'undefined' || typeof hostWindow.AssetTextGet === 'undefined') return keyDict;
  const TypedItemData = TypedItemDataLookup[keyDict];
  if (!TypedItemData) return null;
  const typedPrefix = TypedItemData.dialogPrefix?.option || "";
  const options = TypedItemData.options; // array of name dicts
  if (!Array.isArray(options)) return null;

  const optionList = options.map(opt => ({
    Name: opt.Name,
    Description: hostWindow.AssetTextGet(typedPrefix + opt.Name) || "",
    Property: {
      TypeRecord: opt.Property?.TypeRecord || null,
    }
  }));
  return optionList;
}

/**
 * Get vibrating asset mode options from Group + Name of the asset
 * @param {string} group - The asset group name
 * @param {string} name - The asset name
 * @returns {Array<Object>|null} Array of vibrator mode options, or null if not found
 */
export function getVibratingAssetOptions(group, name) {
  const keyDict = group + name;
  if (typeof VibratorModeDataLookup === 'undefined' || typeof hostWindow.AssetTextGet === 'undefined') return null;
  const VibratorModeData = VibratorModeDataLookup[keyDict];
  if (!VibratorModeData) return null;
  const vibratorPrefix = VibratorModeData.dialogPrefix?.option || "";
  const options = VibratorModeData.options; // array of option objects
  if (!Array.isArray(options)) return null;

  const modeList = options.map(opt => ({
    Name: opt.Name,
    Description: hostWindow.AssetTextGet(vibratorPrefix + opt.Name) || opt.Name,
    Property: opt.Property ? JSON.parse(JSON.stringify(opt.Property)) : null
  }));
  return modeList;
}

/**
 * Get modular asset definition including modules and options
 * @param {string} group - Asset group name
 * @param {string} name - Asset name
 * @returns {Array<Object>|null} Array of module definitions or null if not modular
 * Structure: [{ Key: 'm', Name: 'Mouth', Description: '...', Options: [{ Index: 0, Name: 'm0', Description: '...' }, ...] }, ...]
 */
export function getModularAssetData(group, name) {
  const keyDict = group + name;
  // Use global lookup provided by the game
  if (typeof ModularItemDataLookup === 'undefined') return null;
  
  const modularData = ModularItemDataLookup[keyDict];
  if (!modularData || !Array.isArray(modularData.modules)) return null;

  const translate = (k) => {
    if (typeof hostWindow.AssetTextGet === 'function') return hostWindow.AssetTextGet(k);
    return "";
  };

  const modulePrefix = modularData.dialogPrefix?.module || "";
  const optionPrefix = modularData.dialogPrefix?.option || "";

  return modularData.modules.map(mod => {
    const moduleDesc = translate(modulePrefix + mod.Name) || mod.Name;
    
    return {
      Key: mod.Key,       // "m", "e", etc. used in TypeRecord
      Name: mod.Name,     // Internal name "Mouth", "Eyes"
      Description: moduleDesc,
      Options: (mod.Options || []).map(opt => ({
        Index: opt.Index,
        Name: opt.Name,
        Description: translate(optionPrefix + opt.Name) || opt.Name
      }))
    };
  });
}

/**
 * Get text item definitions for an asset, including self text archetype and active modular-option text archetype
 * @param {string} group - Asset group name
 * @param {string} name - Asset name
 * @param {Object} partProperty - Current part property (used for active modular TypeRecord)
 * @returns {Array<Object>} Array of text definitions
 * Structure: [{ source, lookupKey, textFields: [{ key, maxLength }], parentModuleKey?, parentOptionIndex? }]
 */
export function getTextItemDefinitionsForPart(group, name, partProperty = {}) {
  const keyDict = group + name;
  if (typeof TextItemDataLookup === 'undefined') return [];

  const toTextFields = (textData) => {
    const textNames = Array.isArray(textData?.textNames) ? textData.textNames : [];
    const maxLengthMap = textData?.maxLength && typeof textData.maxLength === 'object' ? textData.maxLength : {};
    return textNames
      .filter(k => typeof k === 'string' && k)
      .map(k => {
        const limitRaw = Number(maxLengthMap[k]);
        const maxLength = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 255;
        return { key: k, maxLength };
      });
  };

  const results = [];
  const seen = new Set();

  const pushTextDef = (source, lookupKey, textData, extra = {}) => {
    if (!lookupKey || !textData) return;
    const textFields = toTextFields(textData);
    if (!textFields.length) return;
    const dedupeKey = `${source}:${lookupKey}:${extra.parentModuleKey ?? ''}:${extra.parentOptionIndex ?? ''}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    results.push({
      source,
      lookupKey,
      textFields,
      ...extra
    });
  };

  const selfTextData = TextItemDataLookup[keyDict];
  if (selfTextData && selfTextData.archetype === 'text') {
    pushTextDef('self', keyDict, selfTextData);
  }

  if (typeof ModularItemDataLookup !== 'undefined') {
    const modularData = ModularItemDataLookup[keyDict];
    const typeRecord = partProperty?.TypeRecord && typeof partProperty.TypeRecord === 'object'
      ? partProperty.TypeRecord
      : {};

    if (modularData && Array.isArray(modularData.modules)) {
      for (const mod of modularData.modules) {
        const moduleKey = mod?.Key;
        if (!moduleKey) continue;

        const selectedRaw = Number(typeRecord[moduleKey]);
        const selectedIndex = Number.isFinite(selectedRaw) ? selectedRaw : 0;
        const options = Array.isArray(mod?.Options) ? mod.Options : [];
        const selectedOption = options.find(opt => Number(opt?.Index) === selectedIndex)
          || options[selectedIndex]
          || null;
        if (!selectedOption) continue;

        const archetypeData = selectedOption?.ArchetypeData;
        if (!archetypeData || archetypeData.archetype !== 'text' || !archetypeData.key) continue;

        const optionTextData = TextItemDataLookup[archetypeData.key];
        if (!optionTextData || optionTextData.archetype !== 'text') continue;

        pushTextDef('modular-option', archetypeData.key, optionTextData, {
          parentModuleKey: moduleKey,
          parentOptionIndex: selectedIndex
        });
      }
    }
  }

  return results;
}


/**
 * Applies outfit data to a target character and refreshes.
 * This should be the only function that modifies character appearance directly.
 *
 * API:
 *   applyToCharacter({ item: { data: Array }, targetCharacter: Character, options?: {} })
 *
 * It will try common game-provided functions in order (ServerAppearanceLoadFromBundle,
 * loadOutfitOnCharacter) and gracefully degrade if they're unavailable.
 */
export function applyToCharacter({ item, targetCharacter, options } = {}) {
  if (!item || !Array.isArray(item.data)) {
    console.warn('[AssetApi] applyToCharacter: invalid item.data');
    return false;
  }
  if (!targetCharacter) {
    console.warn('[AssetApi] applyToCharacter: targetCharacter not provided');
    return false;
  }

  try {
    const dataBundle = item.data;

    // Prefer server-side appearance loader when available
    if (typeof ServerAppearanceLoadFromBundle === 'function') {
      try {
        // Many usages expect: ServerAppearanceLoadFromBundle(character, assetFamily, data, memberNumber)
        const family = targetCharacter.AssetFamily ?? null;
        const member = targetCharacter.MemberNumber ?? null;
        hostWindow.ServerAppearanceLoadFromBundle(targetCharacter, family, dataBundle, member);
      } catch (e) {
        // try fallback
        if (typeof loadOutfitOnCharacter === 'function') {
          try {
            hostWindow.loadOutfitOnCharacter(targetCharacter, dataBundle, options?.blockSet);
          } catch (ee) {
            console.error('[AssetApi] applyToCharacter: both ServerAppearanceLoadFromBundle and loadOutfitOnCharacter failed', ee);
            return false;
          }
        } else {
          console.error('[AssetApi] applyToCharacter: ServerAppearanceLoadFromBundle failed and no fallback available', e);
          return false;
        }
      }
    } else if (typeof loadOutfitOnCharacter === 'function') {
      try {
        hostWindow.loadOutfitOnCharacter(targetCharacter, dataBundle, options?.blockSet);
      } catch (e) {
        console.error('[AssetApi] applyToCharacter: loadOutfitOnCharacter failed', e);
        return false;
      }
    } else {
      console.error('[AssetApi] applyToCharacter: no known function to apply bundle (ServerAppearanceLoadFromBundle / loadOutfitOnCharacter missing)');
      return false;
    }

    try {
      if (typeof CharacterRefresh === 'function') hostWindow.CharacterRefresh(targetCharacter);
    } catch (e) { /* ignore */ }

    try {
      if (typeof ChatRoomCharacterUpdate === 'function') hostWindow.ChatRoomCharacterUpdate(targetCharacter);
    } catch (e) { /* ignore */ }

    return true;
  } catch (e) {
    console.error('[AssetApi] applyToCharacter unexpected error', e);
    return false;
  }
}

/**
 * Filters items by group membership in a set
 * @private
 * @param {Array} original - Original item array
 * @param {Set} filterSet - Set of group names
 * @param {boolean} reverse - If true, keeps items NOT in set
 * @returns {Array} Filtered array
 */
function _filter(original, filterSet, reverse = false) {
  return original.filter(item => reverse ? !filterSet.has(item.Group) : filterSet.has(item.Group));
}

/**
 * Overrides items in base with items from overriding array by group
 * @private
 * @param {Array} base - Base item array
 * @param {Array} overriding - Overriding item array
 * @returns {Array} Merged array with overridden items
 */
function _override(base, overriding) {
  const groups = new Set(overriding.map(o => o.Group));
  return base.filter(b => !groups.has(b.Group)).concat(overriding);
}

/**
 * Overrides items with a filter set, remove base items outside the set, add overriding items inside the set, and keep others
 * Edit: Now this function no longer removes base items outside the set, it only overrides 
 * @private
 * @param {Array} base - Base item array
 * @param {Array} overriding - Overriding item array
 * @param {Set} filterSet - Set of group names to override
 * @returns {Array} Merged array with overridden items
 */
function _filterOverride(base, overriding, filterSet) {
  //const filteredBase = base.filter(b => !filterSet.has(b.Group));
  const filteredOverriding = overriding.filter(o => filterSet.has(o.Group));
  //return filteredBase.concat(filteredOverriding);
  return _override(base, filteredOverriding);
}

/**
 * Assembles final appearance bundle by merging background items, applying outfit data
 * (respecting filterSet), and preserving locked/cosplay items
 * @param {Character} baseCharacter - The base character to use for context
 * @param {Array<Object>} outfitData - Array of outfit items to apply
 * @param {Set<string>} filterSet - Set of asset group names to apply from outfitData
 * @returns {Array<Object>} Final appearance bundle ready for ServerAppearanceLoadFromBundle
 */
export function assembleBundle({ baseCharacter, outfitData = [], filterSet = new Set() }) {
  if (!outfitData || !filterSet) return [];
  const processedList = _filter(outfitData, filterSet);
  if (!baseCharacter) return processedList;
  const original = _safe('ServerAppearanceBundle', [])(baseCharacter.Appearance) || [];

  const lockedSet = new Set(
    (baseCharacter.Appearance || [])
      .filter(a => _safe('InventoryItemHasEffect', false)(_safe('InventoryGet', null)(baseCharacter, a.Asset?.Group?.Name), "Lock"))
      .map(a => a.Asset?.Group?.Name)
  );
  const cosplaySet = new Set(
    (baseCharacter.Appearance || [])
      .filter(a => a.Asset?.BodyCosplay && baseCharacter.OnlineSharedSettings?.BlockBodyCosplay)
      .map(a => a.Asset?.Group?.Name)
  );
  const backgroundSet = new Set(
    (baseCharacter.Appearance || [])
      .filter(a => !a.Asset?.Group?.AllowNone)
      .map(a => a.Asset?.Group?.Name)
  );

  const backgroundList = _filter(original, backgroundSet);
  const lockedList = _filter(original, new Set([...lockedSet, ...cosplaySet]));
  const preservedList = _filter(original, filterSet, true);

  let final = [];
  final = _override(final, backgroundList);
  final = _override(final, processedList);
  final = _override(final, preservedList);
  final = _override(final, lockedList);
  return final;
}

/**
 * Safe wrapper for game functions with fallback
 * @private
 * @param {string} fnName - Function name to call
 * @param {any} fallback - Fallback value if function not available
 * @returns {Function} Wrapped function that returns fallback on error
 */
function _safe(fnName, fallback) {
  const fn = hostWindow[fnName];
  if (typeof fn !== 'function') return (..._) => fallback;
  return fn;
}

export const AssetApi = {
  collectOutfitData,
  assembleBundle,
  stackOutfitData,
  fetchAssetData,
  getPartDisplayName,
  applyToCharacter,
  getTypedAssetOptions,
  getVibratingAssetOptions,
  compareTypedAssetOptions,
  getModularAssetData,
  getTextItemDefinitionsForPart
};
