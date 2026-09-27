import { createWardrobeIndex, projectWardrobeCloudIndex } from './wardrobe-index.js'

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))

/** GET before each write: a failed PUT may already have committed on the server. */
export async function syncCloudflareRepository(repository, client, key,
  { maxAttempts = 5, isActive = () => true } = {}) {
  const ensureActive = () => {
    if (!isActive()) throw Object.assign(new Error('Cloudflare sync was interrupted'),
      { code: 'cloudflare-cancelled' })
  }
  let observed = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    ensureActive()
    const remote = observed || await client.read(key)
    ensureActive()
    observed = null
    const remoteIndex = remote.index || createWardrobeIndex()
    const merged = await repository.observeCloudflareSnapshot(remote)
    ensureActive()
    if (merged.conflicts.length) return { state: 'conflict', revision: remote.revision }
    const plan = await repository.cloudflarePlan()
    ensureActive()
    if (plan.conflicts.length) return { state: 'conflict', revision: remote.revision }
    if (same(plan.index, projectWardrobeCloudIndex(remoteIndex))) {
      return { state: 'verified', revision: remote.revision }
    }
    try {
      ensureActive()
      const revision = await client.write(key, plan.revision, plan.index)
      ensureActive()
      const current = await repository.confirmCloudflareWrite({ revision, index: plan.index })
      ensureActive()
      if (current) return { state: 'verified', revision }
    } catch (error) {
      if (error?.code !== 'cloudflare-conflict') throw error
      observed = error.remote
    }
  }
  return { state: 'pending', revision: repository.document?.cloudflareRevision || 0 }
}
