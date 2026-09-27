function categoryForKey(key) {
  if (/^VPWardrobe_index_\d+_recovery_/i.test(key)) return 'recoveryBytes'
  if (/^VPWardrobe_index_\d+$/i.test(key)) return 'currentIndexBytes'
  if (/^VPWardrobe_VPWardrobe_history_/i.test(key)) return 'oldHistoryBytes'
  if (/^VPWardrobe_VPWardrobe_local_/i.test(key)
    || /^VPWardrobe_\d+$/i.test(key) || /^VPWardrobe\d+$/i.test(key)) {
    return 'legacyWardrobeBytes'
  }
  return /^vpw/i.test(key) ? 'otherVpwBytes' : 'otherAppsBytes'
}

/** Estimate readable localStorage occupancy from UTF-16 key/value lengths. */
export function estimateLocalStorageUsage(storage) {
  try {
    const categories = {
      currentIndexBytes: 0,
      recoveryBytes: 0,
      oldHistoryBytes: 0,
      legacyWardrobeBytes: 0,
      otherVpwBytes: 0,
      otherAppsBytes: 0,
    }
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key === null) return null
      const value = storage.getItem(key)
      if (value === null) return null
      categories[categoryForKey(key)] += (key.length + value.length) * 2
    }
    const otherBytes = categories.otherAppsBytes
    const wardrobeBytes = Object.values(categories).reduce((total, bytes) => total + bytes, 0) - otherBytes
    return { wardrobeBytes, otherBytes, totalBytes: wardrobeBytes + otherBytes, categories }
  } catch {
    return null
  }
}
