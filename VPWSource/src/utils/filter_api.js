import { fetchAssetData } from './AssetApi'

/**
 * fetchFilterData
 * - Delegates to fetchAssetData to obtain AssetGroupMap-derived list.
 * - Kept as a separate util for semantic clarity (filters vs assets), but reuse same implementation.
 */
export async function fetchFilterData() {
  return fetchAssetData();
}