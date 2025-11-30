/**
 * PaletteService (pure functions)
 *
 * This module provides pure, non-mutating functions for palette handling.
 * Functions accept the current paletteMap / counter / stacks / focusedPart
 * and return new values rather than modifying any store directly.
 *
 * Important:
 *  - Inputs are treated as immutable; returned objects are new copies.
 *  - Equality for palette entries is implemented using JSON.stringify (best-effort).
 */

function deepClone(v) {
  try { return JSON.parse(JSON.stringify(v)) } catch (e) {
    // simple fallback (shallow)
    if (Array.isArray(v)) return v.slice()
    if (v && typeof v === 'object') return Object.assign({}, v)
    return v
  }
}

/**
 * Find an existing tag in paletteMap that matches value (deep equality).
 * @param {Object} paletteMap
 * @param {*} value
 * @returns {string|null} tag or null
 */
export function findTagForValue(paletteMap = {}, value) {
  try {
    const s = JSON.stringify(value)
    for (const [k, v] of Object.entries(paletteMap || {})) {
      if (JSON.stringify(v) === s) return k
    }
  } catch (e) { /* ignore */ }
  return null
}

/**
 * Create a new tag for value if not exists. Pure.
 * @param {Object} paletteMap
 * @param {number} paletteCounter
 * @param {*} value
 * @returns {{ paletteMap: Object, paletteCounter: number, tag: string|null }}
 */
export function createTagForValue(paletteMap = {}, paletteCounter = 1, value) {
  if (value === undefined || value === null) return { paletteMap: deepClone(paletteMap), paletteCounter, tag: null }

  const existing = findTagForValue(paletteMap, value)
  if (existing) return { paletteMap: deepClone(paletteMap), paletteCounter, tag: existing }

  const tag = 'tag' + (paletteCounter || 1)
  const newMap = deepClone(paletteMap)
  try {
    newMap[tag] = deepClone(value)
  } catch (e) {
    newMap[tag] = value
  }
  return { paletteMap: newMap, paletteCounter: (paletteCounter || 1) + 1, tag }
}

/**
 * Replace matches of `value` with `tag` inside a single part (pure).
 * Returns a new part object (or null if input null).
 * Matching uses JSON.stringify where possible, otherwise strict equality fallback.
 * @param {Object|null} part
 * @param {*} value
 * @param {string} tag
 * @returns {Object|null}
 */
export function replaceValueInPart(part, value, tag) {
  if (!part) return part
  let copy
  try { copy = JSON.parse(JSON.stringify(part)) } catch (e) { copy = Object.assign({}, part) }

  if (Array.isArray(copy.Color)) {
    copy.Color = copy.Color.map(c => {
      try {
        if (JSON.stringify(c) === JSON.stringify(value)) return tag
      } catch (e) {
        if (c === value) return tag
      }
      return c
    })
  } else {
    try {
      if (JSON.stringify(copy.Color) === JSON.stringify(value)) copy.Color = tag
    } catch (e) {
      if (copy.Color === value) copy.Color = tag
    }
  }
  return copy
}

/**
 * Replace matches of `value` with `tag` across all stacks (pure).
 * Returns new stacks array (deep cloned).
 * @param {Array<Object>} stacks
 * @param {*} value
 * @param {string} tag
 * @returns {Array<Object>}
 */
export function replaceValueInStacks(stacks = [], value, tag) {
  if (!Array.isArray(stacks)) return []
  return stacks.map(el => {
    if (!el || !Array.isArray(el.data)) return deepClone(el)
    const newEl = deepClone(el)
    newEl.data = newEl.data.map(p => replaceValueInPart(p, value, tag))
    return newEl
  })
}




function looksLikeCssColor(s) {
  if (!s || typeof s !== 'string') return false
  const str = s.trim().toLowerCase()
  if (!str) return false
  if (str.startsWith('#')) return true
  if (str.startsWith('rgb') || str.startsWith('hsl')) return true
  const basic = ['red', 'blue', 'green', 'black', 'white', 'gray', 'grey', 'yellow', 'orange', 'purple', 'pink', 'brown']
  if (basic.includes(str)) return true
  return false
}

