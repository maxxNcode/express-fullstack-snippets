const assert = require('assert');
const vm = require('vm');
const { Scaffer } = require('../src/scaffolder');

const tables = {
    Authors: { fields: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'name', type: 'TEXT' }] },
    Posts: { fields: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'author_id', type: 'INTEGER', fk: { table: 'Authors', field: 'id' } }
    ] }
};
const registry = {
    getTable: name => tables[name],
    getTables: () => Object.keys(tables),
    getTableSettings: () => ({})
};

// Exercise the generated dropdown code, rather than just checking template syntax.
(async () => {
    const html = new Scaffer(registry)._generateCrudPage('Posts', false);
    const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
        .map(match => match[1]).find(source => source.includes('loadFKData'));
    assert.ok(script, 'CRUD page must contain its client script');
    new vm.Script(script);
    const helperStart = script.indexOf('    function _label(');
    assert.ok(helperStart >= 0, 'Generated script must define the FK label helper');
    const helperEnd = script.indexOf('    async function loadRecords', helperStart);
    const options = [];
    const select = { appendChild: option => options.push(option) };
    const context = {
        _fetch: async () => ({ json: async () => [{ id: 7, name: 'Ada', password_hash: 'secret' }] }),
        document: { getElementById: () => select, createElement: () => ({}) }
    };
    vm.createContext(context);
    vm.runInContext(script.slice(helperStart, helperEnd), context);
    await vm.runInContext('loadFKData()', context);
    assert.strictEqual(options.length, 1);
    assert.strictEqual(options[0].value, 7);
    assert.strictEqual(options[0].textContent, '7 - Ada');
    console.log('scaffolder: generated FK dropdown PASSED');
})().catch(err => { console.error(err); process.exitCode = 1; });
