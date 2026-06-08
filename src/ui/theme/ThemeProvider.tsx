import { createContext, useContext, type ReactNode } from 'react'
import { useMantineColorScheme, type MantineColorScheme } from '@mantine/core'

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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { colorScheme, setColorScheme, toggleColorScheme } = useMantineColorScheme()

  const value: ThemeContextValue = {
    colorScheme,
    setColorScheme,
    toggle: () => toggleColorScheme(),
    isDark: colorScheme === 'dark',
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
