// Run with NJS_TEST_MODULES pointing to a generated app's node_modules, with jsdom installed.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { once } = require('events');
const { SchemaRegistry } = require('../src/schemaRegistry');
const { Scaffer } = require('../src/scaffolder');

async function main() {
    assert.ok(process.env.NJS_TEST_MODULES, 'Set NJS_TEST_MODULES to an installed generated-app node_modules directory');
    const runtimeRequire = createRequire(path.join(process.env.NJS_TEST_MODULES, '__test__.js'));
    const { JSDOM } = runtimeRequire('jsdom');
    const bcrypt = runtimeRequire('bcrypt');
    const registry = new SchemaRegistry();
    registry.schema = { tables: {
        Users: { fields: [
            { name: 'id', type: 'INTEGER', pk: true }, { name: 'email', type: 'TEXT', unique: true },
            { name: 'password', type: 'TEXT', notNull: true }, { name: 'status', type: 'TEXT', default: 'enabled' },
            { name: 'capacity', type: 'INTEGER', default: '1' }, { name: 'used', type: 'INTEGER', default: '0' }
        ], settings: { statusActiveValue: 'enabled', statusInactiveValue: 'disabled' } },
        Items: { fields: [
            { name: 'code', type: 'TEXT', pk: true }, { name: 'title', type: 'TEXT' },
            { name: 'owner', type: 'INTEGER', fk: { table: 'Users', field: 'id' } },
            { name: 'enabled', type: 'INTEGER', uiType: 'checkbox' },
            { name: 'tags', type: 'TEXT', uiType: 'checkbox', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
            { name: 'kind', type: 'TEXT', uiType: 'radio', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] },
            { name: 'created_at', type: 'TEXT' }
        ], settings: { editStyle: 'modal' } }
    }, screens: [], rules: [] };
    registry.schema.actionRoutes = [
        { name: 'createItem', targetTable: 'Items', useJwt: true, identityField: 'id',
            preChecks: [{ checkTable: 'Users', checkField: 'status', operator: '=', checkValue: 'enabled' }],
            limitChecks: [1, 2].map(() => ({ countTable: 'Items', groupField: 'owner', limitTable: 'Users', limitField: 'capacity' })) },
        { name: 'noInsert', useJwt: true },
        { name: 'rollbackItem', targetTable: 'Items', useJwt: true,
            postActions: [{ setTable: 'Users', setField: 'missingColumn', setValue: "it's quoted", whereField: 'id', whereSourceField: 'owner' }] }
    ];
    const rules = [
        { type: 'preCheck', targetTable: 'Items', checkTable: 'Users', checkField: 'status', field: 'owner', operator: '=', checkValue: 'enabled', errorMessage: "Owner isn't active" },
        { type: 'limitCheck', targetTable: 'Items', groupField: 'owner', limitTable: 'Users', limitField: 'capacity', errorMessage: 'Capacity exceeded' },
        { type: 'postAction', targetTable: 'Items', setTable: 'Users', setField: 'used', setValue: 'used + 1', whereField: 'id', whereSourceField: 'owner' }
    ];
    const auth = { tableName: 'Users', identityFields: ['email'], passwordField: 'password', statusField: 'status', generateRegister: true, generateRegisterHtml: true };
    const reports = [{ name: 'titles', columns: [{ table: 'Items', field: 'title' }] }];
    const scaffolder = new Scaffer(registry);
    const files = scaffolder.generateAll('Integration test', registry.getTables(), auth, rules, reports);
    // Multiple checks must generate unique variable names, and missing target must not use an undeclared result.
    new vm.Script(scaffolder._generateActionRouteCode({ name: 'checkOnly', preChecks: [
        { checkTable: 'Users', checkField: 'status', operator: '=', checkValue: "it's enabled" }
    ], limitChecks: [1, 2].map(() => ({ countTable: 'Items', groupField: 'owner', limitTable: 'Users', limitField: 'capacity' })) }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'njs-integration-'));
    let server, db;
    try {
        fs.mkdirSync(path.join(dir, 'public'));
        for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
        const context = vm.createContext({
            require: runtimeRequire, __dirname: dir, console: { log() {}, error() {} }, Buffer,
            process: { env: { ...process.env, PORT: '0', DB_PATH: 'data/test.db', JWT_SECRET: 'test-access-secret', JWT_REFRESH_SECRET: 'test-refresh-secret' } }
        });
        vm.runInContext(files['server.js'].replace('app.listen(PORT,', 'const testServer = app.listen(PORT,'), context);
        server = vm.runInContext('testServer', context);
        db = vm.runInContext('db', context);
        await once(server, 'listening');
        const base = 'http://127.0.0.1:' + server.address().port;
        const request = (route, method = 'GET', body, token) => fetch(base + route, {
            method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        db.prepare('INSERT INTO Users(email,password,status,capacity,used) VALUES(?,?,?,?,?)').run('admin', bcrypt.hashSync('secret', 4), 'enabled', 1, 0);
        assert.strictEqual((await request('/api/users')).status, 401);
        assert.strictEqual((await request('/api/auth/register', 'POST', { email: 'missing' })).status, 400);
        let response = await request('/api/auth/login', 'POST', { email: 'admin', password: 'secret' });
        assert.strictEqual(response.status, 200);
        const { token } = await response.json();
        response = await request('/api/auth/register', 'POST', { email: 'new-user', password: 'new-password' });
        assert.strictEqual(response.status, 201, await response.text());
        assert.strictEqual((await request('/api/auth/login', 'POST', { email: 'new-user', password: 'new-password' })).status, 200);
        const users = await (await request('/api/users', 'GET', undefined, token)).json();
        assert.ok(!('password' in users[0]), 'Never expose password hashes');
        response = await fetch(base + '/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
        assert.strictEqual(response.status, 400);
        const item = { code: 'A-1', title: '<img src=x onerror="alert(1)">', owner: 1, enabled: 1, tags: 'a,b', kind: 'y' };
        response = await request('/api/items', 'POST', item, token);
        assert.strictEqual(response.status, 201, await response.text());
        assert.strictEqual(db.prepare('SELECT used FROM Users WHERE id=1').get().used, 1);
        assert.strictEqual((await request('/api/items', 'POST', { ...item, code: 'A-2' }, token)).status, 403);
        assert.strictEqual((await request('/api/items/A-1', 'PUT', { title: 'Updated' }, token)).status, 200);
        assert.strictEqual(db.prepare('SELECT tags FROM Items').get().tags, 'a,b');
        const reportData = await (await request('/api/titles', 'GET', undefined, token)).json();
        assert.strictEqual(reportData[0].Items_title, 'Updated');
        response = await request('/api/users/1', 'PUT', { password: '', capacity: 2 }, token);
        assert.strictEqual(response.status, 200);
        assert.ok(await bcrypt.compare('secret', db.prepare('SELECT password FROM Users WHERE id=1').get().password));
        db.prepare("UPDATE Users SET status='disabled' WHERE id=1").run();
        assert.strictEqual((await request('/api/items', 'POST', { ...item, code: 'A-3' }, token)).status, 403);
        db.prepare("UPDATE Users SET status='enabled' WHERE id=1").run();
        response = await request('/api/createItem', 'POST', { ...item, code: 'action-id' }, token);
        assert.strictEqual(response.status, 201, await response.text());
        assert.strictEqual(db.prepare("SELECT code FROM Items WHERE code='action-id'").get().code, 'action-id');
        assert.strictEqual((await request('/api/noInsert', 'POST', {}, token)).status, 201);
        assert.strictEqual((await request('/api/rollbackItem', 'POST', { ...item, code: 'rolled-back' }, token)).status, 500);
        assert.ok(!db.prepare("SELECT * FROM Items WHERE code='rolled-back'").get(), 'Failed action must roll back its insert');
        const runWithRules = vm.runInContext('_runWithRules', context);
        assert.throws(() => runWithRules({ _postActions: [() => { throw new Error('post failed'); }] }, () => db.prepare("INSERT INTO Items(code) VALUES('rule-rollback')").run()), /post failed/);
        assert.ok(!db.prepare("SELECT * FROM Items WHERE code='rule-rollback'").get());
        const { RuleEngine } = require('../src/ruleEngine');
        const engine = new RuleEngine(registry);
        for (const [operator, field, value, passes] of [['>', 'capacity', 1, true], ['<', 'capacity', 1, false], ['LIKE', 'email', 'adm%', true], ['IS NULL', 'email', null, false], ['IS NOT NULL', 'email', null, true]]) {
            vm.runInContext(engine._generateValidator('operatorCheck', [{ type: 'preCheck', targetTable: 'Items', checkTable: 'Users', checkField: field, field: 'owner', operator, checkValue: value }]), context);
            let accepted = false;
            vm.runInContext('operatorCheck', context)({ body: { owner: 1 } }, { status() { return this; }, json() {} }, () => { accepted = true; });
            assert.strictEqual(accepted, passes, operator);
        }
        db.prepare('UPDATE Items SET title=?').run(item.title);

        const reportDom = new JSDOM(files['public/titles.html'], { url: base + '/titles.html', runScripts: 'outside-only' });
        reportDom.window.authFetch = url => request(url, 'GET', undefined, token);
        reportDom.window.redirectIfNotAuthenticated = () => {};
        for (const match of files['public/titles.html'].matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) reportDom.window.eval(match[1]);
        await reportDom.window.loadReport();
        assert.ok(reportDom.window.document.querySelector('#reportContent td').textContent.includes('<img'));
        assert.ok(!reportDom.window.document.querySelector('#reportContent img'));
        reportDom.window.close();

        // Browser runtime: modal round trip, FK selection, escaped rows and concrete button IDs.
        const errors = [];
        let rejectUpdates = false;
        const dom = new JSDOM(files['public/items.html'], { url: base + '/items.html', runScripts: 'outside-only' });
        const w = dom.window;
        w.authFetch = (url, options = {}) => rejectUpdates && options.method === 'PUT'
            ? Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'Update rejected' }) })
            : fetch(base + url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + token } });
        w.redirectIfNotAuthenticated = () => {};
        w.alert = message => errors.push(message);
        w.confirm = () => true;
        for (const match of files['public/items.html'].matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) w.eval(match[1]);
        await w.loadFKData();
        await w.loadRecords();
        assert.ok(!w.document.querySelector('#recordsTable img'), 'Stored values must remain text');
        const button = w.document.querySelector('#recordsTable button');
        assert.ok(button.getAttribute('onclick').includes('A-1'));
        await w.editRecord('A-1');
        const form = w.document.getElementById('editModalForm');
        assert.strictEqual(form.querySelector('[name=owner]').value, '1');
        assert.strictEqual(form.querySelector('[name=enabled]').checked, true);
        assert.strictEqual(form.querySelectorAll('[data-field=tags]:checked').length, 2);
        assert.strictEqual(form.querySelector('[name=kind]:checked').value, 'y');
        form.querySelector('[name=enabled]').checked = false;
        form.querySelector('[data-field=tags][value=a]').checked = false;
        form.querySelector('[name=title]').value = 'From modal';
        await w.document.getElementById('modalSaveBtn').onclick();
        const updated = db.prepare('SELECT * FROM Items').get();
        assert.strictEqual(updated.enabled, 0);
        assert.strictEqual(updated.tags, 'b');
        assert.strictEqual(updated.title, 'From modal');
        assert.strictEqual(errors.length, 0, errors.join('\n'));
        await w.editRecord('A-1');
        rejectUpdates = true;
        await w.document.getElementById('modalSaveBtn').onclick();
        assert.strictEqual(w.document.getElementById('editModal').style.display, 'flex');
        assert.ok(errors[0].includes('Update rejected'));
        rejectUpdates = false;
        w.close();
        // Inline forms use the same collector, and rejected updates must preserve edit state.
        registry.schema.tables.Items.settings.editStyle = 'form';
        const inline = scaffolder._generateCrudPage('Items', false);
        const inlineDom = new JSDOM(inline, { url: base + '/items.html', runScripts: 'outside-only' });
        const iw = inlineDom.window;
        iw.fetch = w.authFetch;
        for (const match of inline.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) iw.eval(match[1]);
        await iw.loadFKData(); await iw.editRecord('A-1');
        iw.document.querySelector('#recordForm [name=title]').value = 'Inline';
        await iw.document.getElementById('saveBtn').onclick();
        assert.strictEqual(db.prepare('SELECT title FROM Items').get().title, 'Inline');
        assert.strictEqual(iw.document.querySelector('#recordForm [name=code]').disabled, false);
        inlineDom.window.close();
        console.log('generatedApp integration: HTTP auth/CRUD/rules/reports and modal/inline browser forms PASSED');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (db) db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
