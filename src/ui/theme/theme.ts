import { createTheme, type MantineThemeOverride } from '@mantine/core'

/**
 * Build the Mantine theme.
 *
 * The whole UI lives inside a Shadow DOM. Mantine portals (Modal, Tooltip,
 * Menu, Popover, …) default to `document.body`, which is OUTSIDE the shadow
 * root and therefore unstyled. We override the Portal target to the shadow
 * mount element so portalled content stays inside the isolated tree.
 *
 * See: https://github.com/orgs/mantinedev/discussions/5224
 */
export function buildTheme(portalTarget: HTMLElement): MantineThemeOverride {
  return createTheme({
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    primaryColor: 'blue',
    colors: {
      dark: [
        '#f4f7fb',
        '#dce4ef',
        '#b7c4d8',
        '#8798b1',
        '#5f7088',
        '#435169',
        '#30394d',
        '#242b3a',
        '#1a1f2c',
        '#111620',
      ],
    },
    components: {
      Portal: {
        defaultProps: { target: portalTarget },
      },
      Modal: {
        styles: {
          content: {
            backgroundColor: 'var(--mantine-color-body)',
            color: 'var(--mantine-color-text)',
          },
          header: {
            backgroundColor: 'var(--mantine-color-body)',
            color: 'var(--mantine-color-text)',
            borderBottom: '1px solid var(--mantine-color-default-border)',
          },
        },
      },
      Paper: {
        styles: {
          root: {
            color: 'var(--mantine-color-text)',
          },
        },
      },
      Button: {
        styles: {
          root: {
            fontWeight: 600,
          },
        },
      },
      TextInput: {
        styles: {
          input: {
            color: 'var(--mantine-color-text)',
            backgroundColor: 'var(--mantine-color-body)',
          },
        },
      },
      SegmentedControl: {
        styles: {
          root: {
            color: 'var(--mantine-color-text)',
          },
          label: {
            color: 'var(--mantine-color-text)',
          },
        },
      },
    },
  })
}
