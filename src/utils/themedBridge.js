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
    
    // Check for Themed BC CSS - support both old and new formats
    // Old format: data-themed-bc attribute
    // New format: id="tmd-root"
    const hasThemedCSS = !!(
      document.querySelector('style[data-themed-bc]') ||
      document.querySelector('style#tmd-root')
    )
    
    // Check if Themed BC variables are present with actual values
    const hasThemedVars = checkThemedVariables()
    
    // Consider installed if any indicator is present
    // Priority: ColorsModule > themed CSS tag > actual variables
    const installed = hasColorsModule || hasThemedCSS || hasThemedVars
    
    // Enabled if installed AND has valid color variables
    const enabled = installed && hasThemedVars

    return { installed, enabled }
  } catch (error) {
    console.debug('[vue-wardrobe] Themed BC detection failed:', error)
    return { installed: false, enabled: false }
  }
}

/**
 * Checks if Themed BC CSS variables are present in the document
 * @returns {boolean} True if Themed BC variables are detected with valid values
 */
function checkThemedVariables() {
  try {
    if (!document.documentElement) return false
    
    const computedStyle = getComputedStyle(document.documentElement)
    const tmdMain = computedStyle.getPropertyValue('--tmd-main').trim()
    const tmdAccent = computedStyle.getPropertyValue('--tmd-accent').trim()
    const tmdText = computedStyle.getPropertyValue('--tmd-text').trim()
    
    // Must have at least main background, accent, and text colors for a valid theme
    return tmdMain !== '' && tmdAccent !== '' && tmdText !== ''
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
 * Reads all Themed BC colors and returns them as an object
 * @returns {Object} Object with Themed BC color values
 */
export function readThemedColors() {
  const colors = {}
  
  try {
    if (typeof window === 'undefined' || !document.documentElement) {
      return colors
    }

    const computedStyle = getComputedStyle(document.documentElement)
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
      const value = computedStyle.getPropertyValue(varName).trim()
      if (value) {
        colors[varName] = value
      }
    })
  } catch (error) {
    console.debug('[vue-wardrobe] Failed to read Themed colors:', error)
  }

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