/**
 * Apply palette rules to a single element (the old behavior created tags for repeated colors).
 * Pure: returns { element: newElement, paletteMap: newPaletteMap, paletteCounter: newCounter }
 *
 * Behavior:
 *  - Scans part.Color arrays and if a non-default color repeats more than once,
 *    creates a tag (using createTagForValue) and replaces occurrences in that element.
 */
export function applyPaletteToElement(element, paletteMap = {}, paletteCounter = 1) {
  if (!element || !Array.isArray(element.data)) {
    return { element: deepClone(element), paletteMap: deepClone(paletteMap), paletteCounter }
  }

  let pm = deepClone(paletteMap)
  let pc = paletteCounter || 1
  const out = deepClone(element)

  for (const p of out.data) {
    if (!p) continue
    if (!Array.isArray(p.Color)) continue

    // normalize and count non-default string representations
    const normalized = p.Color.map(c => {
      if (c === undefined || c === null) return null
      const s = String(c).trim()
      const lower = s.toLowerCase()
      if (!s || lower === 'default' || looksLikeCssColor(s)) return null
      return s
    })

    const counts = {}
    for (const v of normalized) {
      if (v === null) continue
      counts[v] = (counts[v] || 0) + 1
    }

    const tagsForValue = {}
    for (const [val, cnt] of Object.entries(counts)) {
      if (cnt > 1) {
        const res = createTagForValue(pm, pc, val)
        pm = res.paletteMap
        pc = res.paletteCounter
        if (res.tag) tagsForValue[val] = res.tag
      }
    }

    if (Object.keys(tagsForValue).length > 0) {
      p.Color = p.Color.map(orig => {
        if (orig === undefined || orig === null) return orig
        const s = String(orig).trim()
        if (!s) return orig
        const lower = s.toLowerCase()
        if (lower === 'default') return orig
        if (s in tagsForValue) return tagsForValue[s]
        return orig
      })
    }
  }

  return { element: out, paletteMap: pm, paletteCounter: pc }
}

/**
 * Expand tags inside an appearance array (pure).
 * If a Color entry is a tag string present in paletteMap, expand it to the palette value.
 * Returns a deep-cloned expanded array.
 * @param {Array} apArr
 * @param {Object} paletteMap
 * @returns {Array}
 */
export function expandTagsInAppearance(apArr = [], paletteMap = {}) {
  if (!Array.isArray(apArr)) return []
  try {
    const copied = JSON.parse(JSON.stringify(apArr))
    for (const p of copied) {
      if (!p) continue
      if (typeof p.Color === 'string' && p.Color in (paletteMap || {})) {
        const v = paletteMap[p.Color]
        p.Color = deepClone(v)
        continue
      }
      if (Array.isArray(p.Color)) {
        const out = []
        for (const el of p.Color) {
          if (typeof el === 'string' && el in (paletteMap || {})) {
            const v = paletteMap[el]
            if (Array.isArray(v)) {
              for (const vv of v) out.push(deepClone(vv))
            } else {
              out.push(deepClone(v))
            }
          } else out.push(el)
        }
        p.Color = out
      }
    }
    return copied
  } catch (e) {
    // fallback manual clone
    const out = []
    for (const p of apArr) {
      const np = Object.assign({}, p)
      if (typeof np.Color === 'string' && np.Color in (paletteMap || {})) {
        const v = paletteMap[np.Color]
        np.Color = deepClone(v)
      } else if (Array.isArray(np.Color)) {
        const arrOut = []
        for (const el of np.Color) {
          if (typeof el === 'string' && el in (paletteMap || {})) {
            const v = paletteMap[el]
            if (Array.isArray(v)) {
              for (const vv of v) arrOut.push(deepClone(vv))
            } else arrOut.push(deepClone(v))
          } else arrOut.push(el)
        }
        np.Color = arrOut
      }
      out.push(np)
    }
    return out
  }
}

