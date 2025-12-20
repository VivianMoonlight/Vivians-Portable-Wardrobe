/**
 * Filter Group 配置
 * 统一管理所有分组的分类规则和属性
 *
 * 说明：
 * - getGroupDisplayName 会尝试按顺序使用：
 *    1) 已安装的 vue-i18n 实例（若能通过导入 i18n 模块获取到实例并能调用 i18n.global.t）
 *    2) 全局挂载的 i18n 实例（hostWindow__APP_I18N__，如果主程序在创建 i18n 时放到了全局）
 *    3) 本地 JSON 语言包（locales/en.json / locales/zh.json）的 groupNames 字段
 *    4) GROUP_META 中的 displayName 或 groupID（回退值）
 *
 * 这样能兼容多种项目启动方式：既可以在组件中通过 useI18n() 获取到翻译，也能在模块化场景下
 * 在尚未能同步获取到 i18n 实例时安全回退到静态 JSON 翻译或默认名称。
 *
 * 注意：若你项目中的 src/i18n.js 导出的是异步的 setupI18n()（而非默认导出 i18n 实例），
 * 直接在模块中同步获取实例通常不可行。因此此实现同时依赖静态 JSON 作为可靠回退。
 */

import { hostWindow } from '@/utils/host-window.js';

let enLocales = {}
let zhLocales = {}
try {
    // 静态导入本地语言包（便于在没有 i18n 实例时作回退）
    // 这些路径需与项目 locales 目录对应
    // Vite / webpack 都支持直接 import JSON
    // eslint-disable-next-line import/no-unresolved
    enLocales = require('../locales/en.json') || {}
} catch (e) {
    enLocales = {}
}
try {
    // eslint-disable-next-line import/no-unresolved
    zhLocales = require('../locales/zh.json') || {}
} catch (e) {
    zhLocales = {}
}

// Group 元数据配置（displayName 作为默认/英文短语）
export const GROUP_META = {
    Item: {
        displayName: 'Item',
        isHiddenGroup: false,
        priority: 50
    },
    Cosplay: {
        displayName: 'Cosplay',
        isHiddenGroup: false,
        priority: 20
    },
    Hair: {
        displayName: 'Hair',
        isHiddenGroup: false,
        priority: 1
    },
    Headwear: {
        displayName: 'Headwear',
        isHiddenGroup: false,
        priority: 2
    },
    Face: {
        displayName: 'Face',
        isHiddenGroup: false,
        priority: 4
    },
    Markings: {
        displayName: 'Markings / Tattoos',
        isHiddenGroup: false,
        priority: 15
    },
    ClothUpper: {
        displayName: 'Upper Clothing',
        isHiddenGroup: false,
        priority: 6
    },
    ClothLower: {
        displayName: 'Lower Clothing',
        isHiddenGroup: false,
        priority: 7
    },
    Hands: {
        displayName: 'Hands',
        isHiddenGroup: false,
        priority: 8
    },
    Feet: {
        displayName: 'Feet',
        isHiddenGroup: false,
        priority: 9
    },
    Accessories: {
        displayName: 'Accessories',
        isHiddenGroup: false,
        priority: 10
    },
    HiddenBody: {
        displayName: 'Hidden Body Parts',
        isHiddenGroup: true,
        priority: 100
    },
    Appearance: {
        displayName: 'Appearance',
        isHiddenGroup: false,
        priority: 40 // Default fallback, 放在最后
    }
}

