const fs = require('fs');
const path = require('path');
const { splitSql } = require('./sqlText');

const SCHEMA_FILE = '.njs-schema.json';

class SchemaRegistry {
    constructor() {
        this.schemaPath = null;
        this.schema = { tables: {}, screens: [] };
    }

    async init(workspaceRoot) {
        if (!workspaceRoot) return false;
        this.schemaPath = path.join(workspaceRoot, SCHEMA_FILE);
        try {
            const raw = await fs.promises.readFile(this.schemaPath, 'utf8');
            this.schema = JSON.parse(raw);
            try {
                await this._repairInvalidFieldNames();
            } catch (repairErr) {
                console.error('njs: Schema repair error:', repairErr);
            }
        } catch (err) {
            // Corrupt file: keep a copy so the next save() doesn't silently destroy the user's schema
            if (err.code !== 'ENOENT') {
                console.error('njs: Could not parse schema file, backed up to .bak:', err.message);
                await fs.promises.copyFile(this.schemaPath, this.schemaPath + '.bak').catch(() => {});
            }
            this.schema = { tables: {}, screens: [] };
        }
        return true;
    }

    /**
     * Auto-repair field names that contain invalid characters (like ':' from command names).
     * This fixes corrupted data from previous buggy versions where the command name
     * leaked into field names (e.g. "njs:register" instead of "courseID").
     */
    async _repairInvalidFieldNames() {
        let repaired = false;
        for (const [tableName, table] of Object.entries(this.schema.tables)) {
            if (!table || !Array.isArray(table.fields)) continue;
            for (const field of table.fields) {
                if (!field.name || !field.name.includes(':')) continue;
                // Corrupted! Try to infer the correct name
                let correctName = null;

                // Strategy 1: FK references FROM other tables may reference the correct field name
                for (const [otherName, otherTable] of Object.entries(this.schema.tables)) {
                    if (otherName === tableName || !Array.isArray(otherTable?.fields)) continue;
                    for (const ofield of otherTable.fields) {
                        if (ofield.fk && ofield.fk.table === tableName) {
                            correctName = ofield.fk.field;
                            break;
                        }
                    }
                    if (correctName) break;
                }

                // Strategy 2: Derive PK name from table name (e.g. "Enrollments" → "enrollmentID")
                if (!correctName && field.pk) {
                    const singular = tableName.replace(/s$/, '');
                    const lowerFirst = singular.charAt(0).toLowerCase() + singular.slice(1);
                    correctName = lowerFirst + 'ID';
                }

                // Strategy 3: Safe fallback to 'id'
                if (!correctName) {
                    correctName = 'id';
                }

                field.name = correctName;
                repaired = true;
            }
        }
        if (repaired) {
            await this.save();
        }
    }

    async save() {
        if (!this.schemaPath) return;
        await fs.promises.writeFile(this.schemaPath, JSON.stringify(this.schema, null, 2), 'utf8');
    }

    getTables() {
        return Object.keys(this.schema.tables);
    }

    getTable(name) {
        return this.schema.tables[name] || null;
    }

    async addTable(name, fields, constraints) {
        if (this.schema.tables[name]) throw new Error(`Table "${name}" already exists`);
        const hasPk = fields.some(f => f.pk);
        if (!hasPk) {
            for (const f of fields) {
                if (f.type === 'INTEGER' && /^id$/i.test(f.name)) {
                    f.pk = true;
                    break;
                }
            }
        }
        const table = { fields };
        if (constraints && constraints.length > 0) table.constraints = constraints;
        this.schema.tables[name] = table;
        await this.save();
    }

    getTableSettings(tableName) {
        const table = this.schema.tables[tableName];
        if (!table) return null;
        return table.settings || {};
    }

    async setTableSettings(tableName, settings) {
        const table = this.schema.tables[tableName];
        if (!table) throw new Error(`Table "${tableName}" not found`);
        table.settings = settings || {};
        await this.save();
    }

    async removeTable(name) {
        if (!this.getTable(name)) throw new Error(`Table "${name}" not found`);
        delete this.schema.tables[name];
        // Drop foreign keys that pointed at the removed table
        for (const table of Object.values(this.schema.tables)) {
            for (const f of table.fields) {
                if (f.fk && f.fk.table === name) delete f.fk;
            }
            if (table.constraints) table.constraints = table.constraints.filter(c => c.refTable !== name);
        }
        await this.save();
    }

