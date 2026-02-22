import { ref, computed, onUnmounted } from 'vue'
import {
  detectThemedBC,
  getThemedVersion,
  isGUIOverhaulMode,
  readThemedColors,
  watchThemedReload,
} from '@/utils/themedBridge'

const themedDetected = ref(false)
const themedEnabled = ref(false)
const themedVersion = ref(null)
const guiOverhaul = ref(false)
const themedColors = ref({})
const isInitialized = ref(false)
let cleanupWatcher = null
let domObserver = null
let retryTimeout = null

// Detection configuration
const INITIAL_DELAY_MS = 100  // Initial delay before first detection
const RETRY_INTERVAL_MS = 500  // Retry interval if not detected
const MAX_RETRIES = 6          // Maximum retry attempts (3 seconds total)
let retryCount = 0

export function useThemedIntegration() {
  const initThemedIntegration = () => {
    if (isInitialized.value) {
      return
    }

    // Mark as initialized immediately to prevent multiple calls
    isInitialized.value = true

    // Delay initial detection to allow Themed BC to load
    setTimeout(() => {
      performDetection()
      
      // If not detected, set up retry mechanism and DOM observer
      if (!themedDetected.value) {
        setupDOMObserver()
        scheduleRetryDetection()
      }
    }, INITIAL_DELAY_MS)
  }

  const performDetection = () => {
    try {
      const detection = detectThemedBC()
      const wasDetected = themedDetected.value
      
      themedDetected.value = detection.installed
      themedEnabled.value = detection.enabled

      themedVersion.value = getThemedVersion()
      guiOverhaul.value = isGUIOverhaulMode()

      if (themedDetected.value && !wasDetected) {
        // Newly detected
        if (themedEnabled.value) {
          console.info('[vue-wardrobe] Themed BC detected and enabled:', {
            version: themedVersion.value,
            guiOverhaul: guiOverhaul.value,
          })
          themedColors.value = readThemedColors()
          setupThemedWatcher()
        } else {
          console.info('[vue-wardrobe] Themed BC detected but not enabled')
        }
        
        // Clean up retry and observer since we found it
        cleanupRetryDetection()
        cleanupDOMObserver()
      } else if (!themedDetected.value && retryCount === 0) {
        // Only log once on initial detection
        console.info('[vue-wardrobe] Themed BC not detected, using default themes')
      }
      
      return detection
    } catch (error) {
      console.debug('[vue-wardrobe] Themed BC detection failed:', error)
      return { installed: false, enabled: false }
    }
  }

  const scheduleRetryDetection = () => {
    if (retryCount >= MAX_RETRIES) {
      console.debug('[vue-wardrobe] Themed BC detection retry limit reached')
      return
    }

    retryTimeout = setTimeout(() => {
      retryCount++
      const detection = performDetection()
      
      if (!detection.installed && retryCount < MAX_RETRIES) {
        scheduleRetryDetection()
      }
    }, RETRY_INTERVAL_MS)
  }

  const cleanupRetryDetection = () => {
    if (retryTimeout) {
      clearTimeout(retryTimeout)
      retryTimeout = null
    }
    retryCount = 0
  }

  const setupDOMObserver = () => {
    // Watch for Themed BC style tag being added to the document
    if (typeof window === 'undefined' || !document.head) return

    domObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check if any added nodes are the Themed BC style tag
          for (const node of mutation.addedNodes) {
            if (
              node.nodeName === 'STYLE' &&
              (node.id === 'tmd-root' || node.hasAttribute('data-themed-bc'))
            ) {
              console.info('[vue-wardrobe] Themed BC style tag detected via DOM observer')
              performDetection()
              cleanupDOMObserver()
              cleanupRetryDetection()
              return
            }
          }
        }
      }
    })

    domObserver.observe(document.head, {
      childList: true,
      subtree: false,
    })
  }

  const cleanupDOMObserver = () => {
    if (domObserver) {
      domObserver.disconnect()
      domObserver = null
    }
  }

  const setupThemedWatcher = () => {
    if (cleanupWatcher) {
      cleanupWatcher()
      cleanupWatcher = null
    }

    cleanupWatcher = watchThemedReload(() => {
      console.info('[vue-wardrobe] Themed BC theme changed, syncing colors...')
      themedColors.value = readThemedColors()
    })
  }

  /**
   * Returns the appropriate theme class name based on Themed BC status
   * @param {string} baseTheme - 'light' or 'dark'
   * @returns {string} CSS class name to apply
   */
  const getThemeClass = (baseTheme) => {
    if (themedEnabled.value) {
      return `theme-themed-${baseTheme}`
    }
    return `theme-${baseTheme}`
  }

  /**
   * Refresh Themed BC detection status
   * Useful when Themed BC might be loaded after app initialization
   */
  const refreshDetection = () => {
    const detection = performDetection()
    
    if (detection.enabled && !cleanupWatcher) {
      setupThemedWatcher()
    } else if (!detection.enabled && cleanupWatcher) {
      cleanupWatcher()
      cleanupWatcher = null
    }
  }

  const getThemedColors = () => {
    return { ...themedColors.value }
  }

  const getIntegrationStatus = () => {
    return {
      detected: themedDetected.value,
      enabled: themedEnabled.value,
      version: themedVersion.value,
      guiOverhaul: guiOverhaul.value,
      availableColors: Object.keys(themedColors.value).length,
    }
  }

  onUnmounted(() => {
    if (cleanupWatcher) {
      cleanupWatcher()
      cleanupWatcher = null
    }
    cleanupRetryDetection()
    cleanupDOMObserver()
  })

  return {
    themedDetected: computed(() => themedDetected.value),
    themedEnabled: computed(() => themedEnabled.value),
    themedVersion: computed(() => themedVersion.value),
    guiOverhaul: computed(() => guiOverhaul.value),
    initThemedIntegration,
    getThemeClass,
    refreshDetection,
    getThemedColors,
    getIntegrationStatus,
  }
}