// 分组分类规则 - 按优先级排序
// 优先级顺序: Item > BodyCosplay > [新数据分组] > Appearance(default)
export const GROUP_RULES = [
    {
        groupID: 'Hair',
        names: [
            'HairFront',
            'HairBack',
            'FacialHair',
            'Eyebrows',
            '新前发_Luzi',
            '新后发_Luzi',
            '额外头发_Luzi',
            '新前发_Luzi_stack',
            '新后发_Luzi_stack'
        ]
    },
    {
        groupID: 'Headwear',
        names: [
            'Hat',
            'HairAccessory1',
            'HairAccessory2',
            'HairAccessory3',
            'Glasses',
            'Mask',
            'Hat_笨笨蛋Luzi',
            'HairAccessory3_笨笨蛋Luzi',
            'Luzi_HairAccessory3_1',
            'Luzi_HairAccessory3_2',
            'Mask_笨笨蛋Luzi'
        ]
    },
    {
        groupID: 'Face',
        names: [
            'Head',
            'FaceMarkings',
            'Eyes',
            'Eyes2',
            '左眼_Luzi',
            '右眼_Luzi',
            'EyeShadow',
            'Mouth'
        ]
    },
    {
        groupID: 'Markings',
        names: [
            'BodyMarkings',
            'FaceMarkings',
            'Decals',
            'BodyMarkings2_Luzi',
            '身体痕迹_Luzi'
        ]
    },
    {
        groupID: 'ClothUpper',
        names: [
            'ClothOuter',
            'Cloth',
            'Suit',
            'Bra',
            'Corset',
            'Cloth_笨笨蛋Luzi',
            'Cloth_笨笨笨蛋Luzi2',
            'Suit_笨笨蛋Luzi',
            'ClothAccessory_笨笨蛋Luzi',
            'ClothAccessory_笨笨笨蛋Luzi2',
            'Bra_笨笨蛋Luzi',
            '长袖子_Luzi'
        ]
    },
    {
        groupID: 'ClothLower',
        names: [
            'ClothLower',
            'ClothLower_笨笨蛋Luzi',
            'ClothLower_笨笨笨蛋Luzi2',
            'SuitLower',
            'SuitLower_笨笨蛋Luzi',
            'Panties',
            'Panties_笨笨蛋Luzi'
        ]
    },
    {
        groupID: 'Hands',
        names: [
            'Gloves',
            'HandAccessoryLeft',
            'HandAccessoryRight',
            'Gloves_笨笨蛋Luzi',
            'Bracelet'
        ]
    },
    {
        groupID: 'Feet',
        names: [
            'Shoes',
            'Shoes_笨笨蛋Luzi',
            'Socks',
            'SocksRight',
            'SocksLeft',
            'AnkletRight',
            'AnkletLeft',
            'Garters'
        ]
    },
    {
        groupID: 'Accessories',
        names: [
            'ClothAccessory',
            'ClothAccessory_笨笨蛋Luzi',
            'ClothAccessory_笨笨笨蛋Luzi2',
            'Necklace',
            'Necklace_笨笨蛋Luzi',
            'Luzi_Jewelry_0',
            'Jewelry',
            'TailStraps',
            'Wings',
            'Wings_笨笨蛋Luzi'
        ]
    },
    {
        groupID: 'HiddenBody',
        names: [
            'Blush',
            'ArmsLeft',
            'ArmsRight',
            'HandsLeft',
            'HandsRight',
            'Emoticon',
            'Fluids'
        ]
    },
    {
        groupID: 'Item',
        names: [
            'ItemFeet',
            'ItemLegs',
            'ItemVulva',
            'ItemVulvaPiercings',
            'ItemButt',
            'ItemPelvis',
            'ItemTorso',
            'ItemTorso2',
            'ItemNipples',
            'ItemNipplesPiercings',
            'ItemBreast',
            'ItemArms',
            'ItemHands',
            'ItemHandheld',
            'ItemNeck',
            'ItemNeckAccessories',
            'ItemNeckRestraints',
            'ItemMouth',
            'ItemMouth2',
            'ItemMouth3',
            'ItemHead',
            'ItemNose',
            'ItemHood',
            'ItemEars',
            'ItemMisc',
            'ItemDevices',
            'ItemAddon',
            'ItemBoots',
            'ItemScript'
        ]
    }
]

// 构建快速查找 Map: name -> groupID
const _nameToGroupMap = new Map()
GROUP_RULES.forEach(rule => {
    rule.names.forEach(name => {
        _nameToGroupMap.set(name, rule.groupID)
    })
})

/**
 * 根据 data 对象判断其所属分组
 * 优先级: Item > BodyCosplay > [新数据分组] > Appearance(default)
 * @param {Object} data - 包含 Name, Category, BodyCosplay 等属性的对象
 * @returns {string} groupID
 */
export function classifyToGroup(data) {
    if (!data) return 'Appearance'

    const name = data.Name || data.name || ''

    // 1. Item 优先级最高
    if (data.Category === 'Item') {
        return 'Item'
    }

    // 2. BodyCosplay 优先级次高
    if (data.BodyCosplay) {
        return 'Cosplay'
    }

    // 3. 按名称匹配新数据分组
    if (name && _nameToGroupMap.has(name)) {
        return _nameToGroupMap.get(name)
    }

    // 4.  默认归入 Appearance
    return 'Appearance'
}

/**
 * 获取 group 的元数据
 * @param {string} groupID
 * @returns {Object} { displayName, isHiddenGroup, priority }
 */
