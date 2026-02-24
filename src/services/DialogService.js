/**
 * DialogService - Programmatic dialog API
 * 
 * Provides alert, confirm, and prompt functions that work like native browser dialogs
 * but render as in-app modals. The dialogs auto-mount to document.body on first use.
 * 
 * API:
 * - alert(message) -> Promise<void>
 * - confirm(message) -> Promise<boolean>
 * - prompt(message, defaultValue?) -> Promise<string|null>
 */

import { createApp, h, reactive } from 'vue'
import { doc, hostWindow } from '@/utils/host-window.js'

// Dialog state shared between service and component
const dialogState = reactive({
  visible: false,
  type: 'alert', // 'alert' | 'confirm' | 'prompt'
  message: '',
  defaultValue: '',
  resolve: null,
  reject: null
})

let mountedApp = null
let containerElement = null

/**
 * Ensures the dialog component is mounted to document.body
 */
async function ensureDialogMounted() {
  if (mountedApp) return

  // Import the component dynamically to avoid circular dependencies
  const module = await import('@/components/Dialog/DialogModal.vue')
  const DialogModal = module.default

  // Create container
  containerElement = doc.createElement('div')
  containerElement.id = 'vpw-dialog-service-root'
  const teleportHost = doc.getElementById('vpw-teleport-root')
  ;(teleportHost || doc.body).appendChild(containerElement)

  // Create and mount app
  mountedApp = createApp({
    setup() {
      return () => h(DialogModal, { state: dialogState })
    }
  })

  // Use the global i18n instance stored on hostWindow
  if (hostWindow.__APP_I18N__) {
    try {
      // Create i18n plugin wrapper
      const i18nPlugin = {
        install(app) {
          app.config.globalProperties.$i18n = hostWindow.__APP_I18N__
          app.provide('i18n', hostWindow.__APP_I18N__)
        }
      }
      mountedApp.use(i18nPlugin)
    } catch (e) {
      console.warn('Failed to add i18n to dialog service', e)
    }
  }

  mountedApp.mount(containerElement)
}

/**
 * Show a dialog and return a promise that resolves with the result
 */
async function showDialog(type, message, defaultValue = '') {
  await ensureDialogMounted()

  return new Promise((resolve, reject) => {
    dialogState.type = type
    dialogState.message = message
    dialogState.defaultValue = defaultValue
    dialogState.visible = true
    dialogState.resolve = resolve
    dialogState.reject = reject
  })
}

/**
 * Alert dialog - displays a message with an OK button
 * @param {string} message - The message to display
 * @returns {Promise<void>}
 */
export function alert(message) {
  return showDialog('alert', message)
}

/**
 * Confirm dialog - displays a message with OK and Cancel buttons
 * @param {string} message - The message to display
 * @returns {Promise<boolean>} - true if OK was clicked, false if Cancel
 */
export function confirm(message) {
  return showDialog('confirm', message)
}

/**
 * Prompt dialog - displays a message with a text input and OK/Cancel buttons
 * @param {string} message - The message to display
 * @param {string} defaultValue - The default value for the input
 * @returns {Promise<string|null>} - the entered value if OK, null if Cancel
 */
export function prompt(message, defaultValue = '') {
  return showDialog('prompt', message, defaultValue)
}

/**
 * Show an undo toast notification
 * @param {Object} options Configuration options
 * @param {string} options.message - The message to display
 * @param {string} [options.undoLabel] - Label for the undo button (default: "Undo")
 * @param {number} [options.duration] - Auto-dismiss time in ms (default: 5000)
 * @param {Function} [options.onUndo] - Callback when undo is clicked
 * @returns {Function} Function to dismiss the toast manually
 */
export function showUndoToast(options = {}) {
  const {
    message = '',
    undoLabel = 'Undo',
    duration = 5000,
    onUndo = null
  } = options

  // Ensure container exists
  let toastContainer = doc.querySelector('#vpw-toast-container')
  if (!toastContainer) {
    toastContainer = doc.createElement('div')
    toastContainer.id = 'vpw-toast-container'
    toastContainer.className = 'vpw-toast-container'
    doc.body.appendChild(toastContainer)

    // Add styles if not already present
    if (!doc.querySelector('style[data-vpw-toast-styles]')) {
      const styleSheet = doc.createElement('style')
      styleSheet.setAttribute('data-vpw-toast-styles', 'true')
      styleSheet.textContent = `
        .vpw-toast-container {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: 400px;
        }

        .vpw-undo-toast {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 8px;
          padding: 12px 16px;
          color: #f3f4f6;
          font-size: 13px;
          font-weight: 500;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          animation: slideIn 0.2s ease-out;
        }

        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(400px);
            opacity: 0;
          }
        }

        .vpw-toast-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .vpw-toast-message {
          color: #e5e7eb;
          line-height: 1.4;
        }

        .vpw-undo-btn {
          flex-shrink: 0;
          padding: 6px 12px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .vpw-undo-btn:hover {
          background: #2563eb;
          box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);
        }

        .vpw-undo-btn:active {
          transform: scale(0.95);
        }

        .vpw-toast-dismiss {
          flex-shrink: 0;
          width: 24px;
          height: 24px;
          background: none;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          font-size: 16px;
          transition: color 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }

        .vpw-toast-dismiss:hover {
          color: #e5e7eb;
        }
      `
      doc.head.appendChild(styleSheet)
    }
  }

  // Create toast element
  const toast = doc.createElement('div')
  toast.className = 'vpw-undo-toast'
  toast.innerHTML = `
    <div class="vpw-toast-content">
      <div class="vpw-toast-message">${message}</div>
    </div>
    <button class="vpw-undo-btn">${undoLabel}</button>
    <button class="vpw-toast-dismiss" aria-label="Dismiss">✕</button>
  `

  toastContainer.appendChild(toast)

  // State tracking
  let isDismissed = false

  // Handle undo click
  const undoBtn = toast.querySelector('.vpw-undo-btn')
  undoBtn.addEventListener('click', () => {
    if (isDismissed) return
    isDismissed = true
    onUndo?.()
    dismissToast()
  })

  // Handle dismiss click
  const dismissBtn = toast.querySelector('.vpw-toast-dismiss')
  dismissBtn.addEventListener('click', dismissToast)

  // Auto-dismiss after duration
  let dismissTimer = null
  function startAutoTimer() {
    if (duration > 0 && !isDismissed) {
      dismissTimer = setTimeout(dismissToast, duration)
    }
  }

  // Dismiss function
  function dismissToast() {
    if (isDismissed) return
    isDismissed = true

    if (dismissTimer) clearTimeout(dismissTimer)

    // Animate out
    toast.style.animation = 'slideOut 0.2s ease-out'
    toast.addEventListener('animationend', () => {
      toast.remove()
      // Clean up container if empty
      if (toastContainer.children.length === 0) {
        toastContainer.remove()
      }
    }, { once: true })
  }

  startAutoTimer()

  // Return dismiss function for manual control
  return dismissToast
}

// Export the dialog state for the component to use
export { dialogState }
