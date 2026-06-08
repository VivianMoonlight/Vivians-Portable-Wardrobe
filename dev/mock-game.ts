/**
 * Minimal Bondage Club game-environment stubs for local UI smoke testing.
 * Imported for side effects by the dev harness before the app mounts.
 */
const w = window as any

if (!w.Player) {
  w.Player = {
    MemberNumber: 12345,
    Name: 'Tester',
    AssetFamily: 'Female3DCG',
    Appearance: [],
    ExtensionSettings: {},
    OnlineSharedSettings: {},
  }
}

w.CurrentCharacter = w.Player
w.AssetGroupMap = w.AssetGroupMap || new Map()
w.AssetGroup = w.AssetGroup || []
w.Asset = w.Asset || []
w.ItemColorLayerNames = w.ItemColorLayerNames || {}

w.bcModSdk = w.bcModSdk || {
  registerMod: () => ({
    hookFunction: () => {},
    patchFunction: () => {},
    removeHookByName: () => {},
  }),
}

w.ServerPlayerExtensionSettingsSync = w.ServerPlayerExtensionSettingsSync || (() => {})
w.AssetGet = w.AssetGet || (() => null)
w.DrawCharacter = w.DrawCharacter || (() => {})
w.ItemColorLoad = w.ItemColorLoad || (() => {})
w.VPW_Version = 'dev'

export {}
