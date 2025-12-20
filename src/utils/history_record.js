import { FileSystem } from '../services/FileSystem.js';
import { getVisibleObjectFilters } from './filter_api.js';

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
        this.filter = [];
        this.maxCompareRecords = 4;
    }

    async initFilter() {
        this.filter = await getVisibleObjectFilters();
    }

    compareRecords(recordA, recordB) {
        if (!recordA || !recordB || !recordA.data || !recordB.data) {
            return false;
        }
        const filterdA = recordA.data.filter(item => this.filter.includes(item.Group)).sort((a, b) => a.Group.localeCompare(b.Group));
        const filterdB = recordB.data.filter(item => this.filter.includes(item.Group)).sort((a, b) => a.Group.localeCompare(b.Group));
        if (filterdA.length !== filterdB.length) {
            return false;
        }
        for (let i = 0; i < filterdA.length; i++) {
            const itemA = filterdA[i];
            const itemB = filterdB[i];
            if (itemA.Name !== itemB.Name) {
                return false;
            }
        }
        return true;
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
        for (const existing of this.getAllRecords().slice(0, this.maxCompareRecords)) {
            if (this.compareRecords(existing, { data: record })) {
                console.log('[HistoryRecord] Duplicate record detected, not adding.');
                return null;
            }
        }
        const timestamp = new Date().toISOString();
        const entry = {
            name: `Record_${timestamp}`,
            type: 'outfit',
            data: record
        };

        console.log(`[HistoryRecord] Adding record: ${entry.name}`);

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
