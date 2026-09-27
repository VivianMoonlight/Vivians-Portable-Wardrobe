// BC owns these non-customizable appearance groups. A wardrobe outfit must not
// change them, even when a saved bundle contains values for them.
const HIDDEN_BODY_SLOTS = new Set([
  'Blush', 'ArmsLeft', 'ArmsRight', 'HandsLeft', 'HandsRight', 'Emoticon', 'Fluids',
])

export function isHiddenBodySlot(groupName) {
  return HIDDEN_BODY_SLOTS.has(groupName)
}

function groupName(part) {
  return typeof part?.Group === 'string' ? part.Group : part?.Asset?.Group?.Name
}

/** Keep the live character's protected groups when applying any saved bundle. */
export function preserveHiddenBodySlots(currentBundle = [], requestedBundle = []) {
  const original = new Map()
  for (const part of currentBundle) {
    const group = groupName(part)
    if (!isHiddenBodySlot(group)) continue
    if (!original.has(group)) original.set(group, [])
    original.get(group).push(part)
  }

  const result = []
  const inserted = new Set()
  for (const part of requestedBundle) {
    const group = groupName(part)
    if (!isHiddenBodySlot(group)) {
      result.push(part)
      continue
    }
    if (inserted.has(group)) continue
    inserted.add(group)
    result.push(...(original.get(group) || []))
  }
  for (const [group, parts] of original) {
    if (!inserted.has(group)) result.push(...parts)
  }
  return result
}