    /**
     * Replace a table's column definitions in place. Settings, constraints and
     * per-field UI metadata (uiType, options, ...) of columns that keep their name survive.
     */
    async replaceTableFields(name, fields) {
        const table = this.schema.tables[name];
        if (!table) throw new Error(`Table "${name}" not found`);
        const structural = ['name', 'type', 'pk', 'notNull', 'unique', 'default', 'check', 'fk', 'autoIncrement'];
        const oldByName = new Map(table.fields.map(f => [f.name, f]));
        table.fields = fields.map(f => {
            const old = oldByName.get(f.name);
            if (!old) return f;
            const meta = {};
            for (const [k, v] of Object.entries(old)) {
                if (!structural.includes(k)) meta[k] = v;
            }
            return { ...meta, ...f };
        });
        await this.save();
    }

    async addField(tableName, field) {
        const table = this.schema.tables[tableName];
        if (!table) throw new Error(`Table "${tableName}" not found`);
        table.fields.push(field);
        await this.save();
    }

    async removeField(tableName, fieldName) {
        const table = this.schema.tables[tableName];
        if (!table) throw new Error(`Table "${tableName}" not found`);
        table.fields = table.fields.filter(f => f.name !== fieldName);
        // A constraint naming a missing column makes the generated CREATE TABLE fail
        if (table.constraints) table.constraints = table.constraints.filter(c => !c.columns?.includes(fieldName));
        for (const t of Object.values(this.schema.tables)) {
            for (const f of t.fields) {
                if (f.fk && f.fk.table === tableName && f.fk.field === fieldName) delete f.fk;
            }
            if (t.constraints) t.constraints = t.constraints.filter(c => !(c.refTable === tableName && c.refColumns?.includes(fieldName)));
        }
        await this.save();
    }

    async setForeignKey(tableName, fieldName, targetTable, targetField) {
        const table = this.schema.tables[tableName];
        if (!table) throw new Error(`Table "${tableName}" not found`);
        const field = table.fields.find(f => f.name === fieldName);
        if (!field) throw new Error(`Field "${fieldName}" not found in "${tableName}"`);
        if (!this.schema.tables[targetTable]) throw new Error(`Target table "${targetTable}" not found`);
        field.fk = { table: targetTable, field: targetField || this._getPK(targetTable) };
        await this.save();
    }

    async removeForeignKey(tableName, fieldName) {
        const table = this.schema.tables[tableName];
        if (!table) throw new Error(`Table "${tableName}" not found`);
        const field = table.fields.find(f => f.name === fieldName);
        if (field && field.fk) {
            delete field.fk;
            await this.save();
        }
    }

    _getPK(tableName) {
        const table = this.schema.tables[tableName];
        if (!table) return 'id';
        const pk = table.fields.find(f => f.pk);
        return pk ? pk.name : 'id';
    }

