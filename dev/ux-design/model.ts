export const clothingSlots = ['top', 'bottom', 'shoes', 'outer'] as const;
export const allSlots = [...clothingSlots, 'hair', 'body'] as const;

export type Slot = (typeof allSlots)[number];
export type Scope = 'clothing' | 'all' | 'custom';

export interface Item {
  id: string;
  name: string;
  color: string;
}

export type Appearance = Record<Slot, Item | null>;

export interface Outfit {
  id: string;
  name: string;
  path: string;
  tags: string[];
  collection: '日常' | '正式';
  favorite: boolean;
  slots: Appearance;
}

export const slotLabels: Record<Slot, string> = {
  top: '上衣',
  bottom: '下装',
  shoes: '鞋子',
  outer: '外套',
  hair: '发型',
  body: '身体',
};

const warmSkin: Item = { id: 'body-warm', name: '暖调肤色', color: '#D7A786' };
const neutralSkin: Item = { id: 'body-neutral', name: '自然肤色', color: '#E5BFA4' };
const darkLongHair: Item = { id: 'hair-long-dark', name: '深棕长发', color: '#443329' };

export const initialAppearance: Appearance = {
  top: { id: 'top-knit-cocoa', name: '可可针织衫', color: '#9D7661' },
  bottom: { id: 'bottom-trouser-navy', name: '海军蓝长裤', color: '#3A465B' },
  shoes: { id: 'shoes-sneaker-ivory', name: '米白运动鞋', color: '#F1EAE0' },
  outer: { id: 'outer-jacket-sand', name: '沙色短外套', color: '#C6B39A' },
  hair: darkLongHair,
  body: warmSkin,
};

