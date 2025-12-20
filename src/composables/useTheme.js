import { ref, computed, watch, inject, provide } from 'vue'
import { detectThemedBC, getThemedVersion, readThemedColors } from '../utils/themedBridge'
import { useThemedIntegration } from './useThemedIntegration'

/**
 * Theme tokens reference
 * Note: These values are defined as CSS variables in src/styles/theme.css
 * This object serves as documentation for available design tokens
 */
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

// Theme context key
export const THEME_CONTEXT_KEY = Symbol('theme-context')

// Theme state
const currentTheme = ref('light')
const isInitialized = ref(false)

// Themed BC integration
let themedIntegration = null

/**
 * Composable for theme management
 * Provides theme switching and persistence functionality
 */
export function useTheme() {
  /**
   * Initialize theme from localStorage or system preference
   */
  const initTheme = () => {
    if (isInitialized.value) return
    
    try {
      // Try to get saved theme from localStorage
      const savedTheme = localStorage.getItem('app-theme')
      if (savedTheme === 'light' || savedTheme === 'dark') {
        currentTheme.value = savedTheme
      } else {
        // Fall back to system preference
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
      
      // Sync with current theme
      themedIntegration.syncWithThemed(currentTheme.value === 'dark')
    }
  }
  
  /**
   * Set the current theme
   * @param {string} theme - 'light' or 'dark'
   */
  const setTheme = (theme) => {
    if (theme !== 'light' && theme !== 'dark') {
      console.warn(`Invalid theme: ${theme}. Must be 'light' or 'dark'.`)
      return
    }
    
    currentTheme.value = theme
    
    // Persist to localStorage
    try {
      localStorage.setItem('app-theme', theme)
    } catch (error) {
      console.warn('Failed to save theme to localStorage:', error)
    }
    
    // Sync with Themed BC if available
    if (themedIntegration) {
      themedIntegration.syncWithThemed(theme === 'dark')
    }
  }
  
  /**
   * Toggle between light and dark themes
   */
  const toggleTheme = () => {
    const newTheme = currentTheme.value === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
  }
  
  /**
   * Get the current theme class name
   */
  const themeClass = () => {
    return `theme-${currentTheme.value}`
  }
  
  /**
   * Check if current theme is dark
   */
  const isDark = () => {
    return currentTheme.value === 'dark'
  }
  
  /**
   * Get CSS variable value from current theme
   * @param {string} varName - CSS variable name (e.g., '--color-primary')
   * @returns {string} The computed value of the CSS variable
   */
  const getCSSVar = (varName) => {
    if (typeof window === 'undefined' || !document.documentElement) {
      return ''
    }
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  }
  
  /**
   * Detect if Themed BC plugin is available
   * @returns {Object} Detection result with installation and enabled status
   */
  const detectThemedPlugin = () => {
    return detectThemedBC()
  }
  
  /**
   * Get Themed BC colors if available
   * @returns {Object} Object with Themed BC color values
   */
  const getThemedColors = () => {
    if (themedIntegration) {
      return themedIntegration.getThemedColors()
    }
    return readThemedColors()
  }
  
  /**
   * Synchronize with Themed BC colors
   * Forces a sync with current Themed BC state
   */
  const syncWithThemed = () => {
    if (themedIntegration) {
      themedIntegration.syncWithThemed(currentTheme.value === 'dark')
    }
  }
  
  /**
   * Toggle Themed BC integration
   * @param {boolean} enabled - Whether to enable Themed BC integration
   */
  const toggleThemedIntegration = (enabled) => {
    if (themedIntegration) {
      themedIntegration.toggleThemedIntegration(enabled)
    }
  }
  
  /**
   * Get Themed BC integration status
   * @returns {Object} Integration status object
   */
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
      usingThemedColors: false,
      availableColors: 0,
    }
  }
  
  return {
    // State
    currentTheme,
    isInitialized,
    
    // Methods
    initTheme,
    setTheme,
    toggleTheme,
    themeClass,
    isDark,
    getCSSVar,
    
    // Themed BC Integration
    detectThemedPlugin,
    getThemedColors,
    syncWithThemed,
    toggleThemedIntegration,
    getThemedStatus,
    
    // Token reference (for documentation)
    tokensReference: themeTokensReference,
  }
}

/**
 * Provide theme context to child components
 * Call this in App.vue setup
 */
export function provideTheme(themeComposable) {
  provide(THEME_CONTEXT_KEY, themeComposable)
}

/**
 * Inject theme context from parent
 * Use this in Teleported components to get theme state
 */
export function injectTheme() {
  const theme = inject(THEME_CONTEXT_KEY, null)
  
  if (!theme) {
    console.warn('[useTheme] Theme context not provided. Using fallback.')
    // Return a complete fallback matching the theme composable interface
    return {
      currentTheme: computed(() => 'light'),
      isInitialized: computed(() => false),
      themeClass: () => 'theme-light',
      toggleTheme: () => console.warn('[useTheme] Cannot toggle theme - not provided'),
      setTheme: () => console.warn('[useTheme] Cannot set theme - not provided'),
      initTheme: () => console.warn('[useTheme] Cannot init theme - not provided'),
      isDark: () => false,
      getCSSVar: () => '',
      detectThemedPlugin: () => ({ installed: false, enabled: false }),
      getThemedColors: () => ({}),
      syncWithThemed: () => {},
      toggleThemedIntegration: () => {},
      getThemedStatus: () => ({
        detected: false,
        enabled: false,
        version: '',
        guiOverhaul: false,
        usingThemedColors: false,
        availableColors: 0,
      }),
      tokensReference: {},
    }
  }
  
  return theme
}
