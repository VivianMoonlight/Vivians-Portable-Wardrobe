import { validateWardrobeIndex } from './wardrobe-index.js'

export const CLOUDFLARE_KEY_SETTING = 'VPWCloudKey'

const KEY_PATTERN = /^vpw1_[A-Za-z0-9_-]{43}$/

export function isCloudflareRecoveryKey(value) {
  return typeof value === 'string' && KEY_PATTERN.test(value)
}

export function generateCloudflareRecoveryKey(crypto = globalThis.crypto) {
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('Secure random key generation is unavailable')
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `vpw1_${base64}`
}

export function configuredCloudflareUrl() {
  return import.meta.env?.VITE_CLOUDFLARE_SYNC_URL || ''
}

export class CloudflareWardrobeClient {
  constructor({ baseUrl = configuredCloudflareUrl(), fetchImpl = (...args) => globalThis.fetch(...args),
    timeoutMs = 60_000 } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '')
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
    if (this.baseUrl) {
      const url = new URL(this.baseUrl)
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        throw new Error('Cloudflare sync requires HTTPS')
      }
    }
  }

  get available() { return Boolean(this.baseUrl && this.fetchImpl) }

  async request(method, key, body) {
    if (!this.available) throw Object.assign(new Error('Cloudflare sync has not been configured'),
      { code: 'cloudflare-unconfigured' })
    if (!isCloudflareRecoveryKey(key)) throw new Error('Invalid Cloudflare recovery key')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/wardrobe`, {
        method, cache: 'no-store', credentials: 'omit', signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const data = await response.json().catch(() => null)
      if (response.status === 409 && data && Number.isSafeInteger(data.revision)) {
        if (data.index !== null) validateWardrobeIndex(data.index)
        throw Object.assign(new Error('Cloudflare wardrobe changed on another device'),
          { code: 'cloudflare-conflict', remote: data })
      }
      if (!response.ok || !data) {
        throw Object.assign(new Error(`Cloudflare sync failed (HTTP ${response.status})`),
          { code: 'cloudflare-http', status: response.status,
            serverCode: typeof data?.error === 'string' ? data.error : null,
            maxIndexBytes: Number.isSafeInteger(data?.maxIndexBytes) ? data.maxIndexBytes : null })
      }
      return data
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw Object.assign(new Error('Cloudflare sync timed out'), { code: 'cloudflare-timeout', cause: error })
      }
      throw error
    } finally { clearTimeout(timer) }
  }

  async read(key) {
    const data = await this.request('GET', key)
    if (!Number.isSafeInteger(data.revision) || data.revision < 0
      || (data.index !== null && data.index !== undefined && !validateWardrobeIndex(data.index))) {
      throw new Error('Cloudflare returned an invalid wardrobe')
    }
    return { revision: data.revision, index: data.index || null }
  }

  async write(key, expectedRevision, index) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('Invalid Cloudflare wardrobe revision')
    }
    validateWardrobeIndex(index)
    const data = await this.request('PUT', key, { expectedRevision, index })
    if (!Number.isSafeInteger(data.revision) || data.revision <= expectedRevision) {
      throw new Error('Cloudflare did not confirm the wardrobe write')
    }
    return data.revision
  }
}
