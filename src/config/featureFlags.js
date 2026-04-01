function readBooleanFlag(name, fallback = false) {
  try {
    const raw = import.meta?.env?.[name]
    if (raw === undefined || raw === null || raw === '') return fallback
    const normalized = String(raw).trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  } catch (e) {
    // Ignore env parsing errors and use fallback.
  }
  return fallback
}

export const STUDIO_FEATURE_FLAGS = Object.freeze({
  ENABLE_FASTPATH_NORMALIZATION: readBooleanFlag('VITE_STUDIO_ENABLE_FASTPATH_NORMALIZATION', true),
  ENABLE_STUDIO_FACADE: readBooleanFlag('VITE_STUDIO_ENABLE_FACADE', true),
  ENABLE_STUDIO_RENDER_PIPELINE: readBooleanFlag('VITE_STUDIO_ENABLE_RENDER_PIPELINE', true),
  ENABLE_RENDER_RECONSTRUCT_FROM_LAYER_ENTRIES: readBooleanFlag('VITE_STUDIO_RENDER_RECONSTRUCT_FROM_LAYER_ENTRIES', false),
  ENABLE_RENDER_SAFETY_TELEMETRY: readBooleanFlag('VITE_STUDIO_ENABLE_RENDER_SAFETY_TELEMETRY', false)
})

export function isFastPathNormalizationEnabled() {
  return STUDIO_FEATURE_FLAGS.ENABLE_FASTPATH_NORMALIZATION
}

export function isStudioFacadeEnabled() {
  return STUDIO_FEATURE_FLAGS.ENABLE_STUDIO_FACADE
}

export function isStudioRenderPipelineEnabled() {
  return STUDIO_FEATURE_FLAGS.ENABLE_STUDIO_RENDER_PIPELINE
}

export function isRenderReconstructFromLayerEntriesEnabled() {
  return STUDIO_FEATURE_FLAGS.ENABLE_RENDER_RECONSTRUCT_FROM_LAYER_ENTRIES
}

export function isRenderSafetyTelemetryEnabled() {
  return STUDIO_FEATURE_FLAGS.ENABLE_RENDER_SAFETY_TELEMETRY
}
