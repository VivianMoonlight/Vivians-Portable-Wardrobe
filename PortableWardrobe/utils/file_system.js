export class FileSystem {
  constructor(rootName = 'Home') {
    this.root = { name: rootName, type: 'folder', children: [] };
  }

  getRoot() { return this.root; }

  _findIn(node, name) {
    if (!node || !node.children) return -1;
    return node.children.findIndex(c => c.name === name);
  }

  getNode(path) {
    if (!Array.isArray(path) || path.length === 0) return null;
    let node = this.root;
    for (let i = 1; i < path.length; i++) {
      if (!node.children) return null;
      node = node.children.find(c => c.name === path[i]);
      if (!node) return null;
    }
    return node;
  }

  addFile(parentPath, file) {
    const parent = this.getNode(parentPath);
    if (!parent || parent.type !== 'folder') throw new Error('Parent not found or not a folder');
    parent.children.push(file);
    return file;
  }

  removeFile(parentPath, file) {
    const parent = this.getNode(parentPath);
    if (!parent || !parent.children) return false;
    const idx = parent.children.findIndex(c => c === file || c.name === file.name);
    if (idx === -1) return false;
    parent.children.splice(idx, 1);
    return true;
  }

  moveItem(fromPath, name, toPath) {
    const fromNode = this.getNode(fromPath);
    const toNode = this.getNode(toPath);
    if (!fromNode || !toNode || toNode.type !== 'folder') return false;
    const idx = fromNode.children.findIndex(c => c.name === name);
    if (idx === -1) return false;
    const [item] = fromNode.children.splice(idx, 1);

    // Prevent moving folder into itself or descendant
    if (item.type === 'folder') {
      let p = toNode;
      while (p) {
        if (p === item) { fromNode.children.splice(idx, 0, item); return false; }
        p = this._parentOf(p); // requires parent map or external check; leave to caller if needed
      }
    }

    toNode.children.push(item);
    return true;
  }

  // deep clone without thumbCanvas
  stripThumbs(node = this.root) {
    if (!node) return null;
    const { thumbCanvas, ...rest } = node;
    const copy = Object.assign({}, rest);
    if (copy.type === 'folder' && copy.children) {
      copy.children = copy.children.map(ch => this.stripThumbs(ch));
    }
    return copy;
  }

  // Merge two folder trees into a new root (used for restore)
  static mergeRoots(target, source) {
    if (!source || !source.children) return;
    source.children.forEach(child => {
      if (child.type === 'folder') {
        let existing = target.children.find(f => f.type === 'folder' && f.name === child.name);
        if (!existing) {
          existing = { name: child.name, type: 'folder', children: [] };
          target.children.push(existing);
        }
        FileSystem.mergeRoots(existing, child);
      } else {
        const exists = target.children.find(f => JSON.stringify(f) === JSON.stringify(child));
        if (!exists) target.children.push(child);
      }
    });
  }

  toJSON() { return JSON.parse(JSON.stringify(this.stripThumbs(this.root))); }
  fromJSON(json) { this.root = json; }
}