    /**
     * Validate that a field name is a valid identifier (no colons, spaces, or special chars).
     * Throws if invalid.
     */
    _validateFieldName(name, context) {
        if (!name || typeof name !== 'string') {
            throw new Error(`Invalid field name in ${context}: empty or non-string`);
        }
        if (name.includes(':')) {
            throw new Error(`Invalid field name "${name}" in ${context}: contains ':' which is reserved for command syntax`);
        }
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
            throw new Error(`Invalid field name "${name}" in ${context}: must be a valid identifier`);
        }
    }

    // --- Query management ---

    getQueries() {
        return this.schema.queries || {};
    }

    getQuery(name) {
        const queries = this.schema.queries || {};
        return queries[name] || null;
    }

    async addQuery(name, columns, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        if (!this.schema.queries) this.schema.queries = {};
        if (this.schema.queries[name]) throw new Error(`Query "${name}" already exists`);
        this.schema.queries[name] = { columns: columns || [], filters: filters || [], sortBy: sortBy || null, limit: limit || '', groupBy: groupBy || [], having: having || [], distinct: !!distinct, joinType: joinType || 'LEFT' };
        await this.save();
    }

    async removeQuery(name) {
        if (!this.schema.queries) return;
        delete this.schema.queries[name];
        await this.save();
    }

    async updateQuery(name, columns, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        if (!this.schema.queries) this.schema.queries = {};
        this.schema.queries[name] = { columns: columns || [], filters: filters || [], sortBy: sortBy || null, limit: limit || '', groupBy: groupBy || [], having: having || [], distinct: !!distinct, joinType: joinType || 'LEFT' };
        await this.save();
    }

    // --- Business Rules management ---

    getRules() {
        return this.schema.rules || [];
    }

    getRule(index) {
        const rules = this.schema.rules || [];
        return rules[index] || null;
    }

    async addRule(rule) {
        if (!this.schema.rules) this.schema.rules = [];
        this.schema.rules.push(rule);
        await this.save();
    }

    async removeRule(index) {
        if (!this.schema.rules) return;
        this.schema.rules.splice(index, 1);
        await this.save();
    }

    async updateRule(index, rule) {
        if (!this.schema.rules) this.schema.rules = [];
        this.schema.rules[index] = rule;
        await this.save();
    }

    async clearRules() {
        this.schema.rules = [];
        await this.save();
    }

    // --- Auth config (used by "Generate Project Files") ---

    getAuthConfig() {
        return this.schema.auth || null;
    }

    async setAuthConfig(config) {
        if (config) this.schema.auth = config;
        else delete this.schema.auth;
        await this.save();
    }

    // --- Action Routes management ---

    getActionRoutes() {
        return this.schema.actionRoutes || [];
    }

    addActionRoute(route) {
        if (!this.schema.actionRoutes) this.schema.actionRoutes = [];
        this.schema.actionRoutes.push(route);
        return this.save();
    }

    removeActionRoute(index) {
        if (!this.schema.actionRoutes) return;
        this.schema.actionRoutes.splice(index, 1);
        return this.save();
    }

    updateActionRoute(index, route) {
        if (!this.schema.actionRoutes) this.schema.actionRoutes = [];
        this.schema.actionRoutes[index] = route;
        return this.save();
    }

    // --- Screens management ---

    getScreens() {
        return this.schema.screens || [];
    }

    getScreen(name) {
        const screens = this.getScreens();
        return screens.find(s => s.name === name) || null;
    }

    async addScreen(screen) {
        if (!screen.name || !screen.type) {
            throw new Error('Screen must have a name and type');
        }
        const existing = this.getScreen(screen.name);
        if (existing) {
            throw new Error(`Screen "${screen.name}" already exists`);
        }
        const validTypes = ['transaction', 'report', 'widget'];
        if (!validTypes.includes(screen.type)) {
            throw new Error(`Invalid screen type "${screen.type}". Must be one of: ${validTypes.join(', ')}`);
        }
        if (!this.schema.screens) this.schema.screens = [];
        this.schema.screens.push(JSON.parse(JSON.stringify(screen)));
        await this.save();
    }

    async removeScreen(name) {
        if (!this.schema.screens) return;
        const index = this.schema.screens.findIndex(s => s.name === name);
        if (index === -1) {
            throw new Error(`Screen "${name}" not found`);
        }
        this.schema.screens.splice(index, 1);
        await this.save();
    }

    async updateScreen(name, updates) {
        const screen = this.getScreen(name);
        if (!screen) {
            throw new Error(`Screen "${name}" not found`);
        }
        if (updates.name && updates.name !== name) {
            const dup = this.getScreen(updates.name);
            if (dup) throw new Error(`Screen "${updates.name}" already exists`);
        }
        if (!this.schema.screens) this.schema.screens = [];
        const idx = this.schema.screens.findIndex(s => s.name === name);
        this.schema.screens[idx] = this._deepMerge(screen, updates);
        await this.save();
    }

    _deepMerge(target, source) {
        const result = JSON.parse(JSON.stringify(target));
        for (const key of Object.keys(source)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this._deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = JSON.parse(JSON.stringify(source[key]));
            }
        }
        return result;
    }

    /**
     * Parse a CREATE TABLE SQL statement into table name and field definitions.
     * Supports: CREATE TABLE [IF NOT EXISTS] name (colDefs...)
     * Column constraints: PRIMARY KEY, NOT NULL, DEFAULT, REFERENCES, UNIQUE, AUTOINCREMENT
     */
    parseCreateTable(sql) {
        sql = sql.trim();
        // Remove surrounding backticks if wrapped in template literal
        if (sql.startsWith('`') && sql.endsWith('`')) {
            sql = sql.slice(1, -1).trim();
        }

        const tableMatch = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`?)(\w+)(?:`?)\s*\(([\s\S]*)\)\s*;?\s*$/i);
        if (!tableMatch) {
            throw new Error('Invalid CREATE TABLE syntax. Expected: CREATE TABLE [IF NOT EXISTS] TableName (columns...)');
        }

        const tableName = tableMatch[1];
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(tableName)) {
            throw new Error(`Invalid table name "${tableName}": must be a valid identifier`);
        }

        const columnsSection = tableMatch[2];
        const colDefs = this._splitSQLColumns(columnsSection);
        const fields = [];
        const constraints = [];

        for (const colDef of colDefs) {
            const trimmed = colDef.trim();
            if (!trimmed) continue;

            // Parse table-level constraints
            if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE(?:\s+(?:KEY|INDEX))?(?:\s+\w+)?\s*\(|CHECK\s*\(|CONSTRAINT)\b/i.test(trimmed)) {
                const c = this._parseTableConstraint(trimmed);
                if (c) constraints.push(c);
                continue;
            }
            // Skip INDEX (MySQL-specific, no constraint in SQLite)
            if (/^INDEX\b/i.test(trimmed)) continue;

            const tokens = this._tokenizeColumnDef(trimmed);
            if (tokens.length < 2) continue;

            const rawName = tokens[0];
            this._validateFieldName(rawName, `"${tableName}"`);
            const field = { name: rawName, type: 'TEXT', rawType: tokens[1] };

            field.type = this._parseSqlType(tokens[1]);

            // Parse column constraints
            for (let i = 2; i < tokens.length; i++) {
                const t = tokens[i].toUpperCase();
                if (t === 'PRIMARY' && tokens[i + 1]?.toUpperCase() === 'KEY') {
                    field.pk = true;
                    i++;
                } else if (/^(AUTOINCREMENT|AUTO_INCREMENT)$/.test(t)) {
                    field.autoIncrement = true;
                } else if (t === 'NOT' && tokens[i + 1]?.toUpperCase() === 'NULL') {
                    field.notNull = true;
                    i++;
                } else if (t === 'DEFAULT') {
                    let dv = tokens[++i];
                    if (dv === undefined) break;
                    if ((dv.startsWith("'") && dv.endsWith("'")) || (dv.startsWith('"') && dv.endsWith('"'))) {
                        dv = dv.slice(1, -1);
                    }
                    field.default = dv;
                } else if (t === 'REFERENCES') {
                    const refMatch = trimmed.match(/REFERENCES\s+(\w+)\s*\((\w+)\)/i);
                    if (refMatch) {
                        field.fk = { table: refMatch[1], field: refMatch[2] };
                    }
                } else if (t === 'UNIQUE') {
                    field.unique = true;
                } else if (/^CHECK\s*\(/i.test(tokens[i])) {
                    const checkMatch = tokens[i].match(/^CHECK\s*\(\s*([\s\S]*?)\s*\)\s*$/i);
                    if (checkMatch) {
                        field.check = checkMatch[1];
                    }
                }
            }

            fields.push(field);
        }

        if (fields.length === 0) {
            throw new Error('No columns found in CREATE TABLE statement');
        }

        return { tableName, fields, constraints: constraints.length > 0 ? constraints : undefined };
    }

    /**
     * Split a SQL columns section by top-level commas (respecting parentheses nesting).
     */
    _splitSQLColumns(columnsSection) {
        return splitSql(columnsSection, ',');
    }

    _parseSqlType(rawType) {
        const t = rawType.toUpperCase().replace(/\(.*\)/, '');
        if (/^(INTEGER|INT|BIGINT|SMALLINT|TINYINT|MEDIUMINT|INT2|INT8)$/.test(t)) return 'INTEGER';
        if (/^(REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL|NUMBER)$/.test(t)) return 'REAL';
        if (/^(TEXT|VARCHAR|CHARACTER?|NVARCHAR|NCHAR|CLOB|LONGTEXT|MEDIUMTEXT|TINYTEXT|CHAR)$/.test(t)) return 'TEXT';
        if (/^(BLOB|LONGBLOB|MEDIUMBLOB|TINYBLOB|BINARY|VARBINARY)$/.test(t)) return 'BLOB';
        if (/^(DATE|DATETIME|TIMESTAMP|TIME|YEAR)$/.test(t)) return 'TEXT';
        if (/^(BOOLEAN|BOOL|BIT)$/.test(t)) return 'INTEGER';
        if (/^(SERIAL|UNSIGNED)/.test(t)) return 'INTEGER';
        return 'TEXT';
    }

    /**
     * Tokenize a column definition by whitespace, respecting parentheses.
     */
    _tokenizeColumnDef(colDef) {
        const tokens = [];
        let current = '';
        let depth = 0;
        let quote = null;
        for (let i = 0; i < colDef.length; i++) {
            const c = colDef[i];
            if (quote) {
                current += c;
                if (c === quote) {
                    if (colDef[i + 1] === quote) current += colDef[++i];
                    else quote = null;
                } else if (c === '\\' && i + 1 < colDef.length) current += colDef[++i];
                continue;
            }
            if (c === "'" || c === '"' || c === '`') { quote = c; current += c; continue; }
            if (c === '(') depth++;
            else if (c === ')') depth--;
            else if (/\s/.test(c) && depth === 0) {
                if (current.trim()) tokens.push(current.trim());
                current = '';
                continue;
            }
            current += c;
        }
        if (current.trim()) tokens.push(current.trim());
        return tokens;
    }

    /**
     * Parse a table-level constraint from a column definition string.
     * Handles: PRIMARY KEY (...), UNIQUE (...), FOREIGN KEY (...) REFERENCES T(...),
     * CHECK (...), and CONSTRAINT name ... variants.
     */
    _parseTableConstraint(def) {
        let name = null;
        let rest = def.trim();

        // CONSTRAINT name ...
        const cm = rest.match(/^CONSTRAINT\s+(\w+)\s+/i);
        if (cm) {
            name = cm[1];
            rest = rest.substring(cm[0].length);
        }

        // PRIMARY KEY (col1, col2, ...)
        let m = rest.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)\s*$/i);
        if (m) {
            return { type: 'PRIMARY KEY', name, columns: m[1].split(',').map(s => s.trim().replace(/`/g, '')) };
        }

        // UNIQUE [KEY|INDEX] [index_name] (col1, col2, ...)
        m = rest.match(/^UNIQUE(?:\s+(?:KEY|INDEX))?(?:\s+\w+)?\s*\(([^)]+)\)\s*$/i);
        if (m) {
            return { type: 'UNIQUE', name, columns: m[1].split(',').map(s => s.trim()) };
        }

        // FOREIGN KEY (col1, ...) REFERENCES Table(col1, ...)
        m = rest.match(/^FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+(?:`?)(\w+)(?:`?)\s*\((?:`?)([^)`]+)(?:`?)\)\s*$/i);
        if (m) {
            return { type: 'FOREIGN KEY', name, columns: m[1].split(',').map(s => s.trim().replace(/`/g, '')), refTable: m[2].replace(/`/g, ''), refColumns: m[3].split(',').map(s => s.trim().replace(/`/g, '')) };
        }

        // CHECK (expr) — find matching paren
        if (/^CHECK\s*\(/i.test(rest)) {
            const startIdx = rest.indexOf('(');
            let depth = 0;
            let expr = '';
            for (let k = startIdx + 1; k < rest.length; k++) {
                if (rest[k] === '(') depth++;
                else if (rest[k] === ')') {
                    if (depth === 0) { expr = rest.substring(startIdx + 1, k); break; }
                    depth--;
                }
            }
            if (expr !== '') {
                return { type: 'CHECK', name, expr: expr.trim() };
            }
        }

        return null;
    }

    /**
     * Parse a MySQL CREATE TABLE statement into table name and field definitions.
     * Handles MySQL-specific syntax:
     *   - AUTO_INCREMENT
     *   - VARCHAR(N), CHAR(N), NVARCHAR(N)
     *   - INT(N), BIGINT, SMALLINT, TINYINT
     *   - DECIMAL(M,N), FLOAT, DOUBLE
     *   - ENGINE=InnoDB, DEFAULT CHARSET=utf8, etc.
     *   - Backtick-quoted identifiers
     *   - UNIQUE, INDEX, KEY, CONSTRAINT
     *   - COMMENT '...'
     * @param {string} sql - The MySQL CREATE TABLE statement
     * @returns {{ tableName: string, fields: Array, rawSql: string }}
     */
    parseMySqlCreateTable(sql) {
        sql = sql.trim();

        // Remove ENGINE, DEFAULT CHARSET, COLLATE, AUTO_INCREMENT=N, ROW_FORMAT, etc.
        sql = sql.replace(/\s+ENGINE\s*=\s*\w+/gi, '');
        sql = sql.replace(/\s+DEFAULT\s+CHARSET\s*=\s*\w+/gi, '');
        sql = sql.replace(/\s+COLLATE\s*=\s*\w+/gi, '');
        sql = sql.replace(/\s+AUTO_INCREMENT\s*=\s*\d+/gi, '');
        sql = sql.replace(/\s+ROW_FORMAT\s*=\s*\w+/gi, '');
        sql = sql.replace(/\s+COMMENT\s*=\s*'[^']*'/gi, '');
        sql = sql.replace(/\s+PACK_KEYS\s*=\s*\d+/gi, '');
        sql = sql.replace(/\s+STATS\w+\s*=\s*\d+/gi, '');

        // Parse table name and columns
        const tableMatch = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*)\)\s*;?\s*$/i);
        if (!tableMatch) {
            throw new Error('Invalid MySQL CREATE TABLE syntax');
        }

        const tableName = tableMatch[1];
        const columnsSection = tableMatch[2];
        const colDefs = this._splitSQLColumns(columnsSection);
        const fields = [];

        const constraints = [];

        for (const colDef of colDefs) {
            const trimmed = colDef.trim();
            if (!trimmed) continue;

            // Parse table-level constraints (including MySQL-specific UNIQUE KEY/INDEX, INDEX, KEY)
            if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE(?:\s+(?:KEY|INDEX))?(?:\s+\w+)?\s*\(|CHECK\s*\(|CONSTRAINT)\b/i.test(trimmed)) {
                const c = this._parseTableConstraint(trimmed);
                if (c) constraints.push(c);
                continue;
            }
            // Skip MySQL-only INDEX/KEY/FULLTEXT/SPATIAL (not real SQLite constraints)
            if (/^(INDEX|KEY|FULLTEXT|SPATIAL)\b/i.test(trimmed)) continue;

            const tokens = this._tokenizeColumnDef(trimmed);
            if (tokens.length < 2) continue;

            // Handle backtick-quoted field names
            const rawName = tokens[0].replace(/`/g, '');
            if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(rawName)) continue;

            const field = { name: rawName, type: 'TEXT', rawType: tokens[1].toUpperCase().replace(/\(.*\)/, '') };

            field.type = this._parseSqlType(tokens[1]);

            // Parse column constraints
            for (let i = 2; i < tokens.length; i++) {
                const t = tokens[i].toUpperCase();

                // AUTO_INCREMENT => PK + autoincrement
                if (/^AUTO_INCREMENT$/i.test(t)) {
                    field.pk = true;
                    field.autoIncrement = true;
                }

                // PRIMARY KEY
                if (t === 'PRIMARY' && tokens[i + 1]?.toUpperCase() === 'KEY') {
                    field.pk = true;
                    i++;
                }

                // NOT NULL
                if (t === 'NOT' && tokens[i + 1]?.toUpperCase() === 'NULL') {
                    field.notNull = true;
                    i++;
                }

                // DEFAULT value
                if (t === 'DEFAULT') {
                    let dv = tokens[++i];
                    if (dv === undefined) break;
                    if (dv.toUpperCase() === 'NULL') {
                        field.default = null;
                    } else if (['CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME'].includes(dv.toUpperCase())) {
                        field.default = dv.toUpperCase();
                    } else {
                        if ((dv.startsWith("'") && dv.endsWith("'")) || (dv.startsWith('"') && dv.endsWith('"'))) {
                            dv = dv.slice(1, -1);
                        }
                        field.default = dv;
                    }
                }

                // UNIQUE
                if (t === 'UNIQUE') {
                    field.unique = true;
                }

                // CHECK (column-level)
                if (/^CHECK\s*\(/i.test(tokens[i])) {
                    const checkMatch = tokens[i].match(/^CHECK\s*\(\s*([\s\S]*?)\s*\)\s*$/i);
                    if (checkMatch) {
                        field.check = checkMatch[1];
                    }
                }

                // REFERENCES (inline FK)
                if (t === 'REFERENCES') {
                    const refMatch = trimmed.match(/REFERENCES\s+`?(\w+)`?\s*\(`?(\w+)`?\)/i);
                    if (refMatch) {
                        field.fk = { table: refMatch[1], field: refMatch[2] };
                    }
                }

                // UNSIGNED — just skip, SQLite doesn't have unsigned
                if (t === 'UNSIGNED') {
                    continue;
                }

                // COMMENT — skip
                if (t === 'COMMENT') {
                    i++; // Skip the comment string
                }
            }

            fields.push(field);
        }

        if (fields.length === 0) {
            throw new Error('No columns found in MySQL CREATE TABLE statement');
        }

        // Check if any field has a size suffix like VARCHAR(255) and update type
        for (const colDef of colDefs) {
            const trimmed = colDef.trim();
            const tokens = this._tokenizeColumnDef(trimmed);
            if (tokens.length >= 2) {
                const rawName = tokens[0].replace(/`/g, '');
                const typePart = tokens[1];
                const field = fields.find(f => f.name === rawName);
                if (field && /VARCHAR|CHAR|NVARCHAR/i.test(typePart)) {
                    field.type = 'TEXT';
                }
            }
        }

        return { tableName, fields, constraints: constraints.length > 0 ? constraints : undefined, rawSql: sql };
    }

    /**
     * Parse INSERT INTO statements from a MySQL SQL dump and generate
     * equivalent INSERT statements for SQLite.
     * Handles: INSERT INTO `table` (col1, col2) VALUES (v1, v2), (v3, v4);
     * @param {string} sql - The SQL dump content
     * @returns {Array<{ table: string, columns: string[], values: Array[] }>}
     */
    parseInsertStatements(sql) {
        const results = [];
        // Match INSERT INTO statements with optional backticks
        const insertRegex = /INSERT\s+INTO\s+`?(\w+)`?\s*(?:\(([^)]+)\))?\s*VALUES\s*([\s\S]*)/i;
        let match;

        for (const statement of splitSql(sql)) {
            match = insertRegex.exec(statement);
            if (!match) continue;
            const tableName = match[1];
            const columnsStr = match[2];
            const valuesStr = match[3];

            if (!columnsStr || !valuesStr) continue;

            // Parse column names (strip backticks)
            const columns = columnsStr.split(',').map(c => c.trim().replace(/`/g, ''));

            // Parse all value tuples
            const valueTuples = [];
            for (const tuple of splitSql(valuesStr, ',')) {
                const rawValues = tuple.trim().replace(/^\(/, '').replace(/\)$/, '');
                const parsed = this._parseSqlValues(rawValues);
                valueTuples.push(parsed);
            }

            if (columns.length > 0 && valueTuples.length > 0) {
                results.push({
                    table: tableName,
                    columns: columns,
                    values: valueTuples
                });
            }
        }

        return results;
    }

    /**
     * Generate SQLite-compatible INSERT statements from parsed INSERT data.
     * @param {Array} inserts - Output from parseInsertStatements()
     * @returns {string} SQLite-compatible INSERT SQL
     */
    generateSqliteInserts(inserts) {
        let sql = '';
        for (const insert of inserts) {
            const colList = insert.columns.join(', ');
            for (const values of insert.values) {
                const quotedValues = values.map(v => {
                    if (v === null || v === undefined || v.toUpperCase() === 'NULL') return 'NULL';
                    if (v.toUpperCase() === 'CURRENT_TIMESTAMP') return "datetime('now')";
                    if (/^-?\d+(\.\d+)?$/.test(v)) return v;
                    return "'" + v.replace(/'/g, "''") + "'";
                }).join(', ');
                sql += `INSERT INTO ${insert.table} (${colList}) VALUES (${quotedValues});\n`;
            }
        }
        return sql;
    }

    /**
     * Parse SQL values string handling quoted strings with commas inside.
     */
    _parseSqlValues(rawValues) {
        const values = [];
        let current = '';
        let inString = false;
        let stringChar = null;

        for (let i = 0; i < rawValues.length; i++) {
            const ch = rawValues[i];

            if (inString) {
                if (ch === stringChar && rawValues[i + 1] === stringChar) {
                    current += ch;
                    i++;
                    continue;
                }
                if (ch === stringChar) {
                    inString = false;
                    continue;
                }
                current += ch;
                continue;
            }

            if (ch === "'" || ch === '"') {
                inString = true;
                stringChar = ch;
                continue;
            }

            if (ch === ',' && !inString) {
                values.push(current.trim());
                current = '';
                continue;
            }

            current += ch;
        }

        if (current.length || rawValues.trim().endsWith(',') || values.length) {
            values.push(current.trim());
        }

        return values;
    }

    /**
     * Parse a full MySQL SQL dump file and produce schema + data.
     * @param {string} sql - Complete SQL dump content
     * @returns {{ tables: Array<{ tableName: string, fields: Array }>, inserts: Array, sqliteSchema: string, sqliteData: string }}
     */
    parseMySqlDump(sql) {
        const tables = [];
        const allInserts = [];
        let sqliteSchema = '';
        let sqliteData = '';

        // Extract CREATE TABLE statements
        const createRegex = /CREATE\s+TABLE\s+/i;
        let match;
        for (const statement of splitSql(sql)) {
            match = createRegex.exec(statement);
            if (!match) continue;
            try {
                const { tableName, fields, constraints } = this.parseMySqlCreateTable(statement.slice(match.index));
                tables.push({ tableName, fields, constraints });
            } catch (e) {
                // Skip invalid CREATE TABLE statements
                console.error('Failed to parse CREATE TABLE:', e.message);
            }
        }

        // Extract INSERT INTO statements
        const inserts = this.parseInsertStatements(sql);
        allInserts.push(...inserts);

        // Generate SQLite schema DDL
        const { CodeGenerator } = require('./generator');
        const gen = new CodeGenerator(this);

        // Temporarily register tables to use the generator
        for (const { tableName, fields, constraints } of tables) {
            // Don't actually add to schema — just generate the SQL
            // We'll create a temporary schema context
            const tempSchema = {
                getTable: (name) => {
                    const t = tables.find(t => t.tableName === name);
                    if (!t) return null;
                    const result = { fields: t.fields };
                    if (t.constraints) result.constraints = t.constraints;
                    return result;
                },
                getTables: () => tables.map(t => t.tableName)
            };
            const tempGen = new (require('./generator').CodeGenerator)(tempSchema);
            // Override the schemaRegistry reference temporarily
            gen.schemaRegistry = tempSchema;
            try {
                sqliteSchema += gen.generateCreateTable(tableName) + '\n\n';
            } catch (e) {
                sqliteSchema += `-- Error generating CREATE TABLE for ${tableName}: ${e.message}\n`;
            }
        }

        // Generate SQLite INSERT statements
        if (allInserts.length > 0) {
            sqliteData = this.generateSqliteInserts(allInserts);
        }

        return {
            tables,
            inserts: allInserts,
            sqliteSchema,
            sqliteData
        };
    }

    parseInlineSpec(input) {
        const colonIdx = input.indexOf(':');
        if (colonIdx < 0) throw new Error('Format: TableName:fieldDef, fieldDef, ...');
        const tableName = input.substring(0, colonIdx).trim();
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(tableName)) {
            throw new Error(`Invalid table name "${tableName}": must be a valid identifier`);
        }
        const fieldParts = [];
        let current = '';
        let inQuote = null;
        const rest = input.substring(colonIdx + 1);
        for (let ci = 0; ci < rest.length; ci++) {
            const ch = rest[ci];
            if (inQuote) {
                if (ch === inQuote) inQuote = null;
                current += ch;
            } else if (ch === "'" || ch === '"') {
                inQuote = ch;
                current += ch;
            } else if (ch === ',') {
                const trimmed = current.trim();
                if (trimmed) fieldParts.push(trimmed);
                current = '';
            } else {
                current += ch;
            }
        }
        const trimmed = current.trim();
        if (trimmed) fieldParts.push(trimmed);
        const fields = [];
        for (const part of fieldParts) {
            const tokens = part.split(/\s+/).map(t => t.replace(/[;,]+$/, ''));
            const rawName = tokens[0];
            this._validateFieldName(rawName, `"${tableName}"`);
            const field = { name: rawName, type: 'TEXT' };
            for (let i = 1; i < tokens.length; i++) {
                const t = tokens[i].toUpperCase();
                if (t === 'PRIMARY') field.pk = true;
                else if (t === 'NOT' && tokens[i + 1]?.toUpperCase() === 'NULL') { field.notNull = true; i++; }
                else if (t === 'UNIQUE') field.unique = true;
                else if (t === 'DEFAULT') {
                    let dvParts = [];
                    while (i + 1 < tokens.length) {
                        const next = tokens[i + 1];
                        const upper = next.toUpperCase();
                        if (['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NOT', 'PRIMARY', 'DEFAULT', 'UNIQUE'].includes(upper) || /^FK->/i.test(upper) || /^CHECK\s*\(/i.test(next)) break;
                        dvParts.push(tokens[++i]);
                    }
                    let dv = dvParts.join(' ');
                    dv = dv.replace(/;+$/, '').replace(/^['"]|['"]$/g, '');
                    field.default = dv;
                } else if (/^fk->/i.test(tokens[i])) {
                    let fkSpec = tokens[i];
                    if (!/\(\w+\)$/.test(fkSpec) && i + 1 < tokens.length) {
                        fkSpec += tokens[++i];
                    }
                    const match = fkSpec.match(/FK->\s*(\w+)\s*\((\w+)\)/i);
                    if (match) {
                        const targetTable = match[1];
                        const targetField = match[2];
                        if (!this.schema.tables[targetTable]) {
                            throw new Error(`FK target table "${targetTable}" not found in schema. Registered tables: ${Object.keys(this.schema.tables).join(', ') || 'none'}`);
                        }
                        this._validateFieldName(targetField, `FK target "${targetTable}"`);
                        field.fk = { table: targetTable, field: targetField };
                    }
                } else if (/^CHECK\s*\(/i.test(tokens[i])) {
                    let expr = tokens[i].replace(/^CHECK\s*\(\s*/i, '');
                    let open = 0;
                    let close = (tokens[i].match(/\)/g) || []).length;
                    while (i + 1 < tokens.length && close <= open) {
                        const nxt = tokens[++i];
                        expr += ' ' + nxt;
                        open += (nxt.match(/\(/g) || []).length;
                        close += (nxt.match(/\)/g) || []).length;
                    }
                    expr = expr.replace(/\s*\)\s*$/, '');
                    field.check = expr.trim();
                } else if (['INTEGER', 'TEXT', 'REAL', 'BLOB'].includes(t)) {
                    field.type = t;
                }
            }
            fields.push(field);
        }
        return { tableName, fields };
    }
}

module.exports = { SchemaRegistry };
