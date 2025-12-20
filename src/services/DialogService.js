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
  doc.body.appendChild(containerElement)

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

// Export the dialog state for the component to use
export { dialogState }
