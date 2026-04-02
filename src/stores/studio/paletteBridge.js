export function createStudioPaletteBridge(studio, palette) {
  const hasDomain = !!studio && !!palette

  return {
    get paletteSnapshot() {
      return hasDomain ? palette.paletteSnapshot : {}
    },

    get paletteMap() {
      return hasDomain ? palette.paletteMap : {}
    },

    get savedColors() {
      return hasDomain ? palette.savedColors : []
    },

    get paletteModeActive() {
      return hasDomain ? palette.paletteModeActive : false
    },

    get paletteWorkMode() {
      return hasDomain ? palette.paletteWorkMode : 'external'
    },

    get paletteUpdateFlag() {
      return hasDomain ? palette.paletteUpdateFlag : 0
    },

    get activePaletteTargets() {
      return hasDomain ? (studio.activePaletteTargets || []) : []
    }
  }
}

export default createStudioPaletteBridge
