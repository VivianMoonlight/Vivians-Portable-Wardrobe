import { onMounted, onUnmounted } from 'vue'

export function useUndoRedo(store, options = {}) {
	const {
		enableLogging = false,
		onUndo = null,
		onRedo = null
	} = options

	const handleKeyDown = (event) => {
		const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
		const modifierKey = isMac ? event.metaKey : event.ctrlKey

		if (!modifierKey) return

		if (event.key === 'z' && !event.shiftKey) {
			event.preventDefault()

			if (!store || typeof store.undo !== 'function') {
				console.warn('[UndoRedoService] Store or undo method not available')
				return
			}

			const success = store.undo()

			if (enableLogging) {
				console.log('[UndoRedoService] Undo:', success ? 'Success' : 'Nothing to undo')
			}

			if (success && onUndo && typeof onUndo === 'function') {
				onUndo()
			}
		}
		else if (event.key === 'z' && event.shiftKey) {
			event.preventDefault()

			if (!store || typeof store.redo !== 'function') {
				console.warn('[UndoRedoService] Store or redo method not available')
				return
			}

			const success = store.redo()

			if (enableLogging) {
				console.log('[UndoRedoService] Redo:', success ? 'Success' : 'Nothing to redo')
			}

			if (success && onRedo && typeof onRedo === 'function') {
				onRedo()
			}
		}
		else if (event.key === 'y' && !isMac && event.ctrlKey) {
			event.preventDefault()

			if (!store || typeof store.redo !== 'function') {
				console.warn('[UndoRedoService] Store or redo method not available')
				return
			}

			const success = store.redo()

			if (enableLogging) {
				console.log('[UndoRedoService] Redo (Ctrl+Y):', success ? 'Success' : 'Nothing to redo')
			}

			if (success && onRedo && typeof onRedo === 'function') {
				onRedo()
			}
		}
	}

	onMounted(() => {
		document.addEventListener('keydown', handleKeyDown)
		if (enableLogging) {
			console.log('[UndoRedoService] Keyboard shortcuts registered')
		}
	})

	onUnmounted(() => {
		document.removeEventListener('keydown', handleKeyDown)
		if (enableLogging) {
			console.log('[UndoRedoService] Keyboard shortcuts unregistered')
		}
	})

	return {
		undo: () => store?.undo?.() || false,
		redo: () => store?.redo?.() || false,
		canUndo: () => store?.canUndo?.() || false,
		canRedo: () => store?.canRedo?.() || false,
		getHistory: () => store?.getHistory?.() || { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 }
	}
}
