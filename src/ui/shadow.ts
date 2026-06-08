import mantineCss from '@mantine/core/styles.css?inline'
import { doc } from '@/utils/host-window.js'

export interface ShadowHost {
  /** The host element appended to the page body. */
  host: HTMLElement
  /** The attached (open) shadow root. */
  shadow: ShadowRoot
  /** The React mount element inside the shadow root (id `vpw-root`). */
  mountEl: HTMLElement
}

/** Minimal reset + base so the isolated UI does not inherit page quirks. */
const BASE_CSS = `
:host {
  all: initial;
}
#vpw-root {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.5;
}
#vpw-root *,
#vpw-root *::before,
#vpw-root *::after {
  box-sizing: border-box;
}
#vpw-root {
  scrollbar-color: var(--mantine-color-gray-5) transparent;
  scrollbar-width: thin;
}
#vpw-root * {
  scrollbar-color: var(--mantine-color-gray-5) transparent;
  scrollbar-width: thin;
}
#vpw-root ::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
#vpw-root ::-webkit-scrollbar-track {
  background: transparent;
}
#vpw-root ::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--mantine-color-gray-5) 68%, transparent);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
}
#vpw-root ::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--mantine-color-blue-5) 72%, transparent);
  background-clip: content-box;
}
`

/**
 * Create the Shadow DOM host for the wardrobe UI.
 *
 * All UI CSS (Mantine + base reset) is injected as a `<style>` INSIDE the
 * shadow root so it is fully isolated from — and cannot be overridden by —
 * the host game page. Mantine's runtime CSS-variables `<style>` is rendered by
 * `MantineProvider` into the React tree (i.e. also inside this shadow root).
 */
export function createShadowHost(hostId: string): ShadowHost {
  const host = doc.createElement('div')
  host.id = hostId
  // The host itself must not create a stacking/layout context that shifts the page.
  host.style.position = 'relative'
  host.style.zIndex = '2147483647'
  doc.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  const style = doc.createElement('style')
  style.textContent = `${BASE_CSS}\n${mantineCss}`
  shadow.appendChild(style)

  const mountEl = doc.createElement('div')
  mountEl.id = 'vpw-root'
  shadow.appendChild(mountEl)

  return { host, shadow, mountEl }
}
