/**
 * Composable for responsive behavior
 * Handles mobile detection and tab switching for mobile layouts
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { hostWindow } from '@/utils/host-window.js'

export function useResponsive(breakpoint = 900) {
  const isMobile = ref(false)
  const mobileTab = ref('preview')

  function updateIsMobile() {
    isMobile.value = hostWindow.innerWidth < breakpoint
  }

  function onWindowResize() {
    updateIsMobile()
  }

  onMounted(() => {
    updateIsMobile()
    hostWindow.addEventListener('resize', onWindowResize)
  })

  onBeforeUnmount(() => {
    hostWindow.removeEventListener('resize', onWindowResize)
  })

  return {
    isMobile,
    mobileTab,
    updateIsMobile
  }
}
