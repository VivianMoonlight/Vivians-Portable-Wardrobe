/// <reference types="vite/client" />
/// <reference types="vite-plugin-monkey/client" />

// CSS imported as a raw string for manual injection into the Shadow DOM.
declare module '*.css?inline' {
  const css: string
  export default css
}

declare module '*?inline' {
  const content: string
  export default content
}
