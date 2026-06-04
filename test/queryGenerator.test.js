/**
 * Unit tests for QueryGenerator.generateQuerySql()
 *
 * Covers: ORDER BY, LIMIT, GROUP BY, HAVING, DISTINCT, aggregates,
 * filters, edge cases, and combined clauses.
 *
 * Run: node test/queryGenerator.test.js
 */
const assert = require('assert');
const { QueryGenerator } = require('../src/queryGenerator');

// -------------------------------------------------------------------
// Mock SchemaRegistry — provides just enough for FK-based JOIN detection
// -------------------------------------------------------------------
function createMockRegistry(tables) {
  return {
    getTable(name) {
      return tables[name] || null;
    }
  };
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function gen(registry, columns, filters, sortBy, limit, groupBy, having, distinct) {
  const qg = new QueryGenerator(registry);
  return qg.generateQuerySql(columns, filters, sortBy, limit, groupBy, having, distinct);
}

const studentsPK = { name: 'studentID', type: 'INTEGER', pk: true };
const coursesPK  = { name: 'courseID',  type: 'INTEGER', pk: true };

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

// --- 1. Basic SELECT (no extras) ---

{
  const reg = createMockRegistry({
    Students: { fields: [studentsPK, { name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Students', field: 'name' }];
  const sql = gen(reg, cols);
  assert(sql.includes('SELECT\n'),          'starts with SELECT');
  assert(sql.includes('Students.name'),      'includes field reference');
  assert(sql.includes('Students_name'),      'includes alias');
  assert(sql.includes('FROM Students'),      'includes FROM');
  console.log('PASS: basic SELECT');
}

// --- 2. Multiple columns from one table ---

{
  const reg = createMockRegistry({
    Items: { fields: [
      { name: 'id', type: 'INTEGER', pk: true },
      { name: 'title', type: 'TEXT' },
      { name: 'price', type: 'REAL' }
    ]}
  });
  const cols = [
    { table: 'Items', field: 'title' },
    { table: 'Items', field: 'price' }
  ];
  const sql = gen(reg, cols);
  assert(sql.includes('Items.title'),        'first field');
  assert(sql.includes('Items.price'),        'second field');
  assert(sql.includes('Items_title'),        'first alias');
  assert(sql.includes('Items_price'),        'second alias');
  assert(!sql.includes('SELECT DISTINCT'),   'no DISTINCT by default');
  console.log('PASS: multiple columns from one table');
}

// --- 3. Empty / null columns ---

{
  const reg = createMockRegistry({});
  assert.strictEqual(gen(reg, []),           '-- No columns selected', 'empty array');
  assert.strictEqual(gen(reg, null),         '-- No columns selected', 'null');
  assert.strictEqual(gen(reg, undefined),    '-- No columns selected', 'undefined');
  console.log('PASS: empty/null columns');
}

// --- 4. ORDER BY ASC ---

{
  const reg = createMockRegistry({
    Students: { fields: [studentsPK, { name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Students', field: 'name' }];
  const sortBy = { table: 'Students', field: 'name', direction: 'ASC' };
  const sql = gen(reg, cols, null, sortBy);
  assert(sql.includes('ORDER BY Students.name ASC'), 'ORDER BY ASC');
  console.log('PASS: ORDER BY ASC');
}

// --- 5. ORDER BY DESC ---

{
  const reg = createMockRegistry({
    Students: { fields: [studentsPK, { name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Students', field: 'name' }];
  const sortBy = { table: 'Students', field: 'name', direction: 'DESC' };
  const sql = gen(reg, cols, null, sortBy);
  assert(sql.includes('ORDER BY Students.name DESC'), 'ORDER BY DESC');
  console.log('PASS: ORDER BY DESC');
}

// --- 6. ORDER BY default direction (no direction set) ---

{
  const reg = createMockRegistry({
    Students: { fields: [studentsPK, { name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Students', field: 'name' }];
  const sortBy = { table: 'Students', field: 'name' }; // no direction
  const sql = gen(reg, cols, null, sortBy);
  assert(sql.includes('ORDER BY Students.name ASC'), 'ORDER BY defaults to ASC');
  console.log('PASS: ORDER BY defaults to ASC');
}

// --- 7. ORDER BY null/empty ---

{
  const reg = createMockRegistry({
    Students: { fields: [studentsPK, { name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Students', field: 'name' }];
  const sql1 = gen(reg, cols, null, null);
  const sql2 = gen(reg, cols, null, { table: '', field: '' });
  assert(!sql1.includes('ORDER BY'), 'no ORDER BY when sortBy is null');
  assert(!sql2.includes('ORDER BY'), 'no ORDER BY when sortBy is empty');
  console.log('PASS: ORDER BY absent when sortBy is null/empty');
}

// --- 8. LIMIT ---

{
  const reg = createMockRegistry({
    Students: { fields: [studentsPK, { name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Students', field: 'name' }];
  const sql = gen(reg, cols, null, null, '10');
  assert(sql.includes('LIMIT 10'), 'LIMIT 10');
  console.log('PASS: LIMIT');
}

// --- 9. LIMIT edge cases ---

{
  const reg = createMockRegistry({
    Students: { fields: [studentsPK, { name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Students', field: 'name' }];

  assert(!gen(reg, cols, null, null, '0').includes('LIMIT'),    'LIMIT 0 omitted');
  assert(!gen(reg, cols, null, null, '-1').includes('LIMIT'),   'LIMIT -1 omitted');
  assert(!gen(reg, cols, null, null, 'abc').includes('LIMIT'),  'LIMIT NaN omitted');
  assert(!gen(reg, cols, null, null, '').includes('LIMIT'),     'LIMIT empty omitted');
  assert(!gen(reg, cols, null, null, null).includes('LIMIT'),   'LIMIT null omitted');
  console.log('PASS: LIMIT edge cases (0, -1, NaN, empty, null)');
}

// --- 10. LIMIT with integer ---

{
  const reg = createMockRegistry({
    Students: { fields: [studentsPK, { name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Students', field: 'name' }];
  // parseInt('100') = 100 > 0, should include LIMIT
  const sql = gen(reg, cols, null, null, 100);
  assert(sql.includes('LIMIT 100'), 'LIMIT 100 (number type)');
  console.log('PASS: LIMIT with number type');
}

// --- 11. GROUP BY ---

{
  const reg = createMockRegistry({
    Enrollments: { fields: [
      { name: 'enrollmentID', type: 'INTEGER', pk: true },
      { name: 'studentID', type: 'INTEGER' },
      { name: 'termPeriod', type: 'TEXT' }
    ]}
  });
  const cols = [
    { table: 'Enrollments', field: 'studentID' },
    { table: 'Enrollments', field: 'termPeriod' }
  ];
  const groupBy = [
    { table: 'Enrollments', field: 'studentID' },
    { table: 'Enrollments', field: 'termPeriod' }
  ];
  const sql = gen(reg, cols, null, null, null, groupBy);
  assert(sql.includes('GROUP BY Enrollments.studentID, Enrollments.termPeriod'), 'GROUP BY two fields');
  console.log('PASS: GROUP BY');
}

// --- 12. GROUP BY empty ---

{
  const reg = createMockRegistry({
    Items: { fields: [{ name: 'id', type: 'INTEGER', pk: true }] }
  });
  const cols = [{ table: 'Items', field: 'id' }];
  assert(!gen(reg, cols, null, null, null, []).includes('GROUP BY'),   'empty groupBy');
  assert(!gen(reg, cols, null, null, null, null).includes('GROUP BY'), 'null groupBy');
  console.log('PASS: GROUP BY absent when empty/null');
}

// --- 13. HAVING ---

{
  const reg = createMockRegistry({
    Enrollments: { fields: [
      { name: 'enrollmentID', type: 'INTEGER', pk: true },
      { name: 'studentID', type: 'INTEGER' }
    ]}
  });
  const cols = [
    { table: 'Enrollments', field: 'studentID' }
  ];
  const having = [
    { table: 'Enrollments', field: 'studentID', operator: '>', value: '5' }
  ];
  const sql = gen(reg, cols, null, null, null, null, having);
  assert(sql.includes('HAVING Enrollments.studentID > 5'), 'HAVING > 5');
  console.log('PASS: HAVING');
}

// --- 14. HAVING with aggregate ---

{
  const reg = createMockRegistry({
    Enrollments: { fields: [
      { name: 'enrollmentID', type: 'INTEGER', pk: true },
      { name: 'studentID', type: 'INTEGER' }
    ]}
  });
  const cols = [{ table: 'Enrollments', field: 'enrollmentID', aggregate: 'COUNT' }];
  const having = [
    { table: 'Enrollments', field: 'enrollmentID', operator: '>', value: '3', aggregate: 'COUNT' }
  ];
  const sql = gen(reg, cols, null, null, null, null, having);
  assert(sql.includes('HAVING COUNT(Enrollments.enrollmentID) > 3'), 'HAVING with COUNT aggregate');
  console.log('PASS: HAVING with aggregate function');
}

// --- 15. HAVING IS NULL / IS NOT NULL ---

{
  const reg = createMockRegistry({
    Items: { fields: [{ name: 'id', type: 'INTEGER', pk: true }] }
  });
  const cols = [{ table: 'Items', field: 'id' }];
  const havingNull  = [{ table: 'Items', field: 'id', operator: 'IS NULL' }];
  const havingNN    = [{ table: 'Items', field: 'id', operator: 'IS NOT NULL' }];

  const sqlNull = gen(reg, cols, null, null, null, null, havingNull);
  const sqlNN   = gen(reg, cols, null, null, null, null, havingNN);

  assert(sqlNull.includes('HAVING Items.id IS NULL'),       'HAVING IS NULL');
  assert(sqlNN.includes('HAVING Items.id IS NOT NULL'),     'HAVING IS NOT NULL');
  console.log('PASS: HAVING IS NULL / IS NOT NULL');
}

// --- 16. HAVING LIKE ---

{
  const reg = createMockRegistry({
    Items: { fields: [{ name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Items', field: 'name' }];
  const having = [{ table: 'Items', field: 'name', operator: 'LIKE', value: '%foo%' }];
  const sql = gen(reg, cols, null, null, null, null, having);
  assert(sql.includes("LIKE '%foo%'"), 'HAVING LIKE escaped');
  console.log('PASS: HAVING LIKE');
}

// --- 17. HAVING empty/null ---

{
  const reg = createMockRegistry({
    Items: { fields: [{ name: 'id', type: 'INTEGER', pk: true }] }
  });
  const cols = [{ table: 'Items', field: 'id' }];
  assert(!gen(reg, cols, null, null, null, null, []).includes('HAVING'),   'empty having');
  assert(!gen(reg, cols, null, null, null, null, null).includes('HAVING'), 'null having');
  console.log('PASS: HAVING absent when empty/null');
}

// --- 18. DISTINCT ---

{
  const reg = createMockRegistry({
    Students: { fields: [studentsPK, { name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Students', field: 'name' }];

  const sqlDistinct = gen(reg, cols, null, null, null, null, null, true);
  const sqlNormal   = gen(reg, cols, null, null, null, null, null, false);

  assert(sqlDistinct.startsWith('SELECT DISTINCT'), 'DISTINCT = true');
  assert(sqlNormal.startsWith('SELECT\n'),          'DISTINCT = false');
  console.log('PASS: DISTINCT toggle');
}

// --- 19. Combined: DISTINCT + WHERE + GROUP BY + HAVING + ORDER BY + LIMIT ---

{
  const reg = createMockRegistry({
    Enrollments: { fields: [
      { name: 'enrollmentID', type: 'INTEGER', pk: true },
      { name: 'studentID', type: 'INTEGER' },
      { name: 'courseID', type: 'INTEGER' },
      { name: 'termPeriod', type: 'TEXT' },
      { name: 'grade', type: 'REAL' }
    ]}
  });
  const cols = [
    { table: 'Enrollments', field: 'studentID' },
    { table: 'Enrollments', field: 'courseID', aggregate: 'COUNT' }
  ];
  const filters = [{ table: 'Enrollments', field: 'termPeriod', operator: '=', value: '2024-Fall' }];
  const sortBy = { table: 'Enrollments', field: 'studentID', direction: 'DESC' };
  const groupBy = [{ table: 'Enrollments', field: 'studentID' }];
  const having = [{ table: 'Enrollments', field: 'courseID', operator: '>', value: '3', aggregate: 'COUNT' }];

  const sql = gen(reg, cols, filters, sortBy, '50', groupBy, having, true);

  assert(sql.startsWith('SELECT DISTINCT'),            'combined: DISTINCT');
  assert(sql.includes('FROM Enrollments'),              'combined: FROM');
  assert(sql.includes("WHERE Enrollments.termPeriod = '2024-Fall'"), 'combined: WHERE');
  assert(sql.includes('GROUP BY Enrollments.studentID'),'combined: GROUP BY');
  assert(sql.includes('HAVING COUNT(Enrollments.courseID) > 3'), 'combined: HAVING aggregate');
  assert(sql.includes('ORDER BY Enrollments.studentID DESC'), 'combined: ORDER BY DESC');
  assert(sql.includes('LIMIT 50'),                      'combined: LIMIT');

  // Clause order check
  const selectPos = sql.indexOf('SELECT');
  const fromPos   = sql.indexOf('FROM');
  const wherePos  = sql.indexOf('WHERE');
  const groupPos  = sql.indexOf('GROUP BY');
  const havingPos = sql.indexOf('HAVING');
  const orderPos  = sql.indexOf('ORDER BY');
  const limitPos  = sql.indexOf('LIMIT');

  assert(selectPos < fromPos,    'SELECT before FROM');
  assert(fromPos   < wherePos,   'FROM before WHERE');
  assert(wherePos  < groupPos,   'WHERE before GROUP BY');
  assert(groupPos  < havingPos,  'GROUP BY before HAVING');
  assert(havingPos < orderPos,   'HAVING before ORDER BY');
  assert(orderPos  < limitPos,   'ORDER BY before LIMIT');
  console.log('PASS: all clauses combined in correct order');
}

// --- 20. Aggregate functions in SELECT ---

{
  const reg = createMockRegistry({
    Enrollments: { fields: [
      { name: 'enrollmentID', type: 'INTEGER', pk: true },
      { name: 'studentID', type: 'INTEGER' }
    ]}
  });
  const cols = [
    { table: 'Enrollments', field: 'enrollmentID', aggregate: 'COUNT' },
    { table: 'Enrollments', field: 'studentID', aggregate: 'SUM' }
  ];
  const sql = gen(reg, cols);
  assert(sql.includes('COUNT(Enrollments.enrollmentID)'), 'COUNT aggregate in SELECT');
  assert(sql.includes('SUM(Enrollments.studentID)'),       'SUM aggregate in SELECT');
  assert(sql.includes('AS Enrollments_enrollmentID'),      'alias preserved with COUNT');
  assert(sql.includes('AS Enrollments_studentID'),         'alias preserved with SUM');
  console.log('PASS: aggregate functions in SELECT');
}

// --- 20b. AVG, MIN, MAX aggregates ---

{
  const reg = createMockRegistry({
    Items: { fields: [
      { name: 'price', type: 'REAL' },
      { name: 'quantity', type: 'INTEGER' },
      { name: 'score', type: 'REAL' }
    ]}
  });
  const cols = [
    { table: 'Items', field: 'price', aggregate: 'AVG' },
    { table: 'Items', field: 'quantity', aggregate: 'MIN' },
    { table: 'Items', field: 'score', aggregate: 'MAX' }
  ];
  const sql = gen(reg, cols);
  assert(sql.includes('AVG(Items.price)'),     'AVG aggregate');
  assert(sql.includes('MIN(Items.quantity)'),   'MIN aggregate');
  assert(sql.includes('MAX(Items.score)'),      'MAX aggregate');
  assert(sql.includes('AS Items_price'),        'AVG alias preserved');
  assert(sql.includes('AS Items_quantity'),     'MIN alias preserved');
  assert(sql.includes('AS Items_score'),        'MAX alias preserved');
  console.log('PASS: AVG, MIN, MAX aggregates');
}

// --- 21. No aggregate (bare column) ---

{
  const reg = createMockRegistry({
    Items: { fields: [{ name: 'title', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Items', field: 'title', aggregate: '' }];
  const sql = gen(reg, cols);
  assert(sql.includes('Items.title'),        'bare column no aggregate');
  assert(!sql.includes('('),                 'no function wrapper');
  console.log('PASS: bare column (empty aggregate)');
}

// --- 21b. Filter with undefined operator (defaults to =) ---

{
  const reg = createMockRegistry({
    Items: { fields: [{ name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Items', field: 'name' }];
  const filters = [{ table: 'Items', field: 'name', value: 'test' }]; // no operator set
  const sql = gen(reg, cols, filters);
  assert(sql.includes("Items.name = 'test'"), 'undefined operator defaults to =');
  console.log('PASS: undefined filter operator defaults to =');
}

// --- 22. Filters with all operator types ---

{
  const reg = createMockRegistry({
    Items: { fields: [
      { name: 'id', type: 'INTEGER', pk: true },
      { name: 'name', type: 'TEXT' },
      { name: 'price', type: 'REAL' }
    ]}
  });
  const cols = [{ table: 'Items', field: 'name' }];
  const allOps = [
    { op: '=',        val: 'foo',     expected: "= 'foo'" },
    { op: '!=',       val: 'bar',     expected: "!= 'bar'" },
    { op: '>',        val: '10',      expected: '> 10' },
    { op: '<',        val: '20',      expected: '< 20' },
    { op: '>=',       val: '5.5',     expected: '>= 5.5' },
    { op: '<=',       val: '100',     expected: '<= 100' },
    { op: 'LIKE',     val: '%test%',  expected: "LIKE '%test%'" },
    { op: 'IS NULL',  val: '',        expected: 'IS NULL' },
    { op: 'IS NOT NULL', val: '',     expected: 'IS NOT NULL' },
    // IN — note: _quoteSqlValue wraps the whole value in quotes
    { op: 'IN',        val: '1,2,3',  expected: "IN ('1,2,3')" },
  ];

  for (const { op, val, expected } of allOps) {
    const filters = [{ table: 'Items', field: 'name', operator: op, value: val }];
    const sql = gen(reg, cols, filters);
    assert(sql.includes(expected), `filter operator ${op} -> ${expected}`);
  }
  console.log('PASS: all filter operator types');
}

// --- 23. SQL value quoting ---

{
  const reg = createMockRegistry({
    Items: { fields: [{ name: 'name', type: 'TEXT' }] }
  });
  const cols = [{ table: 'Items', field: 'name' }];

  // String value gets single-quoted
  const sqlStr = gen(reg, cols, [{ table: 'Items', field: 'name', operator: '=', value: "O'Brien" }]);
  assert(sqlStr.includes("= 'O''Brien'"), "single quote escaped: O''Brien");

  // Numeric value stays unquoted
  const sqlNum = gen(reg, cols, [{ table: 'Items', field: 'name', operator: '>', value: '42' }]);
  assert(sqlNum.includes('> 42'), 'numeric value unquoted');

  // Float value stays unquoted
  const sqlFloat = gen(reg, cols, [{ table: 'Items', field: 'name', operator: '>=', value: '3.14' }]);
  assert(sqlFloat.includes('>= 3.14'), 'float value unquoted');

  console.log('PASS: SQL value quoting (names, numbers, floats)');
}

// --- 24. JOIN detection with FK relationships ---

{
  const reg = createMockRegistry({
    Enrollments: { fields: [
      { name: 'enrollmentID', type: 'INTEGER', pk: true },
      { name: 'studentID', type: 'INTEGER' },
      { name: 'courseID', type: 'INTEGER', fk: { table: 'Courses', field: 'courseID' } }
    ]},
    Courses: { fields: [
      { name: 'courseID', type: 'INTEGER', pk: true },
      { name: 'courseCode', type: 'TEXT' }
    ]}
  });
  const cols = [
    { table: 'Enrollments', field: 'enrollmentID' },
    { table: 'Courses', field: 'courseCode' }
  ];
  const sql = gen(reg, cols);
  assert(sql.includes('LEFT JOIN Courses'), 'auto-detected LEFT JOIN');
  assert(sql.includes('Enrollments.courseID = Courses.courseID'), 'JOIN ON condition');
  console.log('PASS: FK-based JOIN detection');
}

// --- 25. Multiple tables without FK (CROSS JOIN) ---

{
  const reg = createMockRegistry({
    A: { fields: [{ name: 'id', type: 'INTEGER', pk: true }] },
    B: { fields: [{ name: 'val', type: 'TEXT' }] }
  });
  const cols = [
    { table: 'A', field: 'id' },
    { table: 'B', field: 'val' }
  ];
  const sql = gen(reg, cols);
  assert(sql.includes('CROSS JOIN B'), 'CROSS JOIN when no FK');
  console.log('PASS: CROSS JOIN when no FK relationship');
}

// -------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------
console.log('\n' + '='.repeat(50));
console.log('All 27 test groups PASSED');
console.log('='.repeat(50));
