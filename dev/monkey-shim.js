// Stub for vite-plugin-monkey's virtual `$` module, used only by the local
// dev harness (which runs without the monkey plugin). In the real userscript,
// `$` is provided by monkey and `unsafeWindow` is the page window.
export const unsafeWindow = undefined
