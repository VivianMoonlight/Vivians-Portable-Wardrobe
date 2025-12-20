/**
 * Themed BC Bridge Utilities
 * Provides detection and integration functions for Themed BC plugin
 */

/**
 * Detects if Themed BC plugin is installed and active
 * @returns {Object} Detection result with installation and enabled status
 */
export function detectThemedBC() {
  try {
    // Check if window and document are available (for SSR compatibility)
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { installed: false, enabled: false }
    }

    // Check for Themed BC's presence through multiple indicators
    const hasColorsModule = typeof window.ColorsModule !== 'undefined'
    const hasThemedCSS = !!document.querySelector('style[data-themed-bc]')
    const hasThemedVars = checkThemedVariables()

    const installed = hasColorsModule || hasThemedCSS || hasThemedVars
    
    // Check if Themed BC is enabled (has active theme loaded)
    let enabled = false
    if (installed && hasColorsModule && typeof window.ColorsModule.current !== 'undefined') {
      enabled = window.ColorsModule.current !== null
    } else if (hasThemedVars) {
      enabled = true
    }

    return { installed, enabled }
  } catch (error) {
    console.debug('[vue-wardrobe] Themed BC detection failed:', error)
    return { installed: false, enabled: false }
  }
}

/**
 * Checks if Themed BC CSS variables are present in the document
 * @returns {boolean} True if Themed BC variables are detected
 */
function checkThemedVariables() {
  try {
    if (!document.documentElement) return false
    
    const computedStyle = getComputedStyle(document.documentElement)
    const tmdMain = computedStyle.getPropertyValue('--tmd-main').trim()
    
    // If --tmd-main has a value, Themed BC variables are likely present
    return tmdMain !== ''
  } catch (error) {
    return false
  }
}

/**
 * Gets the Themed BC version if available
 * @returns {string|null} Version string or null if not available
 */
export function getThemedVersion() {
  try {
    if (typeof window === 'undefined') return null
    
    // Try to get version from window.ThemedBC or window.ColorsModule
    if (window.ThemedBC && window.ThemedBC.version) {
      return window.ThemedBC.version
    }
    
    if (window.ColorsModule && window.ColorsModule.version) {
      return window.ColorsModule.version
    }
    
    // Check for version in meta tags or other common locations
    const versionMeta = document.querySelector('meta[name="themed-bc-version"]')
    if (versionMeta) {
      return versionMeta.getAttribute('content')
    }
    
    return null
  } catch (error) {
    console.debug('[vue-wardrobe] Failed to get Themed BC version:', error)
    return null
  }
}

/**
 * Checks if Themed BC is in GUI overhaul mode
 * @returns {boolean} True if GUI overhaul mode is active
 */
export function isGUIOverhaulMode() {
  try {
    if (typeof window === 'undefined') return false
    
    // Check for GUI overhaul mode indicators
    if (window.ColorsModule && typeof window.ColorsModule.guiOverhaul === 'boolean') {
      return window.ColorsModule.guiOverhaul
    }
    
    // Check for advanced mode or full mode flags
    if (window.ColorsModule && window.ColorsModule.mode) {
      return window.ColorsModule.mode === 'advanced' || window.ColorsModule.mode === 'full'
    }
    
    return false
  } catch (error) {
    console.debug('[vue-wardrobe] Failed to check GUI overhaul mode:', error)
    return false
  }
}

/**
 * Maps Themed BC CSS variables to vue-wardrobe color variables
 * @param {boolean} isDarkTheme - Whether the current theme is dark
 * @returns {Object} Mapping of vue-wardrobe variables to Themed BC variables with fallbacks
 */
