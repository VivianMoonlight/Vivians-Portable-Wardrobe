/**
 * Hierarchical file/folder management system supporting add, remove, move operations
 * and serialization.
 *
 * Constructor is tolerant: accepts either a string rootName or an options object:
 *   new FileSystem('Home')
 *   new FileSystem({ rootName: 'Home', fileTree: {...} })
 */
export class FileSystem {
  /**
   * Creates new file system with named root folder
   * @param {string|Object} arg - rootName string OR options object { rootName, fileTree }
   */
  constructor(arg = {}) {
    let rootName = 'Home';
    let fileTree = null;
    if (typeof arg === 'string') {
      rootName = arg;
    } else if (arg && typeof arg === 'object') {
      rootName = arg.rootName ?? rootName;
      fileTree = arg.fileTree ?? null;
    }
    if (fileTree) {
      this.fromJSON(fileTree); // restore from provided fileTree
    } else {
      this.root = { name: rootName, type: 'folder', children: [] };
    }
  }

  /**
   * Returns the root node
   * @returns {Object} Root folder node
   */
  getRoot() { return this.root; }

  /**
   * Finds index of child by name in a node
   * @private
   * @param {Object} node - Parent node
   * @param {string} name - Child name to find
   * @returns {number} Index of child or -1 if not found
   */
  _findIn(node, name) {
    if (!node || !node.children) return -1;
    return node.children.findIndex(c => c.name === name);
  }

  _findParent(current, target) {
    if (!current || !current.children) return null;
    for (const child of current.children) {
      if (child === target) return current;
      if (child.type === 'folder') {
        const res = this._findParent(child, target);
        if (res) return res;
      }
    }
    return null;
  }

  /**
   * Retrieves node at specified path
   * @param {Array<string>} path - Array of names starting with root name
   * @returns {Object|null} Node at path or null if not found
   */
  getNode(path) {
    if (!Array.isArray(path) || path.length === 0) return null;
    let node = this.root;
    // path is expected like ['Home', 'Folder', 'Sub']
    for (let i = 1; i < path.length; i++) {
      if (!node.children) return null;
      node = node.children.find(c => c.name === path[i]);
      if (!node) return null;
    }
    return node;
  }

  /**
   * Adds file object to parent folder
   * @param {Array<string>} parentPath - Path to parent folder
   * @param {Object} file - File object to add
   * @returns {Object} The added file object
   * @throws {Error} If parent not found or not a folder
   */
  addFile(parentPath, file) {
    const parent = this.getNode(parentPath);
    if (!parent || parent.type !== 'folder') throw new Error('Parent not found or not a folder');
    parent.children.push(file);
    return file;
  }

  /**
   * Creates new folder in parent folder
   * @param {Array<string>} parentPath - Path to parent folder
   * @param {string} folderName - Name of the new folder
   * @returns {Object} The created folder object
   */
  addFolder(parentPath, folderName) {
    const parent = this.getNode(parentPath);
    if (!parent || parent.type !== 'folder') throw new Error('Parent not found or not a folder');
    const existing = this._findIn(parent, folderName);
    if (existing !== -1 && parent.children[existing].type === 'folder') {
      return parent.children[existing];
    }
    const folder = { name: folderName, type: 'folder', children: [] };
    parent.children.push(folder);
    return folder;
  }

  /**
   * Removes file from parent folder
   * @param {Array<string>} parentPath - Path to parent folder
   * @param {Object} file - File object to remove
   * @returns {boolean} True if removed, false if not found
   */
  removeFile(parentPath, file) {
    const parent = this.getNode(parentPath);
    if (!parent || !parent.children) return false;
    const idx = parent.children.findIndex(c => c === file);
    if (idx === -1) return false;
    parent.children.splice(idx, 1);
    return true;
  }

  /**
   * Moves item between folders with cycle prevention
   * @param {Array<string>} fromPath - Source folder path
   * @param {Object} item - Item to move
   * @param {Array<string>} toPath - Destination folder path
   * @returns {boolean} True if moved successfully, false otherwise
   */
  moveItem(fromPath, item, toPath) {
    const fromNode = this.getNode(fromPath);
    const toNode = this.getNode(toPath);
    if (!fromNode || !toNode || toNode.type !== 'folder') return false;
    const idx = fromNode.children.findIndex(c => c === item);
    if (idx === -1) return false;
    const [movedItem] = fromNode.children.splice(idx, 1);

    // Prevent moving folder into itself or descendant
    if (movedItem.type === 'folder') {
      let p = toNode;
      while (p) {
        if (p === movedItem) {
          // Cycle detected, revert move
          fromNode.children.splice(idx, 0, movedItem);
          return false;
        }
        p = this._findParent(this.root, p);
      }
    }

    // Handle merging with existing folder of same name
    const existingIdx = this._findIn(toNode, movedItem.name);
    if (existingIdx !== -1 && movedItem.type === 'folder' && toNode.children[existingIdx].type === 'folder') {
      FileSystem.mergeRoots(toNode.children[existingIdx], movedItem);
      return true;
    }

    toNode.children.push(movedItem);
    return true;
  }

