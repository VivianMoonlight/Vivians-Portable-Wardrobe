const BODY_SLOTS = new Set([
  'Height', 'BodyStyle', 'BodyUpper', 'BodyLower',
  'ArmsLeft', 'ArmsRight', 'HandsLeft', 'HandsRight',
  'Head', 'Eyes', 'Eyes2', 'Eyebrows', 'EyeShadow', 'Mouth', 'Blush',
  'HairFront', 'HairBack', 'FacialHair',
  'Nipples', 'Pussy', 'Penis', 'BodyMarkings', 'FaceMarkings',
  '新前发_Luzi', '新后发_Luzi', '额外头发_Luzi',
  '新前发_Luzi_stack', '新后发_Luzi_stack',
  '左眼_Luzi', '右眼_Luzi', 'BodyMarkings2_Luzi', '身体痕迹_Luzi',
])

const NON_BODY_SLOTS = new Set(['Emoticon', 'Fluids', 'Pronouns', 'Decals'])

/**
 * Classifies the body/face/hair scope of the one-shot appearance shortcuts.
 * Raw BC AssetGroup metadata supports modded body slots; known names also work
 * before asynchronous filter metadata arrives. UI filter categories are not
 * sufficient because their Appearance fallback also contains unknown clothing.
 */
export function isBodySlot(slotKey, groupData) {
  if (typeof slotKey !== 'string' || !slotKey || slotKey.startsWith('Item')) return false
  if (NON_BODY_SLOTS.has(slotKey)) return false
  if (groupData?.Category && groupData.Category !== 'Appearance') return false

  // BC classifies eye makeup as clothing/cosplay despite it being facial appearance.
  if (slotKey === 'EyeShadow') return true
  if (groupData?.Clothing === true) return false
  if (BODY_SLOTS.has(slotKey)) return true

  return groupData?.Category === 'Appearance' && groupData.Clothing === false
}