export function mapThemedColors(isDarkTheme = false) {
  // Define fallback colors based on theme
  const lightFallbacks = {
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    bgBase: '#ffffff',
    bgSurface: '#f8fafc',
    bgHover: '#f1f5f9',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textTertiary: '#64748b',
    borderBase: '#e2e8f0',
    success: '#10b981',
    error: '#ef4444',
  }

  const darkFallbacks = {
    primary: '#3b82f6',
    primaryHover: '#60a5fa',
    bgBase: '#0f172a',
    bgSurface: '#1e293b',
    bgHover: '#475569',
    textPrimary: '#f1f5f9',
    textSecondary: '#cbd5e1',
    textTertiary: '#94a3b8',
    borderBase: '#475569',
    success: '#34d399',
    error: '#f87171',
  }

  const fallbacks = isDarkTheme ? darkFallbacks : lightFallbacks

  // Map Themed BC variables to vue-wardrobe variables with fallbacks
  return {
    '--color-primary': { themedVar: '--tmd-accent', fallback: fallbacks.primary },
    '--color-primary-hover': { themedVar: '--tmd-accent-hover', fallback: fallbacks.primaryHover },
    '--color-bg-base': { themedVar: '--tmd-main', fallback: fallbacks.bgBase },
    '--color-bg-surface': { themedVar: '--tmd-element', fallback: fallbacks.bgSurface },
    '--color-bg-hover': { themedVar: '--tmd-element-hover', fallback: fallbacks.bgHover },
    '--color-text-primary': { themedVar: '--tmd-text', fallback: fallbacks.textPrimary },
    '--color-text-secondary': { themedVar: '--tmd-text', fallback: fallbacks.textSecondary },
    '--color-text-tertiary': { themedVar: '--tmd-text-disabled', fallback: fallbacks.textTertiary },
    '--color-border-base': { themedVar: '--tmd-accent', fallback: fallbacks.borderBase },
    '--color-success': { themedVar: '--tmd-equipped', fallback: fallbacks.success },
    '--color-error': { themedVar: '--tmd-blocked', fallback: fallbacks.error },
  }
}

/**
 * Gets the computed value of a Themed BC CSS variable
 * @param {string} varName - CSS variable name (e.g., '--tmd-accent')
 * @returns {string} The computed value or empty string if not found
 */
export function getThemedCSSVar(varName) {
  try {
    if (typeof window === 'undefined' || !document.documentElement) {
      return ''
    }
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  } catch (error) {
    console.debug('[vue-wardrobe] Failed to get Themed BC CSS variable:', varName, error)
    return ''
  }
}

/**
 * Reads all Themed BC colors and returns them as an object
 * @returns {Object} Object with Themed BC color values
 */
export function readThemedColors() {
  const colors = {}
  
  const themedVars = [
    '--tmd-main',
    '--tmd-element',
    '--tmd-element-hover',
    '--tmd-accent',
    '--tmd-accent-hover',
    '--tmd-text',
    '--tmd-text-disabled',
    '--tmd-border',
    '--tmd-equipped',
    '--tmd-blocked',
  ]

  themedVars.forEach(varName => {
    const value = getThemedCSSVar(varName)
    if (value) {
      colors[varName] = value
    }
  })

  return colors
}

// Store original function and callbacks to prevent memory leaks
// Using module-level state is intentional here - we want a single hook
// into ColorsModule.reloadTheme that all instances can subscribe to
let originalReloadTheme = null
let reloadCallbacks = []

// Constants
const THEME_RELOAD_DEBOUNCE_MS = 100

/**
 * Watches for Themed BC theme reload events
 * @param {Function} callback - Function to call when theme reloads
 * @returns {Function} Cleanup function to remove the listener
 */
export function watchThemedReload(callback) {
  try {
    if (typeof window === 'undefined') {
      return () => {}
    }

    // Try to hook into ColorsModule.reloadTheme if available
    if (window.ColorsModule && typeof window.ColorsModule.reloadTheme === 'function') {
      // Only wrap once to prevent memory leaks
      if (!originalReloadTheme) {
        originalReloadTheme = window.ColorsModule.reloadTheme
        
        window.ColorsModule.reloadTheme = function(...args) {
          const result = originalReloadTheme.apply(this, args)
          
          // Call all registered callbacks after theme reloads
          setTimeout(() => {
            reloadCallbacks.forEach(cb => {
              try {
                cb()
              } catch (error) {
                console.debug('[vue-wardrobe] Reload callback error:', error)
              }
            })
          }, THEME_RELOAD_DEBOUNCE_MS)
          
          return result
        }
      }
      
      // Add callback to list
      reloadCallbacks.push(callback)
      
      // Return cleanup function
      return () => {
        reloadCallbacks = reloadCallbacks.filter(cb => cb !== callback)
        
        // If no more callbacks, restore original function
        if (reloadCallbacks.length === 0 && originalReloadTheme) {
          window.ColorsModule.reloadTheme = originalReloadTheme
          originalReloadTheme = null
        }
      }
    }

    // Fallback: use MutationObserver to watch for style changes
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          callback()
          break
        }
      }
    })

    if (document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style'],
      })
    }

    return () => observer.disconnect()
  } catch (error) {
    console.debug('[vue-wardrobe] Failed to set up Themed BC reload watcher:', error)
    return () => {}
  }
}

