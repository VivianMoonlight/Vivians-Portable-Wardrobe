// Pure backend FilterService: no DOM, manages groups & active flags, and exposes a small subscription API. 
import {
  classifyToGroup,
  getGroupMeta,
  getAllGroupIDs,
  getVisibleGroupIDs,
  GROUP_META
} from '@/config/filterGroupConfig'

export class FilterService {
  constructor(items = []) {
    // items: array of { key, data } where data is item metadata
    this. items = [] // { key, data, active }
    this. groups = [] // { groupID, displayName, isHiddenGroup, priority, itemList: [... ] }
    this._listeners = new Set()

    this.build(items)
  }

  // Build internal items/groups from plain array
  build(items = []) {
    this.items = items. map(it => ({ key: it.key, data: it. data, active: true }))

    // 初始化所有已知分组（按优先级排序）
    const allGroupIDs = getAllGroupIDs()
    this.groups = allGroupIDs.map(groupID => {
      const meta = getGroupMeta(groupID)
      return {
        groupID,
        displayName: meta.displayName,
        isHiddenGroup: meta.isHiddenGroup,
        priority: meta.priority,
        itemList: []
      }
    })

    // 分配 items 到对应分组
    this. items.forEach(item => {
      const groupID = classifyToGroup(item. data)
      let group = this.groups.find(gr => gr.groupID === groupID)
      if (!group) {
        // 如果分组不存在（理论上不会发生），创建一个新的
        const meta = getGroupMeta(groupID)
        group = {
          groupID,
          displayName: meta.displayName,
          isHiddenGroup: meta.isHiddenGroup,
          priority: meta.priority,
          itemList: []
        }
        this.groups.push(group)
        // 重新排序
        this.groups. sort((a, b) => a.priority - b.priority)
      }
      group.itemList. push({ key: item.key, data: item. data, active: item.active })
    })

    // emit initial snapshot
    this. emitChange()
  }

  // grouping function using unified config
  groupByFunc(data) {
    return classifyToGroup(data)
  }

  // internal helper: find item record
  _findItem(key) {
    return this.items.find(i => i.key === key)
  }

  // toggle a single item by key
  toggle(key) {
    const it = this._findItem(key)
    if (! it) return
    it.active = !it.active
    // mirror change into groups
    this._syncGroupsFromItems()
    this.emitChange()
  }

  setActive(key, active = true) {
    const it = this._findItem(key)
    if (!it) return
    it.active = !!active
    this._syncGroupsFromItems()
    this. emitChange()
  }

  setAll(active = true) {
    this.items. forEach(i => { i.active = !!active })
    this._syncGroupsFromItems()
    this.emitChange()
  }

  invertAll() {
    this.items.forEach(i => { i. active = !i. active })
    this._syncGroupsFromItems()
    this.emitChange()
  }

  // group-level ops by groupID
  setGroupAll(groupID, active = true) {
    const g = this.groups. find(gr => gr.groupID === groupID)
    if (!g) return
    g.itemList.forEach(it => {
      it.active = !!active
      const origin = this._findItem(it.key)
      if (origin) origin.active = it.active
    })
    this. emitChange()
  }

  invertGroup(groupID) {
    const g = this.groups. find(gr => gr.groupID === groupID)
    if (!g) return
    g.itemList.forEach(it => {
      it. active = !it. active
      const origin = this._findItem(it.key)
      if (origin) origin.active = it.active
    })
    this. emitChange()
  }

  // keep groups consistent with items array
  _syncGroupsFromItems() {
    const map = new Map(this.items.map(i => [i.key, i]))
    this.groups.forEach(g => {
      g.itemList.forEach(it => {
        const origin = map.get(it.key)
        it.active = origin ?  origin.active : !!it.active
        it.data = origin ? origin.data : it.data
      })
    })
  }

  // getters
  getActiveSet(field = 'Name') {
    const s = new Set()
    this.items.forEach(item => {
      if (item.active) s.add(item. data[field] ??  item.data.name ??  item.key)
    })
    return s
  }

  getFullSet(field = 'Name') {
    const s = new Set()
    this.items.forEach(item => {
      s.add(item. data[field] ??  item.data.name ?? item.key)
    })
    return s
  }

  /**
   * 获取可见分组列表（过滤掉 isHiddenGroup 为 true 的分组）
   * @returns {Array} 可见分组数组
   */
  getVisibleGroups() {
    return this.groups. filter(g => ! g.isHiddenGroup)
  }

  /**
   * 获取所有分组列表（包括隐藏分组）
   * @returns {Array} 所有分组数组
   */
  getAllGroups() {
    return this.groups
  }

  // snapshot for UI consumption (defensive copy)
  getSnapshot() {
    return {
      items: this.items. map(i => ({
        key: i.key,
        data: {
          Description: i.data?. Description,
          Name: i.data?.Name,
          Category: i.data?.Category,
          BodyCosplay: i. data?.BodyCosplay
        },
        active: i.active
      })),
      groups: this.groups.map(g => ({
        groupID: g. groupID,
        displayName: g. displayName,
        isHiddenGroup: g.isHiddenGroup,
        priority: g. priority,
        itemList: g.itemList.map(it => ({
          key: it.key,
          data: {
            Description: it.data?.Description,
            Name: it.data?.Name,
            Category: it.data?.Category,
            BodyCosplay: it. data?.BodyCosplay
          },
          active: it.active
        }))
      })),
      // 额外提供可见分组快照
      visibleGroups: this. groups
        .filter(g => !g.isHiddenGroup)
        .map(g => ({
          groupID: g. groupID,
          displayName: g. displayName,
          isHiddenGroup: g.isHiddenGroup,
          priority: g. priority,
          itemList: g.itemList.map(it => ({
            key: it.key,
            data: {
              Description: it.data?.Description,
              Name: it.data?.Name,
              Category: it.data?.Category,
              BodyCosplay: it. data?.BodyCosplay
            },
            active: it.active
          }))
        }))
    }
  }

  // simple subscription API
  onChange(fn) { this._listeners.add(fn) }
  offChange(fn) { this._listeners.delete(fn) }
  emitChange() {
    const snapshot = this.getSnapshot()
    for (const fn of this._listeners) {
      try { fn(snapshot) } catch (e) { /* ignore */ }
    }
  }
}