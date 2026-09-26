import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useMantineColorScheme, type MantineColorScheme } from '@mantine/core'
import { hostWindow } from '@/utils/host-window.js'

/**
 * React replacement for the Vue `ThemeService` (which used ref/computed/inject).
 *
 * Light/Dark are delegated to Mantine's color-scheme system (persisted by the
 * MantineProvider's color-scheme manager in Root). The legacy "themed" mode
 * (colors pulled from the Themed BC plugin) is deferred — see the migration plan.
 */
interface ThemeContextValue {
  colorScheme: MantineColorScheme
  setColorScheme: (scheme: MantineColorScheme) => void
  toggle: () => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children, rootEl }: { children: ReactNode; rootEl: HTMLElement }) {
  // Mantine's default transition guard is inserted into document.head. Our UI
  // lives in a shadow root, so that guard affects the game instead of the UI.
  const { colorScheme, setColorScheme, toggleColorScheme } = useMantineColorScheme({ keepTransitions: true })
  const restoreRef = useRef<() => void>(() => {})

  useEffect(() => () => restoreRef.current(), [])

  const changeScheme = (change: () => void) => {
    restoreRef.current()
    rootEl.setAttribute('data-vpw-switching-theme', '')
    change()

    let secondFrame = 0
    const firstFrame = hostWindow.requestAnimationFrame(() => {
      secondFrame = hostWindow.requestAnimationFrame(() => restore())
    })
    const timeout = hostWindow.setTimeout(() => restore(), 150)
    const restore = () => {
      hostWindow.cancelAnimationFrame(firstFrame)
      hostWindow.cancelAnimationFrame(secondFrame)
      hostWindow.clearTimeout(timeout)
      rootEl.removeAttribute('data-vpw-switching-theme')
    }
    restoreRef.current = restore
  }

  const value: ThemeContextValue = {
    colorScheme,
    setColorScheme: (scheme) => changeScheme(() => setColorScheme(scheme)),
    toggle: () => changeScheme(toggleColorScheme),
    isDark: colorScheme === 'dark',
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