/**
 * Construct expanded appearance object for rendering (pure).
 * @param {{data:Array, type?:string}} mergedObj
 * @param {Object} paletteMap
 * @returns {{data:Array, type:string}}
 */
export function expandedAppearanceForRendering(mergedObj = { data: [] }, paletteMap = {}) {
  if (!mergedObj || !Array.isArray(mergedObj.data)) return mergedObj
  try {
    const copy = JSON.parse(JSON.stringify(mergedObj))
    copy.data = expandTagsInAppearance(copy.data, paletteMap)
    return copy
  } catch (e) {
    return { data: expandTagsInAppearance(mergedObj.data, paletteMap), type: mergedObj.type || 'outfit' }
  }
}

/**
 * Delete a palette tag: expand occurrences in stacks and focusedPart (pure).
 * Returns { stacks: newStacks, focusedPart: newFocusedPart, paletteMap: newPaletteMap, removed: boolean }
 * If tag not present returns removed:false and original values (cloned).
 */
export function deletePaletteTagFromStacks(stacks = [], paletteMap = {}, focusedPart = null, tag) {
  const pm = deepClone(paletteMap || {})
  if (!tag || !(tag in pm)) {
    return {
      stacks: deepClone(stacks || []),
      focusedPart: deepClone(focusedPart),
      paletteMap: pm,
      removed: false
    }
  }
  const value = pm[tag]
  const newStacks = (stacks || []).map(el => {
    if (!el || !Array.isArray(el.data)) return deepClone(el)
    const newEl = deepClone(el)
    newEl.data = newEl.data.map(p => {
      if (!p) return p
      if (Array.isArray(p.Color)) {
        const out = []
        for (const elc of p.Color) {
          if (elc === tag) {
            if (Array.isArray(value)) {
              for (const vv of value) out.push(deepClone(vv))
            } else out.push(deepClone(value))
          } else out.push(elc)
        }
        p.Color = out
      } else if (p.Color === tag) {
        try { p.Color = deepClone(value) } catch (e) { p.Color = value }
      }
      return p
    })
    return newEl
  })

  let newFocusedPart = deepClone(focusedPart)
  if (newFocusedPart) {
    if (Array.isArray(newFocusedPart.Color)) {
      const out = []
      for (const elc of newFocusedPart.Color) {
        if (elc === tag) {
          if (Array.isArray(value)) {
            for (const vv of value) out.push(deepClone(vv))
          } else out.push(deepClone(value))
        } else out.push(elc)
      }
      newFocusedPart.Color = out
    } else if (newFocusedPart.Color === tag) {
      try { newFocusedPart.Color = deepClone(value) } catch (e) { newFocusedPart.Color = value }
    }
  }

  // remove tag
  delete pm[tag]

  return { stacks: newStacks, focusedPart: newFocusedPart, paletteMap: pm, removed: true }
}

/**
 * Update palette tag to new value (pure)
 * @param {Object} paletteMap
 * @param {string} tag
 * @param {*} newValue
 * @returns {Object} newPaletteMap
 */
export function updatePaletteTag(paletteMap = {}, tag, newValue) {
  if (!tag || !(tag in (paletteMap || {}))) return deepClone(paletteMap || {})
  const pm = deepClone(paletteMap)
  try { pm[tag] = deepClone(newValue) } catch (e) { pm[tag] = newValue }
  return pm
}

/**
 * Palette snapshot (defensive copy)
 * @param {Object} paletteMap
 * @returns {Object}
 */
export function paletteSnapshot(paletteMap = {}) {
  const out = {}
  for (const k of Object.keys(paletteMap || {})) {
    try { out[k] = deepClone(paletteMap[k]) } catch (e) { out[k] = paletteMap[k] }
  }
  return out
}

export default {
  findTagForValue,
  createTagForValue,
  replaceValueInPart,
  replaceValueInStacks,
  applyPaletteToElement,
  expandTagsInAppearance,
  expandedAppearanceForRendering,
  deletePaletteTagFromStacks,
  updatePaletteTag,
  paletteSnapshot
}