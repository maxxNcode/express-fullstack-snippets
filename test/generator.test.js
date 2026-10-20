// Regression: INSERT/UPDATE column order must match the .run() params (user fields first, then timestamps)
const assert = require('assert');
const { CodeGenerator } = require('../src/generator');

const tables = { Posts: { fields: [
    { name: 'id', type: 'INTEGER', pk: true },
    { name: 'created_at', type: 'TEXT' },
    { name: 'title', type: 'TEXT' },
    { name: 'updated_at', type: 'TEXT' },
    { name: 'body', type: 'TEXT' }
] } };
const reg = { getTable: n => tables[n], getTables: () => Object.keys(tables), getTableSettings: () => ({}) };
const prep = new CodeGenerator(reg).generatePrepStatements('Posts');

assert.ok(prep.includes('INSERT INTO Posts (title, body, created_at, updated_at)'), prep);
assert.ok(prep.includes('UPDATE Posts SET title = ?, body = ?, updated_at = ? WHERE id = ?'), prep);
console.log('generator: timestamp column order PASSED');