export const outfits: Outfit[] = [
  {
    id: 'outfit-cream-knit',
    name: '奶油针织',
    path: '我的衣橱 / 日常 / 奶油针织',
    tags: ['针织', '温柔', '秋日'],
    collection: '日常',
    favorite: true,
    slots: {
      top: { id: 'top-knit-cream', name: '奶油针织衫', color: '#E9DBC5' },
      bottom: { id: 'bottom-skirt-camel', name: '焦糖半身裙', color: '#AE8060' },
      shoes: { id: 'shoes-flat-cocoa', name: '可可芭蕾鞋', color: '#79584A' },
      outer: null,
      hair: { id: 'hair-long-chestnut', name: '栗色长发', color: '#704C37' },
      body: neutralSkin,
    },
  },
  {
    id: 'outfit-weekend',
    name: '周末轻行',
    path: '我的衣橱 / 日常 / 周末轻行',
    tags: ['休闲', '裤装', '出游'],
    collection: '日常',
    favorite: false,
    slots: {
      top: { id: 'top-shirt-sage', name: '鼠尾草绿衬衫', color: '#A6B5A0' },
      bottom: { id: 'bottom-trouser-denim', name: '浅蓝牛仔裤', color: '#7494AC' },
      shoes: { id: 'shoes-sneaker-ivory', name: '米白运动鞋', color: '#F1EAE0' },
      outer: null,
      hair: { id: 'hair-short-dark', name: '深棕短发', color: '#443329' },
      body: warmSkin,
    },
  },
  {
    id: 'outfit-city',
    name: '暮色通勤',
    path: '我的衣橱 / 日常 / 暮色通勤',
    tags: ['通勤', '裤装', '简约'],
    collection: '日常',
    favorite: true,
    slots: {
      top: { id: 'top-shirt-pearl', name: '珍珠白衬衫', color: '#EBE9E1' },
      bottom: { id: 'bottom-trouser-charcoal', name: '炭灰西装裤', color: '#53545C' },
      shoes: { id: 'shoes-loafer-black', name: '黑色乐福鞋', color: '#333239' },
      outer: { id: 'outer-coat-slate', name: '石板灰外套', color: '#727780' },
      hair: { id: 'hair-short-black', name: '黑色短发', color: '#2B282B' },
      body: neutralSkin,
    },
  },
  {
    id: 'outfit-rose-tea',
    name: '玫瑰下午茶',
    path: '我的衣橱 / 日常 / 玫瑰下午茶',
    tags: ['约会', '裙装', '柔和'],
    collection: '日常',
    favorite: false,
    slots: {
      top: { id: 'top-blouse-rose', name: '雾玫瑰上衣', color: '#BD8B91' },
      bottom: { id: 'bottom-skirt-ivory', name: '象牙白半身裙', color: '#E9DDCA' },
      shoes: { id: 'shoes-flat-burgundy', name: '酒红平底鞋', color: '#7F4651' },
      outer: { id: 'outer-jacket-sand', name: '沙色短外套', color: '#C6B39A' },
      hair: darkLongHair,
      body: warmSkin,
    },
  },
  {
    id: 'outfit-midnight',
    name: '午夜晚宴',
    path: '我的衣橱 / 正式 / 午夜晚宴',
    tags: ['晚宴', '裙装', '丝缎'],
    collection: '正式',
    favorite: true,
    slots: {
      top: { id: 'top-satin-black', name: '墨黑缎面上衣', color: '#353139' },
      bottom: { id: 'bottom-skirt-wine', name: '酒红长裙', color: '#7D3F51' },
      shoes: { id: 'shoes-heel-black', name: '黑色高跟鞋', color: '#29262C' },
      outer: null,
      hair: { id: 'hair-long-black', name: '黑色长发', color: '#29262C' },
      body: neutralSkin,
    },
  },
  {
    id: 'outfit-moonlight',
    name: '月光礼服',
    path: '我的衣橱 / 正式 / 月光礼服',
    tags: ['典礼', '裙装', '优雅'],
    collection: '正式',
    favorite: false,
    slots: {
      top: { id: 'top-satin-silver', name: '银灰缎面上衣', color: '#C4C9D1' },
      bottom: { id: 'bottom-skirt-midnight', name: '午夜蓝长裙', color: '#414D70' },
      shoes: { id: 'shoes-heel-silver', name: '银色高跟鞋', color: '#B1B7C4' },
      outer: { id: 'outer-bolero-silver', name: '银灰短外套', color: '#9EA7BA' },
      hair: { id: 'hair-long-ash', name: '雾棕长发', color: '#77685E' },
      body: neutralSkin,
    },
  },
];

export interface SlotChange {
  slot: Slot;
  before: Item | null;
  after: Item | null;
  action: 'replace' | 'clear' | 'keep';
  changed: boolean;
}

export interface PreviewResult {
  appearance: Appearance;
  changes: SlotChange[];
}

/**
 * Build a preview without modifying the current appearance or saved outfit.
 * Clothing merges saved garments; all/custom may clear selected optional slots.
 * A missing saved body always keeps the current body.
 */
export function buildPreview(
  current: Appearance,
  outfit: Outfit,
  scope: Scope,
  customSlots: readonly Slot[] = [],
): PreviewResult {
  const selected = new Set<Slot>(
    scope === 'all' ? allSlots : scope === 'clothing' ? clothingSlots : customSlots,
  );
  const appearance: Appearance = { ...current };
  const changes = allSlots.map((slot): SlotChange => {
    const before = current[slot];
    const saved = outfit.slots[slot] ?? null;
    // The default clothing action preserves unsaved garments. Explicit all/custom
    // scopes may clear optional slots, while body can only be replaced.
    const preserveMissing = saved === null && (scope === 'clothing' || slot === 'body');
    const after = selected.has(slot) && !preserveMissing ? saved : before;
    const changed = !sameItem(before, after);
    appearance[slot] = after;
    return {
      slot,
      before,
      after,
      action: !changed ? 'keep' : after === null ? 'clear' : 'replace',
      changed,
    };
  });
  return { appearance, changes };
}

function sameItem(left: Item | null, right: Item | null): boolean {
  return left === right || (
    left !== null && right !== null &&
    left.id === right.id && left.name === right.name && left.color === right.color
  );
}
