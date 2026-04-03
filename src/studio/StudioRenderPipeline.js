function now() {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now()
    }
  } catch (e) {
    // Ignore timer errors and fallback to Date.now.
  }
  return Date.now()
}

function withStage(timings, stageName, fn) {
  const start = now()
  const result = fn()
  timings[stageName] = +(now() - start).toFixed(3)
  return result
}

export class StudioRenderPipeline {
  constructor({ assetApi, paletteService } = {}) {
    this.assetApi = assetApi
    this.paletteService = paletteService
  }

  render(input = {}) {
    const timings = {}
    const startedAt = now()

    const composed = withStage(timings, 'composeInput', () => this.composeInput(input))
    const normalized = withStage(timings, 'normalizeBundle', () => this.normalizeBundle(composed))
    const diffed = withStage(timings, 'diffAndApply', () => this.diffAndApply(normalized))
    const refreshed = withStage(timings, 'refreshCharacter', () => this.refreshCharacter(diffed))
    const drawn = withStage(timings, 'draw', () => this.draw(refreshed))

    return {
      mergedAppearanceData: drawn?.mergedAppearanceData || normalized?.mergedAppearanceData || null,
      stats: {
        totalMs: +(now() - startedAt).toFixed(3),
        timings,
        stages: ['composeInput', 'normalizeBundle', 'diffAndApply', 'refreshCharacter', 'draw']
      }
    }
  }

  composeInput(input = {}) {
    const stacks = Array.isArray(input.stacks) ? input.stacks : []
    const reconstructStacks = (typeof input.reconstructStacks === 'function')
      ? input.reconstructStacks
      : (items) => items

    return {
      activeRenderer: input.activeRenderer || null,
      previousMergedAppearanceData: input.previousMergedAppearanceData || null,
      paletteMap: input.paletteMap || {},
      reconstructedStacks: reconstructStacks(stacks)
    }
  }

  normalizeBundle(ctx = {}) {
    const reconstructedStacks = Array.isArray(ctx.reconstructedStacks) ? ctx.reconstructedStacks : []
    const unexpandedBundle = {
      data: this.assetApi.stackOutfitData(reconstructedStacks),
      type: 'outfit'
    }

    return {
      ...ctx,
      unexpandedBundle,
      mergedAppearanceData: this.paletteService.expandedAppearanceForRendering(unexpandedBundle, ctx.paletteMap || {})
    }
  }

  diffAndApply(ctx = {}) {
    try {
      ctx.activeRenderer?.removeCanvas?.(ctx.previousMergedAppearanceData)
    } catch (e) {
      console.warn(e)
    }
    return ctx
  }

  refreshCharacter(ctx = {}) {
    // Character refresh is currently handled inside renderer implementations.
    return ctx
  }

  draw(ctx = {}) {
    ctx.activeRenderer?.renderPreviewWithItem?.(ctx.mergedAppearanceData)
    return ctx
  }
}

export function createStudioRenderPipeline(deps = {}) {
  return new StudioRenderPipeline(deps)
}
