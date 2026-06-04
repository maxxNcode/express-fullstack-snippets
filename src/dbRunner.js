/**
 * dbRunner — execute SQL queries against local SQLite .db files
 * using sql.js (pure JS SQLite, no native deps).
 *
 * Used by the Query Builder's "Run Query" preview feature.
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let sqlJsPromise = null;

function _getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

/**
 * Run one or more SQL statements against a SQLite database file and return results.
 *
 * @param {string} dbPath - Absolute path to the .db / .sqlite file
 * @param {string} sql    - SQL to execute (may contain multiple statements)
 * @returns {Promise<{ success: boolean, results?: Array, error?: string, rowCount?: number }>}
 */
async function runQuery(dbPath, sql) {
  if (!fs.existsSync(dbPath)) {
    return { success: false, error: `Database file not found: ${dbPath}` };
  }

  let SQL;
  try {
    SQL = await _getSqlJs();
  } catch (err) {
    return { success: false, error: `Failed to load sql.js: ${err.message}` };
  }

  let db;
  try {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
    const rawResults = db.exec(sql);

    // Convert from sql.js format to clean JSON
    const results = [];
    let totalRows = 0;
    for (const stmtResult of rawResults) {
      const columns = stmtResult.columns || [];
      const rows = (stmtResult.values || []).map(row => {
        const obj = {};
        for (let i = 0; i < columns.length; i++) {
          obj[columns[i]] = row[i];
        }
        return obj;
      });
      totalRows += rows.length;
      results.push({ columns, rows });
    }

    return { success: true, results, rowCount: totalRows };
  } catch (err) {
    return { success: false, error: `SQL error: ${err.message}` };
  } finally {
    if (db) {
      try { db.close(); } catch (_) { /* ignore */ }
    }
  }
}

/**
 * Find all .db and .sqlite files inside a workspace folder.
 * @param {string} workspaceRoot - Absolute path to the workspace root
 * @returns {string[]} Array of relative paths (relative to workspaceRoot)
 */
function findDbFiles(workspaceRoot) {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return [];
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      // Skip node_modules, .git, and other common non-project dirs
      if (entry.name === 'node_modules' || entry.name === '.git' ||
          entry.name === '.opencode' || entry.name === '.vscode' ||
          entry.name === 'bin' || entry.name === 'models') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') {
          results.push(path.relative(workspaceRoot, fullPath));
        }
      }
    }
  }

  walk(workspaceRoot);
  return results;
}

module.exports = { runQuery, findDbFiles };
