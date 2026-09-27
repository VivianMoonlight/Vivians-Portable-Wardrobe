const errorKeys: Record<string, string> = {
  'too-large': 'cloudflareSync.errorTooLarge',
  'capacity-reached': 'cloudflareSync.errorCapacityReached',
  'write-limit': 'cloudflareSync.errorWriteLimit',
  'provisioning-unavailable': 'cloudflareSync.errorProvisioningUnavailable',
}

export function cloudflareSyncErrorKey(code: string | null | undefined): string | null {
  return code ? errorKeys[code] || null : null
}
