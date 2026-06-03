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
        } catch {
            this.schema = { tables: {} };
        }
        return true;
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

    parseInlineSpec(input) {
        const colonIdx = input.indexOf(':');
        if (colonIdx < 0) throw new Error('Format: TableName:fieldDef, fieldDef, ...');
        const tableName = input.substring(0, colonIdx).trim();
        const fieldParts = input.substring(colonIdx + 1).split(',').map(s => s.trim()).filter(Boolean);
        const fields = [];
        for (const part of fieldParts) {
            const tokens = part.split(/\s+/);
            const field = { name: tokens[0], type: 'TEXT' };
            for (let i = 1; i < tokens.length; i++) {
                const t = tokens[i].toUpperCase();
                if (t === 'PRIMARY') field.pk = true;
                else if (t === 'NOT' && tokens[i + 1]?.toUpperCase() === 'NULL') { field.notNull = true; i++; }
                else if (t === 'DEFAULT') { field.default = tokens[++i]; }
                else if (tokens[i].startsWith('FK->') || tokens[i].startsWith('fk->')) {
                    const match = tokens[i].match(/FK->(\w+)\((\w+)\)/i);
                    if (match) field.fk = { table: match[1], field: match[2] };
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
