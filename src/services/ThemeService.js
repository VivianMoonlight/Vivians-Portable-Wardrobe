import { ref, computed, inject, provide } from 'vue'
import { detectThemedBC, getThemedVersion, readThemedColors } from '@/utils/themedBridge'
import { useThemedIntegration } from '@/services/ThemedIntegrationService'

const themeTokensReference = {
  colors: [
    '--color-primary', '--color-primary-hover', '--color-primary-active',
    '--color-secondary', '--color-secondary-hover',
    '--color-bg-base', '--color-bg-surface', '--color-bg-panel', '--color-bg-hover', '--color-bg-active',
    '--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-text-muted', '--color-text-inverse',
    '--color-border-light', '--color-border-base', '--color-border-strong', '--color-border-focus',
    '--color-success', '--color-warning', '--color-error', '--color-error-bg', '--color-info', '--color-info-bg'
  ],
  spacing: ['--space-xs', '--space-sm', '--space-md', '--space-lg', '--space-xl', '--space-xxl'],
  radius: ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-round'],
  sizes: [
    '--button-height-sm', '--button-height-md', '--button-height-lg',
    '--input-height', '--toolbar-height',
    '--icon-size-sm', '--icon-size-md', '--icon-size-lg'
  ],
  transitions: ['--transition-fast', '--transition-base', '--transition-slow', '--transition-easing'],
  typography: [
    '--font-family',
    '--font-size-xs', '--font-size-sm', '--font-size-base', '--font-size-md', '--font-size-lg', '--font-size-xl',
    '--font-weight-normal', '--font-weight-medium', '--font-weight-semibold', '--font-weight-bold'
  ]
}

export const THEME_CONTEXT_KEY = Symbol('theme-context')

// Theme modes: 'light', 'dark', 'themed'
const currentTheme = ref('light')
const isInitialized = ref(false)

let themedIntegration = null

export function useTheme() {
  const initTheme = () => {
    if (isInitialized.value) return

    try {
      const savedTheme = localStorage.getItem('app-theme')
      // Support three modes: light, dark, themed
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'themed') {
        currentTheme.value = savedTheme
      } else {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        currentTheme.value = prefersDark ? 'dark' : 'light'
      }
    } catch (error) {
      console.warn('Failed to initialize theme:', error)
      currentTheme.value = 'light'
    }

    isInitialized.value = true

    // Initialize Themed BC integration
    if (!themedIntegration) {
      themedIntegration = useThemedIntegration()
      themedIntegration.initThemedIntegration()
    }
  }

  const setTheme = (theme) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'themed') {
      console.warn(`Invalid theme: ${theme}. Must be 'light', 'dark', or 'themed'.`)
      return
    }

    currentTheme.value = theme

    try {
      localStorage.setItem('app-theme', theme)
    } catch (error) {
      console.warn('Failed to save theme to localStorage:', error)
    }

    // Theme class will be automatically updated via themeClass() computed property
  }

  const toggleTheme = () => {
    const newTheme = currentTheme.value === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
  }

  const themeClass = () => {
    if (currentTheme.value === 'themed') {
      // Themed mode: always use themed classes if available
      if (themedIntegration && themedIntegration.themedEnabled.value) {
        return 'theme-themed-light' // Can be enhanced to detect theme mode
      }
      // Fallback to light if themed not available
      console.warn('[vue-wardrobe] Themed mode selected but Themed BC not available, falling back to light')
      return 'theme-light'
    }
    // Light or dark mode: always use independent themes
    return `theme-${currentTheme.value}`
  }

  const isDark = () => {
    return currentTheme.value === 'dark'
  }

  const isThemed = () => {
    return currentTheme.value === 'themed'
  }

  const getCSSVar = (varName) => {
    if (typeof window === 'undefined' || !document.documentElement) {
      return ''
    }
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  }

  const detectThemedPlugin = () => {
    return detectThemedBC()
  }

  const getThemedColors = () => {
    if (themedIntegration) {
      return themedIntegration.getThemedColors()
    }
    return readThemedColors()
  }

  const refreshThemedDetection = () => {
    if (themedIntegration) {
      themedIntegration.refreshDetection()
    }
  }

  const getThemedStatus = () => {
    if (themedIntegration) {
      return themedIntegration.getIntegrationStatus()
    }
    const detection = detectThemedBC()
    return {
      detected: detection.installed,
      enabled: detection.enabled,
      version: getThemedVersion(),
      guiOverhaul: false,
      availableColors: 0,
    }
  }

  return {
    currentTheme,
    isInitialized,
    initTheme,
    setTheme,
    toggleTheme,
    themeClass,
    isDark,
    isThemed,
    getCSSVar,
    detectThemedPlugin,
    getThemedColors,
    refreshThemedDetection,
    getThemedStatus,
    tokensReference: themeTokensReference,
  }
}

export function provideTheme(themeComposable) {
  provide(THEME_CONTEXT_KEY, themeComposable)
}

export function injectTheme() {
  const theme = inject(THEME_CONTEXT_KEY, null)

  if (!theme) {
    console.warn('[ThemeService] Theme context not provided. Using fallback.')
    return {
      currentTheme: computed(() => 'light'),
      isInitialized: computed(() => false),
      themeClass: () => 'theme-light',
      toggleTheme: () => console.warn('[ThemeService] Cannot toggle theme - not provided'),
      setTheme: () => console.warn('[ThemeService] Cannot set theme - not provided'),
      initTheme: () => console.warn('[ThemeService] Cannot init theme - not provided'),
      isDark: () => false,
      getCSSVar: () => '',
      detectThemedPlugin: () => ({ installed: false, enabled: false }),
      getThemedColors: () => ({}),
      refreshThemedDetection: () => {},
      getThemedStatus: () => ({
        detected: false,
        enabled: false,
        version: '',
        guiOverhaul: false,
        availableColors: 0,
      }),
      tokensReference: {},
    }
  }

  return theme
}
