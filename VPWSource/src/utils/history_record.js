import { FileSystem } from './file_system.js';

/**
 * Time-based history tracking with automatic pruning to maintain maximum record count.
 * Uses composition pattern with FileSystem for storage.
 */
export class HistoryRecord {
    /**
     * Creates history manager with specified max records
     * @param {string} [rootName='History'] - Name for the history root
     * @param {number} [MaxRecords=20] - Maximum number of records to keep
     * 
     * @example
     * const history = new HistoryRecord('History', 20);
     */
    constructor(rootName = 'History', MaxRecords = 20) {
        this.fs = new FileSystem(rootName);
        this.MaxRecords = MaxRecords;
    }

    /**
     * Adds timestamped record to beginning of history, prunes if needed
     * @param {*} record - Record data to add (typically outfit data)
     * @returns {Object} The created history entry
     * 
     * @example
     * history.addRecord(outfitData);
     * // Creates: { name: 'Record_2024-01-01T12:00:00.000Z', type: 'outfit', data: [...] }
     */
    addRecord(record) {
        const timestamp = new Date().toISOString();
        const entry = {
            name: `Record_${timestamp}`,
            type: 'outfit',
            data: record
        };

        const root = this.fs.getNode([this.fs.root.name]);
        if (!root.children) root.children = [];

        root.children.unshift(entry);

        if (root.children.length > this.MaxRecords) {
            root.children = root.children.slice(0, this.MaxRecords);
        }

        return entry;
    }

    /**
     * Returns array of all history records
     * @returns {Array<Object>} Array of history entries
     */
    getAllRecords() {
        const root = this.fs.getNode([this.fs.root.name]);
        return root.children || [];
    }

    /**
     * Removes all history records
     */
    clear() {
        const root = this.fs.getNode([this.fs.root.name]);
        root.children = [];
    }

    /**
     * Exports history as JSON
     * @returns {Object} JSON representation of history
     */
    toJSON() {
        return this.fs.toJSON();
    }

    /**
     * Restores history from JSON
     * @param {Object} json - JSON data to restore from
     */
    fromJSON(json) {
        this.fs.fromJSON(json);
    }
}