  /**
   * Renames item in folder
   * @param {Array<string>} parentPath - Path to parent folder
   * @param {Object} item - Item to rename
   * @param {string} newName - New name for the item
   * @returns {boolean} True if renamed, false if not found
   */
  renameItem(parentPath, item, newName) {
    const parent = this.getNode(parentPath);
    if (!parent || !parent.children) return false;
    const idx = parent.children.findIndex(c => c === item);
    if (idx === -1) return false;
    parent.children[idx].name = newName;
    return true;
  }

  /**
   * Deep clones tree without thumbCanvas properties for serialization
   * @param {Object} [node=this.root] - Node to start cloning from
   * @returns {Object|null} Cloned tree without thumbCanvas properties
   */
  stripThumbs(node = this.root) {
    if (!node) return null;
    const { thumbCanvas, isThumbGenerated, ...rest } = node;
    const copy = Object.assign({}, rest);
    if (copy.type === 'folder' && Array.isArray(copy.children)) {
      copy.children = copy.children.map(ch => this.stripThumbs(ch));
    }
    return copy;
  }

  /**
   * Merges two folder trees (used for backup restoration)
   * @static
   * @param {Object} target - Target folder to merge into
   * @param {Object} source - Source folder to merge from
   */
  static mergeRoots(target, source) {
    if (!source || !Array.isArray(source.children)) return;
    if (!target.children) target.children = [];
    source.children.forEach(child => {
      if (child.type === 'folder') {
        let existing = target.children.find(f => f.type === 'folder' && f.name === child.name);
        if (!existing) {
          existing = { name: child.name, type: 'folder', children: [] };
          target.children.push(existing);
        }
        FileSystem.mergeRoots(existing, child);
      } else {
        // treat files uniquely by deep equality; if not exists -> push
        const exists = target.children.find(f => JSON.stringify(f) === JSON.stringify(child));
        if (!exists) target.children.push(child);
      }
    });
  }

  /**
   * Exports file system as JSON
   * @returns {Object} JSON representation of file system
   */
  toJSON() { return JSON.parse(JSON.stringify(this.stripThumbs(this.root))); }

  /**
   * Restores file system from JSON
   * @param {Object} json - JSON data to restore from
   */
  fromJSON(json) {
    if (!json || typeof json !== 'object') {
      // fallback: create empty root
      this.root = { name: 'Home', type: 'folder', children: [] };
      return;
    }
    // Defensive normalization: ensure root has expected shape
    this.root = Object.assign({ name: json.name ?? 'Home', type: 'folder', children: [] }, json);
    if (!Array.isArray(this.root.children)) this.root.children = [];
  }

  fromMultipleJSON(jsonArray) {
    if (!Array.isArray(jsonArray)) return;
    this.root = { name: 'Home', type: 'folder', children: [] };
    jsonArray.forEach(json => {
      if (json && typeof json === 'object') {
        FileSystem.mergeRoots(this.root, json);
      }
    });
  }
  

  /**
   * Search for items whose name contains the query (case-insensitive).
   * Returns array of { item, path } where path is array of folder names starting with root (e.g. ['Home','Folder']).
   * If query is falsy or empty, returns [].
   * @param {string} query
   * @returns {Array<{item:Object, path:Array<string>}>}
   */
  search(query) {
    if (!query || typeof query !== 'string') return []
    const q = query.toLowerCase()
    const results = []
    const walk = (node, path) => {
      if (!node || !node.children) return
      for (const child of node.children) {
        const childPath = path.slice() // copy
        if (child.type === 'folder') {
          // folder itself can match
          if ((child.name || '').toLowerCase().includes(q)) {
            results.push({ item: child, path: childPath })
          }
          // descend
          walk(child, childPath.concat(child.name))
        } else {
          if ((child.name || '').toLowerCase().includes(q)) {
            results.push({ item: child, path: childPath })
          }
        }
      }
    }
    // root path is [root.name]
    walk(this.root, [this.root.name])
    return results
  }
}
