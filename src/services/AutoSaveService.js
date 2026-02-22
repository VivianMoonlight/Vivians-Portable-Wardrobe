import { watch, onBeforeUnmount } from 'vue'
import { debounce } from '@/utils/performance.js'

export function useAutoSave(store, options = {}) {
	const {
		debounceMs = 2000,
		watchKeys = ['stacks', 'paletteMap'],
		onSave = null,
		onError = null
	} = options

	const debouncedSave = debounce(async () => {
		if (!store.autoSaveEnabled) {
			return
		}

		try {
			if (typeof store.autoSave === 'function') {
				await store.autoSave()
			} else {
				await store.saveToLocalStorage()
			}
			onSave?.()
		} catch (error) {
			console.error('Auto-save failed:', error)
			onError?.(error)
		}
	}, debounceMs)

	const stopWatchers = watchKeys.map(key =>
		watch(() => store[key], () => {
			if (store.autoSaveEnabled) {
				debouncedSave()
			}
		}, { deep: true })
	)

	onBeforeUnmount(() => {
		stopWatchers.forEach(stop => stop())
		debouncedSave.cancel()
	})

	return {
		forceSave: () => store.autoSave ? store.autoSave() : store.saveToLocalStorage(),
		clearSave: () => store.clearLocalStorage()
	}
}
