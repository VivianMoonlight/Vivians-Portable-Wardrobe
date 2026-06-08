import { useEffect, useState } from 'react'
import { hostWindow } from '@/utils/host-window.js'

/** Matches the original Vue MOBILE_LAYOUT_BREAKPOINT. */
export const MOBILE_LAYOUT_BREAKPOINT = 900

/** True when the page viewport is narrower than the mobile breakpoint. */
export function useIsMobile(breakpoint = MOBILE_LAYOUT_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(
    () => (hostWindow.innerWidth || 1024) < breakpoint,
  )

  useEffect(() => {
    const onResize = () => setIsMobile((hostWindow.innerWidth || 1024) < breakpoint)
    hostWindow.addEventListener('resize', onResize)
    return () => hostWindow.removeEventListener('resize', onResize)
  }, [breakpoint])

  return isMobile
}
