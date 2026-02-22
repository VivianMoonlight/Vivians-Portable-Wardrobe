import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { hostWindow, doc } from '@/utils/host-window.js'

export function useWindowDragResize(options = {}) {
	const {
		visible = ref(false),
		minWidth = 320,
		minHeight = 220,
		defaultWidth = 1000,
		defaultHeight = 640,
		defaultMargin = 12,
		mobileBreakpoint = 900,
		focusedZIndex = 10050,
		mobileMargin = 8
	} = options

	const isMobile = ref(false)
	const position = ref({ x: null, y: null })
	const size = ref({ w: defaultWidth, h: defaultHeight })
	const zIndex = ref(focusedZIndex - 100)

	const dragging = ref(false)
	const resizing = ref(false)
	const resizeDir = ref(null)
	const pointerStart = ref({ x: 0, y: 0 })
	const startRect = ref({ x: 0, y: 0, w: 0, h: 0 })

	const margin = computed(() => isMobile.value ? mobileMargin : defaultMargin)

	const panelStyle = computed(() => {
		const computedX = position.value.x !== null
			? position.value.x
			: Math.max(margin.value, Math.round((hostWindow.innerWidth - size.value.w) / 2))
		const computedY = position.value.y !== null
			? position.value.y
			: Math.max(margin.value, Math.round((hostWindow.innerHeight - size.value.h) / 2))

		return {
			width: size.value.w + 'px',
			height: size.value.h + 'px',
			left: computedX + 'px',
			top: computedY + 'px',
			zIndex: zIndex.value,
			position: 'fixed'
		}
	})

	function updateIsMobile() {
		isMobile.value = hostWindow.innerWidth < mobileBreakpoint
	}

	function clampToViewport() {
		const maxW = Math.max(minWidth, hostWindow.innerWidth - margin.value * 2)
		const maxH = Math.max(minHeight, hostWindow.innerHeight - margin.value * 2)
		size.value.w = Math.min(size.value.w, maxW)
		size.value.h = Math.min(size.value.h, maxH)

		if (position.value.x !== null && position.value.y !== null) {
			position.value.x = Math.max(6, Math.min(position.value.x, hostWindow.innerWidth - size.value.w - 6))
			position.value.y = Math.max(6, Math.min(position.value.y, hostWindow.innerHeight - size.value.h - 6))
		}
	}

	function ensureDefaults() {
		if (position.value.x === null || position.value.y === null) {
			const targetW = Math.round(hostWindow.innerWidth * (isMobile.value ? 0.98 : 0.82))
			const targetH = Math.round(hostWindow.innerHeight * (isMobile.value ? 0.9 : 0.72))
			size.value.w = Math.min(size.value.w, hostWindow.innerWidth - margin.value * 2, targetW)
			size.value.h = Math.min(size.value.h, hostWindow.innerHeight - margin.value * 2, targetH)
			position.value.x = Math.max(margin.value, Math.round((hostWindow.innerWidth - size.value.w) / 2))
			position.value.y = Math.max(margin.value, Math.round((hostWindow.innerHeight - size.value.h) / 2))
		} else {
			clampToViewport()
		}
	}

	function bringToFront() {
		zIndex.value = focusedZIndex
	}

	function startDrag(e) {
		if (e.pointerType === 'mouse' && e.button !== 0) return
		if (e.target.closest('button')) return

		dragging.value = true
		pointerStart.value = { x: e.clientX, y: e.clientY }

		const computedLeft = position.value.x !== null
			? position.value.x
			: Math.max(margin.value, Math.round((hostWindow.innerWidth - size.value.w) / 2))
		const computedTop = position.value.y !== null
			? position.value.y
			: Math.max(margin.value, Math.round((hostWindow.innerHeight - size.value.h) / 2))

		startRect.value = { x: computedLeft, y: computedTop, w: size.value.w, h: size.value.h }
		doc.body.style.userSelect = 'none'
		e.target?.setPointerCapture?.(e.pointerId)
	}

	function startResize(dir, e) {
		if (e.pointerType === 'mouse' && e.button !== 0) return

		resizing.value = true
		resizeDir.value = dir
		pointerStart.value = { x: e.clientX, y: e.clientY }

		const computedLeft = position.value.x !== null
			? position.value.x
			: Math.max(margin.value, Math.round((hostWindow.innerWidth - size.value.w) / 2))
		const computedTop = position.value.y !== null
			? position.value.y
			: Math.max(margin.value, Math.round((hostWindow.innerHeight - size.value.h) / 2))

		startRect.value = { x: computedLeft, y: computedTop, w: size.value.w, h: size.value.h }
		doc.body.style.userSelect = 'none'
		e.target?.setPointerCapture?.(e.pointerId)
	}

	function onPointerMove(e) {
		if (!visible.value) return
		const dx = e.clientX - pointerStart.value.x
		const dy = e.clientY - pointerStart.value.y

		if (dragging.value) {
			let nx = startRect.value.x + dx
			let ny = startRect.value.y + dy
			nx = Math.max(6, Math.min(nx, hostWindow.innerWidth - startRect.value.w - 6))
			ny = Math.max(6, Math.min(ny, hostWindow.innerHeight - startRect.value.h - 6))
			position.value.x = nx
			position.value.y = ny
		} else if (resizing.value) {
			const dir = resizeDir.value || ''
			let nx = startRect.value.x
			let ny = startRect.value.y
			let nw = startRect.value.w
			let nh = startRect.value.h

			if (dir.includes('left')) {
				nw = Math.max(minWidth, startRect.value.w - dx)
				nx = startRect.value.x + (startRect.value.w - nw)
			}
			if (dir.includes('right')) {
				nw = Math.max(minWidth, startRect.value.w + dx)
			}
			if (dir.includes('top')) {
				nh = Math.max(minHeight, startRect.value.h - dy)
				ny = startRect.value.y + (startRect.value.h - nh)
			}
			if (dir.includes('bottom')) {
				nh = Math.max(minHeight, startRect.value.h + dy)
			}

			nx = Math.max(6, Math.min(nx, hostWindow.innerWidth - 64))
			ny = Math.max(6, Math.min(ny, hostWindow.innerHeight - 64))
			nw = Math.min(nw, hostWindow.innerWidth - nx - 6)
			nh = Math.min(nh, hostWindow.innerHeight - ny - 6)

			position.value.x = nx
			position.value.y = ny
			size.value.w = nw
			size.value.h = nh
		}
	}

	function onPointerUp() {
		if (dragging.value || resizing.value) {
			dragging.value = false
			resizing.value = false
			resizeDir.value = null
			doc.body.style.userSelect = ''
		}
	}

	function onWindowResize() {
		updateIsMobile()
		if (!visible.value) return
		clampToViewport()
	}

	onMounted(() => {
		updateIsMobile()
		hostWindow.addEventListener('pointermove', onPointerMove, { passive: true })
		hostWindow.addEventListener('pointerup', onPointerUp, { passive: true })
		hostWindow.addEventListener('resize', onWindowResize)
	})

	onBeforeUnmount(() => {
		hostWindow.removeEventListener('pointermove', onPointerMove)
		hostWindow.removeEventListener('pointerup', onPointerUp)
		hostWindow.removeEventListener('resize', onWindowResize)
	})

	watch(() => visible.value, (v) => {
		if (v) {
			updateIsMobile()
			ensureDefaults()
			bringToFront()
		}
	}, { immediate: true })

	return {
		isMobile,
		position,
		size,
		zIndex,
		panelStyle,
		dragging,
		resizing,
		startDrag,
		startResize,
		bringToFront,
		updateIsMobile,
		ensureDefaults
	}
}
