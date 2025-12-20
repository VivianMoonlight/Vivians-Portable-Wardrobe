import { fetchAssetData } from './AssetApi'
import { classifyToGroup, isHiddenGroup } from '@/config/filterGroupConfig'

/**
 * 获取所有不隐藏的 Object/Appearance 类别 Filter（排除 Item 和隐藏分组）
 * @returns {Promise<Array<{key: string, data: Object}>>} 返回符合条件的 filter 项数组
 */
export async function getVisibleObjectFilters() {
  try {
    // 获取所有资源数据
    const allAssets = await fetchAssetData()

    // 过滤出符合条件的项：
    // 1. 不是 Item 分组
    // 2. 不属于隐藏分组（如 HiddenBody）
    const visibleObjectFilters = allAssets.filter(asset => {
      const data = asset.data || {}
      const groupID = classifyToGroup(data)


      // 排除隐藏分组
      if (isHiddenGroup(groupID)) {
        return false
      }

      return true
    }).map(asset => asset.data.Name)

    return visibleObjectFilters
  } catch (error) {
    console.error('Failed to fetch visible object filters:', error)
    return []
  }
}

/**
 * fetchFilterData
 * - Delegates to fetchAssetData to obtain AssetGroupMap-derived list.
 * - Kept as a separate util for semantic clarity (filters vs assets), but reuse same implementation.
 */
export async function fetchFilterData() {
  return fetchAssetData();
}