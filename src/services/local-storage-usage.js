/** Estimate readable localStorage occupancy from UTF-16 key/value lengths. */
export function estimateLocalStorageUsage(storage) {
  try {
    let wardrobeBytes = 0
    let otherBytes = 0
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key === null) return null
      const value = storage.getItem(key)
      if (value === null) return null
      const bytes = (key.length + value.length) * 2
      if (/^vpw/i.test(key)) wardrobeBytes += bytes
      else otherBytes += bytes
    }
    return { wardrobeBytes, otherBytes, totalBytes: wardrobeBytes + otherBytes }
  } catch {
    return null
  }
}
