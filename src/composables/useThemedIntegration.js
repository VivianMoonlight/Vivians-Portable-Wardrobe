/**
 * Themed BC Integration Composable
 * Manages seamless integration with Themed BC plugin
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  detectThemedBC,
  getThemedVersion,
  isGUIOverhaulMode,
  readThemedColors,
  watchThemedReload,
  mapThemedColors,
} from '../utils/themedBridge'

// Shared state across all instances
// This is intentional - we want a single integration instance managing Themed BC
// to avoid multiple watchers and potential conflicts
const themedDetected = ref(false)
const themedEnabled = ref(false)
const themedVersion = ref(null)
const guiOverhaul = ref(false)
const themedColors = ref({})
const useThemedColors = ref(false)
const isInitialized = ref(false)
let cleanupWatcher = null

/**
 * Composable for Themed BC integration
 * Provides automatic detection and synchronization with Themed BC plugin
 */
export function useThemedIntegration() {
  /**
   * Initialize Themed BC detection and setup watchers
   * Safe to call multiple times - will only initialize once
   */
  const initThemedIntegration = () => {
    // Prevent multiple initializations
    if (isInitialized.value) {
      return
    }
    
    try {
      // Detect Themed BC
      const detection = detectThemedBC()
      themedDetected.value = detection.installed
      themedEnabled.value = detection.enabled
      
      // Get version and mode info
      themedVersion.value = getThemedVersion()
      guiOverhaul.value = isGUIOverhaulMode()
      
      // Mark as initialized
      isInitialized.value = true
      
      // Log detection status (informative, not error)
      if (themedDetected.value) {
        console.info('[vue-wardrobe] Themed BC detected:', {
          enabled: themedEnabled.value,
          version: themedVersion.value,
          guiOverhaul: guiOverhaul.value,
        })
        
        // Read current colors if enabled
        if (themedEnabled.value) {
          themedColors.value = readThemedColors()
          
          // Auto-enable Themed BC colors if plugin is active
          useThemedColors.value = true
          
          // Setup watcher for theme changes
          setupThemedWatcher()
        }
      } else {
        console.info('[vue-wardrobe] Themed BC not detected, using default themes')
      }
    } catch (error) {
      console.debug('[vue-wardrobe] Themed BC initialization failed:', error)
      themedDetected.value = false
      themedEnabled.value = false
      isInitialized.value = true
    }
  }

  /**
   * Setup watcher for Themed BC theme changes
   */
  const setupThemedWatcher = () => {
    // Clean up existing watcher if any
    if (cleanupWatcher) {
      cleanupWatcher()
      cleanupWatcher = null
    }

    // Setup new watcher
    cleanupWatcher = watchThemedReload(() => {
      console.info('[vue-wardrobe] Themed BC theme changed, syncing colors...')
      
      // Re-read colors (readThemedColors() already returns a new object, triggering reactivity)
      themedColors.value = readThemedColors()
    })
  }

  /**
   * Apply Themed BC colors to document root
   * @param {boolean} isDarkTheme - Whether current theme is dark
   */
  const applyThemedColors = (isDarkTheme = false) => {
    if (!useThemedColors.value || !themedEnabled.value) {
      return
    }

    try {
      const mapping = mapThemedColors(isDarkTheme)
      const root = document.documentElement

      Object.entries(mapping).forEach(([vueVar, { themedVar, fallback }]) => {
        // Get Themed BC variable value
        const themedValue = themedColors.value[themedVar]
        
        if (themedValue) {
          // Apply Themed BC color
          root.style.setProperty(vueVar, themedValue)
        } else {
          // Use fallback if Themed BC variable not available
          root.style.setProperty(vueVar, fallback)
        }
      })

      console.debug('[vue-wardrobe] Applied Themed BC colors')
    } catch (error) {
      console.warn('[vue-wardrobe] Failed to apply Themed BC colors:', error)
    }
  }

  /**
   * Reset to default theme colors
   */
  const resetToDefaultColors = () => {
    try {
      const root = document.documentElement
      const mapping = mapThemedColors()

      // Remove inline styles to restore CSS defaults
      Object.keys(mapping).forEach(vueVar => {
        root.style.removeProperty(vueVar)
      })

      console.debug('[vue-wardrobe] Reset to default theme colors')
    } catch (error) {
      console.warn('[vue-wardrobe] Failed to reset colors:', error)
    }
  }

  /**
   * Toggle Themed BC integration on/off
   * @param {boolean} enabled - Whether to enable Themed BC integration
   */
  const toggleThemedIntegration = (enabled) => {
    if (!themedDetected.value) {
      console.warn('[vue-wardrobe] Cannot toggle Themed BC integration: plugin not detected')
      return
    }

    useThemedColors.value = enabled

    if (enabled && themedEnabled.value) {
      // Re-read colors and apply
      themedColors.value = readThemedColors()
      applyThemedColors()
      
      // Setup watcher if not already set
      if (!cleanupWatcher) {
        setupThemedWatcher()
      }
    } else {
      // Reset to defaults
      resetToDefaultColors()
    }
  }

  /**
   * Synchronize with current Themed BC state
   * Call this when vue-wardrobe theme changes
   * @param {boolean} isDarkTheme - Whether current theme is dark
   */
  const syncWithThemed = (isDarkTheme = false) => {
    if (useThemedColors.value && themedEnabled.value) {
      applyThemedColors(isDarkTheme)
    } else {
      resetToDefaultColors()
    }
  }

  /**
   * Get current Themed BC colors for inspection
   * @returns {Object} Current Themed BC colors
   */
  const getThemedColors = () => {
    return { ...themedColors.value }
  }

  /**
   * Get Themed BC integration status
   * @returns {Object} Integration status object
   */
  const getIntegrationStatus = () => {
    return {
      detected: themedDetected.value,
      enabled: themedEnabled.value,
      version: themedVersion.value,
      guiOverhaul: guiOverhaul.value,
      usingThemedColors: useThemedColors.value,
      availableColors: Object.keys(themedColors.value).length,
    }
  }

  // Cleanup on unmount
  onUnmounted(() => {
    if (cleanupWatcher) {
      cleanupWatcher()
      cleanupWatcher = null
    }
  })

  return {
    // State
    themedDetected: computed(() => themedDetected.value),
    themedEnabled: computed(() => themedEnabled.value),
    themedVersion: computed(() => themedVersion.value),
    guiOverhaul: computed(() => guiOverhaul.value),
    useThemedColors: computed(() => useThemedColors.value),

    // Methods
    initThemedIntegration,
    applyThemedColors,
    resetToDefaultColors,
    toggleThemedIntegration,
    syncWithThemed,
    getThemedColors,
    getIntegrationStatus,
  }
}
