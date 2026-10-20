const assert = require('assert');
const vm = require('vm');
const { SchemaRegistry } = require('../src/schemaRegistry');
const { CodeGenerator } = require('../src/generator');
const { RuleEngine } = require('../src/ruleEngine');
const { Scaffer } = require('../src/scaffolder');
const { MysqlToSqliteConverter } = require('../src/mysqlToSqlite');
const { splitSql } = require('../src/sqlText');
const { AppGenerator } = require('../src/appGenerator');

const registry = new SchemaRegistry();
registry.schema.tables = {
    Users: { fields: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'email', type: 'TEXT' }, { name: 'password', type: 'TEXT' }, { name: 'status', type: 'TEXT', default: 'enabled' }], settings: { statusActiveValue: 'enabled' } },
    Items: { fields: [{ name: 'code', type: 'TEXT', pk: true }, { name: 'price', type: 'REAL' }, { name: 'owner', type: 'INTEGER', fk: { table: 'Users', field: 'id' } }, { name: 'choices', type: 'TEXT', uiType: 'checkbox', options: [{ value: 'a', label: 'A' }] }], settings: { editStyle: 'modal' } }
};
const generator = new CodeGenerator(registry);
const rules = new RuleEngine(registry);
const auth = { tableName: 'Users', identityFields: ['email'], passwordField: 'password', statusField: 'status', generateRegister: true, generateRegisterHtml: true };
const columns = [{ table: 'Items', field: 'price' }];
const reports = [{ name: 'prices', columns, filters: [{ table: 'Items', field: 'code', operator: '=', value: "it's a test" }] }];
const files = new Scaffer(registry).generateAll('test', registry.getTables(), auth, [], reports);
new vm.Script(files['server.js']);
assert.ok(files['public/register.html']);
for (const [name, content] of Object.entries(files)) {
    if (!name.endsWith('.html')) continue;
    assert.ok(content.startsWith('<!DOCTYPE html>'), name + ' must start in standards mode');
    for (const match of content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], { filename: name });
}
for (const html of [generator.generateListHtml('Items'), rules.generateReportHtml('prices', [{ field: 'Items_price', label: "Price's label" }])]) {
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
}
new vm.Script(generator.queryGen.generateQueryServer('quoted', columns, reports[0].filters));
const app = new AppGenerator(registry).generateApp(registry.getTables().map(tableName => ({ tableName, createTable: true, list: true, listJs: true })), auth, { includeServerBoilerplate: true });
new vm.Script(app.server);
assert.ok(!app.server.includes('JWT_SECRET='), 'Environment values belong in their own output');
assert.ok(app.env.includes('JWT_SECRET'));
const snippets = [...app.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
new vm.Script(snippets + '\n' + app.js);
assert.strictEqual(registry.parseCreateTable('CREATE TABLE T (code TEXT PRIMARY KEY, label TEXT);').fields[0].type, 'TEXT');
assert.strictEqual(registry.parseInlineSpec('T:code TEXT PRIMARY, label TEXT').fields[0].type, 'TEXT');
const parsed = registry.parseInsertStatements("INSERT INTO T (code, label) VALUES ('x', 'a);b,c'), ('y', ''), ('z', 'O''Brien');");
assert.deepStrictEqual(parsed[0].values, [['x', 'a);b,c'], ['y', ''], ['z', "O'Brien"]]);
assert.strictEqual(splitSql("SELECT ';'; SELECT ')';").length, 2);
assert.ok(new MysqlToSqliteConverter().convertSchema("CREATE TABLE T (code varchar(20) PRIMARY KEY, label varchar(80) DEFAULT 'a;b,c)');").includes("a;b,c)"));

(async () => {
    const SQL = await require('sql.js')();
    const db = new SQL.Database();
    db.run('CREATE TABLE Users (id INTEGER, email TEXT, password TEXT, status TEXT); CREATE TABLE Items (code TEXT, price REAL, owner INTEGER);');
    db.run("INSERT INTO Users VALUES(1, 'u', 'p', 'enabled'); INSERT INTO Items VALUES ('a', 12, 1)");
    const formula = rules.generateFormulaSql('Items', [{ table: 'Items', field: 'price' }, { table: 'Users', field: 'id' }], '+');
    assert.strictEqual(db.exec('SELECT ' + formula + ' AS value FROM Items')[0].values[0][0], 13);
    assert.throws(() => rules.generateFormulaSql('Items', [{ table: 'Missing', field: 'x' }, { table: 'Items', field: 'price' }]), /No foreign-key path/);
    db.close();
    console.log('generatedOutput: server, HTML scripts, SQL parsing and formula execution PASSED');
})().catch(err => { console.error(err); process.exitCode = 1; });
