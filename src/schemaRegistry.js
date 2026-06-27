const fs = require('fs');
const path = require('path');

const SCHEMA_FILE = '.njs-schema.json';

class SchemaRegistry {
    constructor() {
        this.schemaPath = null;
        this.schema = { tables: {} };
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
        } catch {
            this.schema = { tables: {} };
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

    async addTable(name, fields) {
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
        this.schema.tables[name] = { fields };
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
        delete this.schema.tables[name];
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

        for (const colDef of colDefs) {
            const trimmed = colDef.trim();
            if (!trimmed) continue;

            // Skip table-level constraints
            if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|INDEX|CONSTRAINT)\b/i.test(trimmed)) continue;

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
                    if (field.type === 'TEXT') field.type = 'INTEGER';
                    i++;
                } else if (/^AUTOINCREMENT|AUTO_INCREMENT$/.test(t)) {
                    field.autoIncrement = true;
                } else if (t === 'NOT' && tokens[i + 1]?.toUpperCase() === 'NULL') {
                    field.notNull = true;
                    i++;
                } else if (t === 'DEFAULT') {
                    let dv = tokens[++i];
                    // Strip surrounding single or double quotes
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
                }
            }

            fields.push(field);
        }

        if (fields.length === 0) {
            throw new Error('No columns found in CREATE TABLE statement');
        }

        return { tableName, fields };
    }

    /**
     * Split a SQL columns section by top-level commas (respecting parentheses nesting).
     */
    _splitSQLColumns(columnsSection) {
        const parts = [];
        let depth = 0;
        let current = '';
        for (let i = 0; i < columnsSection.length; i++) {
            const c = columnsSection[i];
            if (c === '(') depth++;
            else if (c === ')') depth--;
            else if (c === ',' && depth === 0) {
                parts.push(current);
                current = '';
                continue;
            }
            current += c;
        }
        if (current.trim()) parts.push(current);
        return parts;
    }

    _parseSqlType(rawType) {
        const t = rawType.toUpperCase().replace(/\(.*\)/, '');
        if (/^(INTEGER|INT|BIGINT|SMALLINT|TINYINT|MEDIUMINT|INT2|INT8)$/.test(t)) return 'INTEGER';
        if (/^(REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL|NUMBER)$/.test(t)) return 'REAL';
        if (/^(TEXT|VARCHAR|CHARACTER?|NVARCHAR|NCHAR|CLOB|LONGTEXT|MEDIUMTEXT|TINYTEXT|CHAR)$/.test(t)) return 'TEXT';
        if (/^BLOB|LONGBLOB|MEDIUMBLOB|TINYBLOB|BINARY|VARBINARY$/.test(t)) return 'BLOB';
        if (/^(DATE|DATETIME|TIMESTAMP|TIME|YEAR)$/.test(t)) return 'TEXT';
        if (/^BOOLEAN|BOOL|BIT$/.test(t)) return 'INTEGER';
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
        for (let i = 0; i < colDef.length; i++) {
            const c = colDef[i];
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

        for (const colDef of colDefs) {
            const trimmed = colDef.trim();
            if (!trimmed) continue;

            // Skip table-level constraints (PRIMARY KEY, FOREIGN KEY, INDEX, UNIQUE KEY, KEY, CONSTRAINT, CHECK)
            if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s+(KEY|INDEX)?|INDEX|KEY|CONSTRAINT|CHECK|FULLTEXT|SPATIAL)\b/i.test(trimmed)) {
                continue;
            }

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
                    if (field.type === 'TEXT') field.type = 'INTEGER';
                }

                // PRIMARY KEY
                if (t === 'PRIMARY' && tokens[i + 1]?.toUpperCase() === 'KEY') {
                    field.pk = true;
                    if (field.type === 'TEXT') field.type = 'INTEGER';
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
                    if (dv.toUpperCase() === 'NULL') {
                        field.default = null;
                    } else if (dv.toUpperCase() === 'CURRENT_TIMESTAMP') {
                        field.default = 'CURRENT_TIMESTAMP';
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

        return { tableName, fields, rawSql: sql };
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
        const insertRegex = /INSERT\s+INTO\s+`?(\w+)`?\s*(?:\(([^)]+)\))?\s*VALUES\s*((?:\([^)]+\)\s*,?\s*)+);?/gi;
        let match;

        while ((match = insertRegex.exec(sql)) !== null) {
            const tableName = match[1];
            const columnsStr = match[2];
            const valuesStr = match[3];

            if (!columnsStr || !valuesStr) continue;

            // Parse column names (strip backticks)
            const columns = columnsStr.split(',').map(c => c.trim().replace(/`/g, ''));

            // Parse all value tuples
            const valueTuples = [];
            const valueRegex = /\(([^)]+)\)/g;
            let vMatch;
            while ((vMatch = valueRegex.exec(valuesStr)) !== null) {
                const rawValues = vMatch[1];
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

        if (current.trim()) {
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
        const createRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[^;]+;/gi;
        let match;
        while ((match = createRegex.exec(sql)) !== null) {
            try {
                const { tableName, fields } = this.parseMySqlCreateTable(match[0]);
                tables.push({ tableName, fields });
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
        for (const { tableName, fields } of tables) {
            // Don't actually add to schema — just generate the SQL
            // We'll create a temporary schema context
            const tempSchema = {
                getTable: (name) => {
                    const t = tables.find(t => t.tableName === name);
                    if (!t) return null;
                    return { fields: t.fields };
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
                else if (t === 'DEFAULT') {
                    let dvParts = [];
                    while (i + 1 < tokens.length) {
                        const next = tokens[i + 1];
                        const upper = next.toUpperCase();
                        if (['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NOT', 'PRIMARY', 'DEFAULT'].includes(upper) || /^FK->/i.test(upper)) break;
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
                } else if (['INTEGER', 'TEXT', 'REAL', 'BLOB'].includes(t)) {
                    field.type = t;
                }
            }
            if (field.pk && field.type === 'TEXT') field.type = 'INTEGER';
            fields.push(field);
        }
        return { tableName, fields };
    }
}

module.exports = { SchemaRegistry };
