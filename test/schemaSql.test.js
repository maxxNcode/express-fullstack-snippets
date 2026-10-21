const assert = require('assert');
const vm = require('vm');
const Module = require('module');
const { SchemaRegistry } = require('../src/schemaRegistry');
const { CodeGenerator } = require('../src/generator');
const { createTableStatements } = require('../src/sqlText');

const variants = [
  ['typeless+default', "CREATE TABLE A (id INTEGER PRIMARY KEY, s DEFAULT 'x', t)", t => t.fields[1].default === 'x' && t.fields[1].type === '' && t.fields.length === 3],
  ['typeless pk', 'CREATE TABLE A (id PRIMARY KEY, n NOT NULL)', t => t.fields[0].pk && t.fields[1].notNull],
  ['quoted table/cols', 'CREATE TABLE "A" ("id" INTEGER PRIMARY KEY, `b` TEXT, [c] REAL)', t => t.name === 'A' && t.fields.map(f => f.name).join() === 'id,b,c'],
  ['schema-qualified', 'CREATE TABLE IF NOT EXISTS main.A (id INTEGER)', t => t.name === 'A'],
  ['temp', 'CREATE TEMP TABLE A (id INTEGER); CREATE TEMPORARY TABLE B (id INTEGER)', (t, all) => all.length === 2],
  ['without rowid/strict', 'CREATE TABLE A (id INTEGER PRIMARY KEY, v TEXT) WITHOUT ROWID, STRICT;', t => t.fields.length === 2],
  ['multi-word types', 'CREATE TABLE A (a DOUBLE PRECISION, b UNSIGNED BIG INT, c VARCHAR (255) NOT NULL, d DECIMAL(10, 2), e CHARACTER VARYING(20))', t => t.fields.map(f => f.type).join() === 'REAL,INTEGER,TEXT,REAL,TEXT' && t.fields[2].notNull],
  ['defaults', "CREATE TABLE A (a INTEGER DEFAULT -1, b TEXT DEFAULT NULL, c TEXT DEFAULT CURRENT_TIMESTAMP, d TEXT DEFAULT (datetime('now')), e TEXT DEFAULT 'it''s', f INTEGER DEFAULT 'abc', g REAL DEFAULT - 2.5)", t => t.fields[0].default === '-1' && t.fields[1].default === undefined && t.fields[3].default === "(datetime('now'))" && t.fields[4].default === "it's" && t.fields[6].default === '-2.5'],
  ['inline FK with actions', 'CREATE TABLE P (id INTEGER PRIMARY KEY); CREATE TABLE A (id INTEGER PRIMARY KEY, p INTEGER REFERENCES "P"("id") ON DELETE CASCADE ON UPDATE SET NULL, n TEXT NOT NULL)', (t, all) => all[1].fields[1].fk?.table === 'P' && all[1].fields[2].notNull],
  ['table FK with actions', 'CREATE TABLE P (id INTEGER PRIMARY KEY); CREATE TABLE A (id INTEGER, p INTEGER, CONSTRAINT fk_p FOREIGN KEY (p) REFERENCES P(id) ON DELETE CASCADE, PRIMARY KEY (id DESC) ON CONFLICT REPLACE, UNIQUE ("p"))', (t, all) => (all[1].constraints || []).length === 3 && all[1].constraints[0].refTable === 'P'],
  ['collate/check split', 'CREATE TABLE A (n TEXT COLLATE NOCASE NOT NULL, q INTEGER CHECK (q > 0), r INTEGER CHECK(r < 9), CHECK ((q + r) > 0))', t => t.fields[0].notNull && t.fields[1].check === 'q > 0' && t.fields[2].check === 'r < 9' && t.constraints?.length === 1],
  ['column CONSTRAINT', 'CREATE TABLE A (id INTEGER CONSTRAINT pk PRIMARY KEY, e TEXT CONSTRAINT u UNIQUE)', t => t.fields[0].pk && t.fields[1].unique],
  ['generated', 'CREATE TABLE A (a INTEGER, b INTEGER GENERATED ALWAYS AS (a * 2) STORED)', t => t.fields.length === 2],
  ['mixed file', "PRAGMA foreign_keys=ON;\r\nCREATE TABLE A (id INTEGER); -- note; with ;\r\nINSERT INTO A VALUES (1);\r\nCREATE INDEX ix ON A(id);\r\n/* CREATE TABLE Fake (x); */\r\nCREATE TABLE B (id INTEGER, s TEXT DEFAULT 'a;b')", (t, all) => all.length === 2 && all[1].fields[1].default === 'a;b'],
  ['no final semicolon, crlf', 'CREATE TABLE A (\r\n  id INTEGER,\r\n  n TEXT\r\n)', t => t.fields.length === 2],
  ['mysql options', 'CREATE TABLE `A` (`id` INT NOT NULL AUTO_INCREMENT, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;', t => t.fields[0].autoIncrement && t.constraints?.length === 1],
  ['bracket comma name', 'CREATE TABLE [A] ([id] INTEGER, [b] TEXT)', t => t.fields.length === 2],
];

