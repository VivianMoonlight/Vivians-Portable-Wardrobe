import { useMemo } from 'react'
import { MantineProvider, localStorageColorSchemeManager } from '@mantine/core'
import { I18nextProvider } from 'react-i18next'
import { i18n } from '@/i18n'
import { buildTheme } from '@/ui/theme/theme'
import { ThemeProvider } from '@/ui/theme/ThemeProvider'
import { DialogProvider } from '@/ui/dialog/DialogProvider'
import { App } from '@/ui/App'

interface RootProps {
  /** Shadow-root mount element; used as the CSS-variables scope + portal target. */
  rootEl: HTMLElement
}

const colorSchemeManager = localStorageColorSchemeManager({ key: 'vpw-color-scheme' })

export function Root({ rootEl }: RootProps) {
  const theme = useMemo(() => buildTheme(rootEl), [rootEl])

  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme="light"
      colorSchemeManager={colorSchemeManager}
      // Scope Mantine CSS variables + the color-scheme attribute to the shadow tree.
      getRootElement={() => rootEl}
      cssVariablesSelector="#vpw-root"
    >
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <DialogProvider>
            <App rootEl={rootEl} />
          </DialogProvider>
        </ThemeProvider>
      </I18nextProvider>
    </MantineProvider>
  )
}
