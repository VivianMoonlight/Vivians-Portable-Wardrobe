/**
 * PriorityService (refactored)
 *
 * New responsibilities:
 *  - Provide a pure/lean function to build a priority-list view from a stack element
 *    without mutating overridePriority values.
 *  - Provide an apply function which updates overridePriority values of specific
 *    layer entries (or all layers of a part) according to requested changes.
 *
 * Note:
 *  - This service intentionally does NOT convert numeric overridePriority values
 *    into string tags. It keeps overridePriority values as-is (numbers/strings/null).
 *  - The caller (studioStore / UI) is responsible for persisting mutated stack
 *    objects back into store.stacks and triggering preview refresh.
 */

function safeClone(v) {
  try { return JSON.parse(JSON.stringify(v)) } catch (e) {
    if (Array.isArray(v)) return v.slice()
    if (v && typeof v === 'object') return Object.assign({}, v)
    return v
  }
}

/**
 * Build a structured priority list for a stack element for UI consumption.
 *
 * Output: Array of groups, each group:
 *   {
 *     priority: <value | null>,
 *     parts: [
 *       {
 *         partIndex: Number,
 *         description: String,
 *         layers: [
 *           { layerIndex, name, displayName, entryRef }  // entryRef points to original entry object
 *         ]
 *       }, ...
 *     ]
 *   }
 *
 * Groups are ordered:
 *   - numeric priorities (descending),
 *   - then string priorities (lexicographic),
 *   - then null/undefined last.
 *
 * deps:
 *   - getGroupDescriptionForPart(part) => string (optional)
 */
export function buildPriorityListForStackObject(element, deps = {}) {
  if (!element || !Array.isArray(element.data)) return []

  const getGroupDesc = typeof deps.getGroupDescriptionForPart === 'function' ? deps.getGroupDescriptionForPart : (() => '')

  // Map priority value => map(partIndex => { partIndex, description, layers: [] })
  const groupMap = new Map()

  for (let pidx = 0; pidx < element.data.length; pidx++) {
    const part = element.data[pidx]
    if (!part) continue
    const desc = (part.Description || part.Desc || part.name || part.Name || '') + ''
    const entries = Array.isArray(part.layerEntries) ? part.layerEntries : []

    for (let lidx = 0; lidx < entries.length; lidx++) {
      const entry = entries[lidx]
      if (!entry) continue
      // Use explicit overridePriority only (may be number, string, null/undefined)
      const priority = (entry.overridePriority === undefined ? null : entry.overridePriority)
      const key = String(priority) + '::' + (typeof priority)
      if (!groupMap.has(key)) groupMap.set(key, { priority, parts: new Map() })
      const group = groupMap.get(key)
      if (!group.parts.has(pidx)) {
        group.parts.set(pidx, {
          partIndex: pidx,
          description: desc || (getGroupDesc ? getGroupDesc(part) : '') || ('part#' + pidx),
          layers: []
        })
      }
      const partObj = group.parts.get(pidx)
      partObj.layers.push({
        layerIndex: lidx,
        name: entry.name || entry.layerName || '',
        displayName: entry.displayName || entry.name || '',
        entryRef: entry
      })
    }
  }

  // Now convert groupMap into array and sort
  const groupsArray = Array.from(groupMap.values()).map(g => {
    return {
      priority: g.priority,
      parts: Array.from(g.parts.values())
    }
  })

  // Sorting rules:
  // - numeric priorities first in descending numeric order
  // - then string priorities ascending
  // - then null/undefined last
  groupsArray.sort((a, b) => {
    const pa = a.priority, pb = b.priority
    const na = (typeof pa === 'number')
    const nb = (typeof pb === 'number')
    if (na && nb) return pb - pa
    if (na && !nb) return -1
    if (!na && nb) return 1
    if (pa === null && pb !== null) return 1
    if (pb === null && pa !== null) return -1
    // both non-numeric non-null (likely strings) -> lexical
    try {
      return String(pa).localeCompare(String(pb))
    } catch (e) {
      return 0
    }
  })

  return groupsArray
}

/**
 * Apply priority updates to a stack element.
 *
 * updates: array of:
 *   { type: 'layer', partIndex, layerIndex, newPriority }
 *   { type: 'part', partIndex, newPriority } // apply to all layers of this part
 *
 * The function mutates a clone of the provided element and returns it.
 * It does NOT touch other stack elements.
 */
export function applyPriorityUpdatesToStackObject(element, updates = []) {
  if (!element || !Array.isArray(element.data) || !Array.isArray(updates) || updates.length === 0) {
    // return a deep-clone to preserve immutability expectations of caller
    return safeClone(element)
  }

  const newEl = safeClone(element)

  for (const up of updates) {
    try {
      if (!up || typeof up !== 'object') continue
      if (up.type === 'layer') {
        const pidx = Number(up.partIndex)
        const lidx = Number(up.layerIndex)
        const newPriority = up.newPriority === undefined ? null : up.newPriority
        const part = newEl.data && newEl.data[pidx]
        if (!part || !Array.isArray(part.layerEntries)) continue
        const entry = part.layerEntries[lidx]
        if (!entry) continue
        // assign overridePriority without coercing to tag; set isOverridePriority flag if not null
        entry.overridePriority = newPriority
        entry.isOverridePriority = (newPriority !== null && newPriority !== undefined)
      } else if (up.type === 'part') {
        const pidx = Number(up.partIndex)
        const newPriority = up.newPriority === undefined ? null : up.newPriority
        const part = newEl.data && newEl.data[pidx]
        if (!part || !Array.isArray(part.layerEntries)) continue
        for (let l = 0; l < part.layerEntries.length; l++) {
          try {
            const entry = part.layerEntries[l]
            if (!entry) continue
            entry.overridePriority = newPriority
            entry.isOverridePriority = (newPriority !== null && newPriority !== undefined)
          } catch (e) { /* ignore per-entry */ }
        }
      }
    } catch (e) {
      // swallow per-update errors
      continue
    }
  }

  return newEl
}

export default {
  buildPriorityListForStackObject,
  applyPriorityUpdatesToStackObject
}