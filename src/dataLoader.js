/**
 * DataLoader — Handles loading and saving JSON data files.
 * Priority: userData/data/ > bundled data/ > empty default.
 */

const path = require('path');
const fs = require('fs').promises;

const DATA_TYPES = [
  'identities', 'egos', 'relics', 'starlight', 'cardpacks',
  'achievements', 'templates'
];

const EMPTY_DEFAULTS = {
  identities: [],
  egos: [],
  relics: [],
  starlight: [],
  cardpacks: [],
  achievements: [],
  templates: {}
};

class DataLoader {
  /**
   * @param {string} userDataPath — app.getPath('userData')
   * @param {string} bundledDataPath — path.join(__dirname, 'data')
   */
  constructor(userDataPath, bundledDataPath) {
    this.userDataDir = path.join(userDataPath, 'data');
    this.bundledDir = bundledDataPath;
    this._cache = new Map();
    this._dirty = new Set();
  }

  /**
   * Load a data file.
   * @param {string} type — one of DATA_TYPES
   * @returns {Promise<Array|Object>}
   */
  async load(type) {
    if (this._cache.has(type)) return this._cache.get(type);

    const fileName = `${type}.json`;

    // Priority 1: userData/data/
    try {
      const up = path.join(this.userDataDir, fileName);
      const raw = await fs.readFile(up, 'utf8');
      const data = JSON.parse(raw);
      this._cache.set(type, data);
      return data;
    } catch (e) { /* fall through */ }

    // Priority 2: bundled data/
    try {
      const bp = path.join(this.bundledDir, fileName);
      const raw = await fs.readFile(bp, 'utf8');
      const data = JSON.parse(raw);
      this._cache.set(type, data);
      return data;
    } catch (e) {
      // Priority 3: empty default
      const def = EMPTY_DEFAULTS[type] !== undefined
        ? structuredClone(EMPTY_DEFAULTS[type])
        : [];
      this._cache.set(type, def);
      return def;
    }
  }

  /**
   * Save data to userData/data/. Never writes to bundled data/.
   * @param {string} type
   * @param {Array|Object} data
   */
  async save(type, data) {
    await fs.mkdir(this.userDataDir, { recursive: true });
    const filePath = path.join(this.userDataDir, `${type}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    this._cache.set(type, data);
    this._dirty.delete(type);
  }

  /**
   * Check if userData version exists for a type.
   * @returns {Promise<boolean>}
   */
  async hasUserData(type) {
    try {
      await fs.access(path.join(this.userDataDir, `${type}.json`));
      return true;
    } catch { return false; }
  }

  /**
   * Delete userData version (revert to bundled).
   */
  async deleteUserData(type) {
    this._cache.delete(type);
    try {
      await fs.unlink(path.join(this.userDataDir, `${type}.json`));
    } catch (e) { /* ok if doesn't exist */ }
  }

  /** Invalidate all caches (call after import). */
  clearCache() {
    this._cache.clear();
  }

  /**
   * Export all loaded data.
   * @returns {Promise<object>} { type: data, ... }
   */
  async exportAll() {
    const result = {};
    for (const type of DATA_TYPES) {
      result[type] = await this.load(type);
    }
    return result;
  }

  /**
   * Import data — overwrites userData for all provided types.
   * @param {object} dataMap — { type: data, ... }
   */
  async importAll(dataMap) {
    for (const [type, data] of Object.entries(dataMap)) {
      if (DATA_TYPES.includes(type)) {
        await this.save(type, data);
      }
    }
    this.clearCache();
  }

  /** Get list of available types. */
  listTypes() {
    return DATA_TYPES;
  }
}

module.exports = { DataLoader, DATA_TYPES };
