// BC owns these non-customizable appearance groups. A wardrobe outfit must not
// change them, even when a saved bundle contains values for them.
const HIDDEN_BODY_SLOTS = new Set([
  'Blush', 'ArmsLeft', 'ArmsRight', 'HandsLeft', 'HandsRight', 'Emoticon', 'Fluids',
])

export function isHiddenBodySlot(groupName) {
  return HIDDEN_BODY_SLOTS.has(groupName)
}

/** Keep the live character's protected groups when applying any saved bundle. */
export function preserveHiddenBodySlots(currentBundle = [], requestedBundle = []) {
  const original = new Map()
  for (const part of currentBundle) {
    if (!isHiddenBodySlot(part?.Group)) continue
    if (!original.has(part.Group)) original.set(part.Group, [])
    original.get(part.Group).push(part)
  }

  const result = []
  const inserted = new Set()
  for (const part of requestedBundle) {
    const group = part?.Group
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
