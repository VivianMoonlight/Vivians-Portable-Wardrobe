const timestamp = Date.now();
const { FileSystem } = await import(`./file_system.js?ts=${timestamp}`);

export class HistoryRecord {
    constructor(rootName = 'History', MaxRecords = 20) {
        this.fs = new FileSystem(rootName); // ← 不再继承，用组合方式
        this.MaxRecords = MaxRecords;
    }

    /** 添加记录 */
    addRecord(record) {
        const timestamp = new Date().toISOString();
        const entry = {
            name: `Record_${timestamp}`,
            type: 'outfit',
            data: record
        };

        const root = this.fs.getNode([this.fs.root.name]);
        if (!root.children) root.children = [];

        root.children.unshift(entry); // 放在最前面

        if (root.children.length > this.MaxRecords) {
            root.children = root.children.slice(0, this.MaxRecords);
        }

        return entry;
    }

    /** 获取所有记录 */
    getAllRecords() {
        const root = this.fs.getNode([this.fs.root.name]);
        return root.children || [];
    }

    /** 清空记录 */
    clear() {
        const root = this.fs.getNode([this.fs.root.name]);
        root.children = [];
    }

    /** 导出 JSON */
    toJSON() {
        return this.fs.toJSON();
    }

    /** 从 JSON 恢复历史 */
    fromJSON(json) {
        this.fs.fromJSON(json);
    }
}
