// src/i18n.js
import { createI18n } from 'vue-i18n'

/**
 * 说明：
 * - 使用 import.meta.glob 的 eager 模式在构建阶段把 locales 打包进来，
 *   避免生产环境中动态 import 导致无法按需加载的问题。
 * - 该实现仍会尝试读取 localStorage 中用户设置的语言并回退到浏览器语言或 en。
 */

export async function setupI18n() {
  const supportedLocales = ['en', 'zh']

  // 读取用户已保存的语言（容错）
  let savedLocale = null
  try {
    savedLocale = localStorage.getItem('locale')
  } catch (e) {
    /* ignore */
  }

  // 浏览器语言主项（例如 zh-CN -> zh）
  const navLang = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage))
    ? (navigator.language || navigator.userLanguage).split('-')[0]
    : 'en'

  const initialCandidate = savedLocale || (supportedLocales.includes(navLang) ? navLang : 'en')

  // 使用 import.meta.glob 以 eager 模式在构建时加载所有 json 资源
  // Vite 会把文件内容打包进来，运行时不会发起额外网络请求
  const locales = import.meta.glob('../locales/*.json', { eager: true })

  // 构建 messages 对象，key 为文件名（不含扩展名）
  const messages = {}
  for (const p in locales) {
    // p 示例： '../locales/en.json'，用正则提取文件名
    const m = p.match(/\/([^\/]+)\.json$/)
    if (!m) continue
    const localeKey = m[1]
    messages[localeKey] = locales[p].default || locales[p]
  }

  const initial = (messages[initialCandidate] ? initialCandidate : 'en')

  const i18n = createI18n({
    legacy: false,
    locale: initial,
    fallbackLocale: 'en',
    messages: { [initial]: messages[initial] || messages['en'] }
  })

  // 保存使用的语言（可选）
  try { localStorage.setItem('locale', initial) } catch (e) { /* ignore */ }

  return i18n
}