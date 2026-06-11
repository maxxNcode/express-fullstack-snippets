/**
 * dbRunner — execute SQL queries against local SQLite .db files
 * using sql.js (pure JS SQLite, no native deps).
 *
 * Used by the Query Builder's "Run Query" preview feature.
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let sqlJsPromise = null;

function _getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

/**
 * Try to checkpoint WAL data back into the main .db file.
 * sql.js does NOT support WAL mode, so we need this before reading.
 */
function _checkpointWal(dbPath) {
  const walPath = dbPath + '-wal';
  if (!fs.existsSync(walPath)) return true; // No WAL — nothing to do
  const walStat = fs.statSync(walPath);
  if (walStat.size === 0) return true; // Empty WAL — nothing to do

  // Method 1: Try system sqlite3 CLI by checking common locations
  const sqlite3Candidates = [
    'sqlite3',           // PATH lookup (works on most systems)
    'sqlite3.exe',       // Windows PATH lookup
    'C:\\Program Files\\SQLite\\sqlite3.exe',
    'C:\\Program Files (x86)\\SQLite\\sqlite3.exe',
  ];

  for (const candidate of sqlite3Candidates) {
    try {
      execFileSync(candidate, [dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'], {
        stdio: 'pipe',
        timeout: 10000,
        windowsHide: true
      });
      return true;
    } catch (_) { /* try next candidate */ }
  }

  // Method 2: On Windows, try where.exe to find sqlite3
  if (process.platform === 'win32') {
    try {
      const result = execFileSync('where.exe', ['sqlite3'], { stdio: 'pipe', timeout: 5000, windowsHide: true });
      const foundPath = result.stdout.toString().trim().split('\n')[0].trim();
      if (foundPath) {
        execFileSync(foundPath, [dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'], {
          stdio: 'pipe', timeout: 10000, windowsHide: true
        });
        return true;
      }
    } catch (_) { /* not found */ }
  }

  return false; // Could not checkpoint
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
    // Checkpoint WAL before reading (sql.js doesn't support WAL mode)
    const checkpointed = _checkpointWal(dbPath);
    if (!checkpointed) {
      const walPath = dbPath + '-wal';
      return {
        success: false,
        error: `WAL file detected (${path.basename(walPath)}). The bundled SQLite library does not support WAL mode.\n` +
          `\n` +
          `To fix, run this in your terminal:\n` +
          `  sqlite3 "${dbPath}" "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;"\n` +
          `\n` +
          `Or install the SQLite CLI:\n` +
          `  Windows: winget install SQLite.SQLite  (or download from https://sqlite.org/download.html)\n` +
          `  macOS:   brew install sqlite3\n` +
          `  Linux:   sudo apt-get install sqlite3`
      };
    }

    const buffer = fs.readFileSync(dbPath);
    if (buffer.length === 0) {
      return { success: false, error: `Database file is empty: ${dbPath}` };
    }
    // Check if file looks like a valid SQLite database
    const header = buffer.slice(0, 15).toString('utf8');
    if (!header.startsWith('SQLite format 3')) {
      return { success: false, error: `File is not a valid SQLite database: ${dbPath} (header: ${header.trim() || 'empty'})` };
    }
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
    // On error, try to get table list for diagnostics
    let tablesInfo = '';
    let db2;
    try {
      const buf2 = fs.readFileSync(dbPath);
      if (buf2.length > 0) {
        db2 = new SQL.Database(buf2);
        const tableResults = db2.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
        if (tableResults && tableResults.length > 0 && tableResults[0].values) {
          const names = tableResults[0].values.map(v => v[0]).join(', ');
          tablesInfo = ` | Tables in DB: ${names}`;
        } else {
          tablesInfo = ' | Database has no tables';
        }
      }
    } catch (_) {
      tablesInfo = ' | Could not read tables from database';
    } finally {
      if (db2) try { db2.close(); } catch (_) {}
    }
    return { success: false, error: `SQL error: ${err.message}${tablesInfo}` };
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