export function getGroupMeta(groupID) {
    return {
        ...GROUP_META[groupID],
        displayName: getGroupDisplayName(groupID)
    } || {
        displayName: getGroupDisplayName(groupID),
        isHiddenGroup: false,
        priority: 50
    }
}

/**
 * 获取所有可见分组的 ID 列表（按 priority 排序）
 * @returns {string[]}
 */
export function getVisibleGroupIDs() {
    return Object.entries(GROUP_META)
        .filter(([_, meta]) => !meta.isHiddenGroup)
        .sort((a, b) => a[1].priority - b[1].priority)
        .map(([id]) => id)
}

/**
 * 获取所有分组的 ID 列表（按 priority 排序）
 * @returns {string[]}
 */
export function getAllGroupIDs() {
    return Object.entries(GROUP_META)
        .sort((a, b) => a[1].priority - b[1].priority)
        .map(([id]) => id)
}

/**
 * 检查 groupID 是否为隐藏分组
 * @param {string} groupID
 * @returns {boolean}
 */
export function isHiddenGroup(groupID) {
    const meta = GROUP_META[groupID]
    return meta ? !!meta.isHiddenGroup : false
}

/**
 * 获取 group 的显示名称（优先通过 i18n 本地化）
 * 优先顺序：
 *  1) 已安装的 i18n 实例（若能通过导入 i18n 模块或 window 全局获得）
 *  2) locales JSON（en/zh）中的 groupNames
 *  3) GROUP_META 中的 displayName 或 groupID
 *
 * @param {string} groupID
 * @returns {string}
 */
export function getGroupDisplayName(groupID) {
    const meta = GROUP_META[groupID]
    const defaultName = meta ? meta.displayName : groupID

    // 1) 尝试通过导入项目 i18n 模块获取实例并调用全局 t()
    try {
        // 尝试动态 require 项目 i18n 模块（兼容 CommonJS / ESM 环境）
        // 注意：项目的 src/i18n.js 可能导出不同内容（setupI18n 异步函数或直接导出实例）
        // 此处尽量兼容多种情况，但不会触发异步初始化。
        let i18nModule = null
        try {
            // prefer require to avoid bundler hoisting issues in some environments
            // eslint-disable-next-line global-require, import/no-dynamic-require
            i18nModule = require('@/i18n')
        } catch (e) {
            try {
                // fallback to relative path
                // eslint-disable-next-line global-require, import/no-dynamic-require
                i18nModule = require('../i18n')
            } catch (ee) {
                i18nModule = null
            }
        }

        if (i18nModule) {
            // module may export default i18n instance
            const i18nInstance = (i18nModule.default && i18nModule.default.global) ? i18nModule.default
                // or named export 'i18n'
                : (i18nModule.i18n && i18nModule.i18n.global) ? i18nModule.i18n
                    : null

            if (i18nInstance && typeof i18nInstance.global.t === 'function') {
                const key = `groupNames.${groupID}`
                const translated = i18nInstance.global.t(key)
                // 如果翻译存在且不是 key 本身，则返回翻译
                if (translated && translated !== key) return translated
            }
        }
    } catch (e) {
        // ignore errors and continue to fallback
    }

    // 1b) 如果主程序把 i18n 挂到全局（例如 hostWindow__APP_I18N__），尝试使用它
    try {
        const gl = (typeof hostWindow !== 'undefined') ? (hostWindow.__APP_I18N__ || hostWindow.__VUE_I18N_GLOBAL__ || hostWindow.__VUE_I18N__) : null
        if (gl && typeof gl.t === 'function') {
            const key = `groupNames.${groupID}`
            const translated = gl.t(key)
            if (translated && translated !== key) return translated
        }
    } catch (e) {
        // ignore
    }

    // 2) 静态 JSON 回退（根据 saved locale 或浏览器语言选择）
    try {
        let locale = 'en'
        try {
            locale = (typeof localStorage !== 'undefined' && localStorage.getItem('locale')) || locale
        } catch (e) { /* ignore */ }
        if (!locale) {
            const nav = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage))
            locale = nav ? nav.split('-')[0] : 'en'
        }

        const messages = locale === 'zh' ? zhLocales : enLocales
        const translated = messages && messages.groupNames && messages.groupNames[groupID]
        if (translated && translated !== groupID) return translated
    } catch (e) {
        // ignore
    }

    // 最后回退到默认值
    return defaultName
}