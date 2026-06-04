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
        this.schema.tables[name] = { fields };
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

    async addQuery(name, columns, filters, sortBy, limit, groupBy, having, distinct) {
        if (!this.schema.queries) this.schema.queries = {};
        if (this.schema.queries[name]) throw new Error(`Query "${name}" already exists`);
        this.schema.queries[name] = { columns: columns || [], filters: filters || [], sortBy: sortBy || null, limit: limit || '', groupBy: groupBy || [], having: having || [], distinct: !!distinct };
        await this.save();
    }

    async removeQuery(name) {
        if (!this.schema.queries) return;
        delete this.schema.queries[name];
        await this.save();
    }

    async updateQuery(name, columns, filters, sortBy, limit, groupBy, having, distinct) {
        if (!this.schema.queries) this.schema.queries = {};
        this.schema.queries[name] = { columns: columns || [], filters: filters || [], sortBy: sortBy || null, limit: limit || '', groupBy: groupBy || [], having: having || [], distinct: !!distinct };
        await this.save();
    }

    parseInlineSpec(input) {
        const colonIdx = input.indexOf(':');
        if (colonIdx < 0) throw new Error('Format: TableName:fieldDef, fieldDef, ...');
        const tableName = input.substring(0, colonIdx).trim();
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(tableName)) {
            throw new Error(`Invalid table name "${tableName}": must be a valid identifier`);
        }
        const fieldParts = input.substring(colonIdx + 1).split(',').map(s => s.trim()).filter(Boolean);
        const fields = [];
        for (const part of fieldParts) {
            const tokens = part.split(/\s+/);
            const rawName = tokens[0];
            this._validateFieldName(rawName, `"${tableName}"`);
            const field = { name: rawName, type: 'TEXT' };
            for (let i = 1; i < tokens.length; i++) {
                const t = tokens[i].toUpperCase();
                if (t === 'PRIMARY') field.pk = true;
                else if (t === 'NOT' && tokens[i + 1]?.toUpperCase() === 'NULL') { field.notNull = true; i++; }
                else if (t === 'DEFAULT') { field.default = tokens[++i];                } else if (tokens[i].startsWith('FK->') || tokens[i].startsWith('fk->')) {
                    const match = tokens[i].match(/FK->(\w+)\((\w+)\)/i);
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