const schema = `-- Original multi-table example
CREATE TABLE Categories (
    catID INTEGER PRIMARY KEY AUTOINCREMENT,
    catName TEXT NOT NULL,
    catStat TEXT DEFAULT 'active'
);
CREATE TABLE Products (
    pordID INTEGER PRIMARY KEY AUTOINCREMENT,
    pordName TEXT NOT NULL,
    catID INTEGER,
    price REAL NOT NULL,
    stockQuantity INTEGER TEXT DEFAULT '0',
    prodStat
);
CREATE TABLE Customers (
    custID INTEGER PRIMARY KEY AUTOINCREMENT,
    custPass TEXT UNIQUE NOT NULL,
    custFName TEXT NOT NULL,
    custLName TEXT,
    email TEXT UNIQUE NOT NUll,
    contactNo INTEGER UNIQUE NOT NUll,
    custStat TEXT DEFAULT 'active'
);
CREATE TABLE Orders (
    orderID INTEGER PRIMARY KEY AUTOINCREMENT,
    custID INTEGER,
    orderDate DATE TEXT NOT NULL,
    pordID INTEGER,
    quantity INTEGER TEXT DEFAULT '0',
    sutotal REAL,
    totalAmount REAL,
    orderStat TEXT DEFAULT 'active'
);`;

async function main() {
    const registry = new SchemaRegistry();
    let saves = 0;
    registry.save = async () => { saves++; };
    const names = await registry.registerTablesFromSql(schema);
    assert.deepStrictEqual(names, ['Categories', 'Products', 'Customers', 'Orders']);
    assert.strictEqual(saves, 1, 'Batch registration saves once');
    assert.strictEqual(registry.getTable('Categories').fields.length, 3);
    assert.strictEqual(registry.getTable('Products').fields.length, 6);
    assert.ok(registry.getTable('Products').fields.some(f => f.name === 'prodStat'));
    assert.strictEqual(registry.getTable('Categories').fields.filter(f => f.pk).length, 1);
    assert.throws(() => registry.parseCreateTable(schema), /one CREATE TABLE/);
    const before = JSON.stringify(registry.schema);
    await assert.rejects(registry.registerTablesFromSql('CREATE TABLE NewTable(id INTEGER); CREATE TABLE Categories(id INTEGER);'), /already exists/);
    assert.strictEqual(JSON.stringify(registry.schema), before, 'A conflicting batch must not partially register');
    const statements = createTableStatements(schema);
    assert.strictEqual(statements.find(s => schema.indexOf('stockQuantity') <= s.end).sql.startsWith('CREATE TABLE Products'), true);

    const gen = new CodeGenerator(registry);
    const SQL = await require('sql.js')();
    const db = new SQL.Database();
    for (const name of names) {
        const sql = gen.generateCreateTableSql(name);
        assert.ok(sql.startsWith('CREATE TABLE IF NOT EXISTS '));
        assert.ok(sql.endsWith(';'));
        assert.ok(!sql.includes('db.exec') && !sql.includes('console.log'));
        db.run(sql);
        new vm.Script(gen.generateCreateTable(name));
    }
    assert.ok(db.exec('PRAGMA table_info(Products)')[0].values.some(row => row[1] === 'prodStat'));
    db.close();

    // Dialect variants: each must parse as expected and the regenerated SQL must execute.
    for (const [label, sql, check] of variants) {
        const reg = new SchemaRegistry();
        reg.save = async () => {};
        const all = (await reg.registerTablesFromSql(sql)).map(n => ({ name: n, ...reg.getTable(n) }));
        const vdb = new SQL.Database();
        for (const v of all) vdb.run(new CodeGenerator(reg).generateCreateTableSql(v.name));
        vdb.close();
        assert.ok(check(all[0], all), label + ': ' + JSON.stringify(all));
    }
    const ctCode = gen.generateCreateTable(names[0]);
    assert.ok(ctCode.startsWith('db.exec(`\n') && !ctCode.includes('\\n'), 'Create-table code keeps real line breaks');
    assert.throws(() => registry.parseCreateTable('CREATE TABLE "Order" (id INTEGER)'), /SQL keyword/);
    assert.throws(() => registry.parseCreateTable('CREATE TABLE T (id INTEGER, "group" TEXT)'), /SQL keyword/);
    assert.ok(registry.parseCreateTable('CREATE TABLE T (key TEXT, action TEXT, date TEXT)').fields.length === 3, 'Non-reserved keywords stay allowed');

    let preview;
    let clip;
    const vscode = { workspace: { openTextDocument: async options => { preview = options; return options; } }, window: { showTextDocument: async () => {}, showErrorMessage: m => { throw new Error(m); }, showInformationMessage: () => {} }, env: { clipboard: { writeText: t => { clip = t; } } } };
    const load = Module._load;
    let SchemaViewProvider;
    try {
        Module._load = function(name, ...args) { return name === 'vscode' ? vscode : load.call(this, name, ...args); };
        ({ SchemaViewProvider } = require('../src/schemaView'));
    } finally { Module._load = load; }
    const view = Object.create(SchemaViewProvider.prototype);
    view.schemaRegistry = registry;
    view.generator = gen;
    await view._handlePreviewSql('Categories');
    assert.strictEqual(preview.language, 'sql');
    assert.strictEqual(preview.content, gen.generateCreateTableSql('Categories'));
    view._handleExtractSchemaSql();
    assert.strictEqual((clip.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, 4, 'Copy schema SQL includes every table');
    console.log('schemaSql: multi-table registration, cursor ranges, typeless columns and executable raw preview PASSED');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
