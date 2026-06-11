/**
 * QueryGenerator — all SQL SELECT / JS fetch / server route / HTML view generation
 * for the Query Builder feature. Extracted from generator.js to keep files focused.
 */
class QueryGenerator {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
    }

    /**
     * Build a SELECT SQL with auto-detected JOINs based on FK relationships.
     * @param {Array} columns - Array of { table, field } objects
     * @param {Array} [filters] - Optional array of { table, field, operator, value } filter objects
     */
    generateQuerySql(columns, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        if (!columns || columns.length === 0) return '-- No columns selected';
        const tableColumns = {};
        for (const col of columns) {
            if (!tableColumns[col.table]) tableColumns[col.table] = [];
            tableColumns[col.table].push(col);
        }
        const tableNames = Object.keys(tableColumns);
        const joinT = (joinType === 'INNER' ? 'INNER' : 'LEFT');
        const { mainTable, joins } = this._determineQueryJoins(tableNames, joinT);
        const selectParts = [];
        for (const col of columns) {
            var colExpr = col.table + '.' + col.field;
            if (col.aggregate) {
                colExpr = col.aggregate.toUpperCase() + '(' + colExpr + ')';
            }
            selectParts.push('  ' + colExpr + ' AS ' + col.table + '_' + col.field);
        }
        var selectKw = distinct ? 'SELECT DISTINCT' : 'SELECT';
        let sql = selectKw + '\n';
        sql += selectParts.join(',\n');
        sql += '\nFROM ' + mainTable + '\n';
        if (joins.length > 0) {
            sql += joins.join('\n');
        }
        // Add WHERE clause if filters provided
        if (filters && filters.length > 0) {
            var whereClauses = [];
            for (var fi = 0; fi < filters.length; fi++) {
                var f = filters[fi];
                var colRef = f.table + '.' + f.field;
                var op = f.operator || '=';
                if (op.toUpperCase() === 'IS NULL') {
                    whereClauses.push(colRef + ' IS NULL');
                } else if (op.toUpperCase() === 'IS NOT NULL') {
                    whereClauses.push(colRef + ' IS NOT NULL');
                } else if (op.toUpperCase() === 'LIKE') {
                    whereClauses.push(colRef + ' LIKE ' + this._quoteSqlValue(f.value));
                } else if (op.toUpperCase() === 'IN') {
                    var inVals = String(f.value).split(',').map(function(v) { return v.trim(); }).filter(Boolean);
                    var inQuoted = inVals.map(function(v) { return this._quoteSqlValue(v); }, this).join(', ');
                    whereClauses.push(colRef + ' IN (' + inQuoted + ')');
                } else if (op.toUpperCase() === 'BETWEEN') {
                    var btwnVals = String(f.value).split(/\s+AND\s+/i).map(function(v) { return v.trim(); }).filter(Boolean);
                    if (btwnVals.length >= 2) {
                        whereClauses.push(colRef + ' BETWEEN ' + this._quoteSqlValue(btwnVals[0]) + ' AND ' + this._quoteSqlValue(btwnVals[1]));
                    } else {
                        whereClauses.push(colRef + ' BETWEEN ' + this._quoteSqlValue(f.value) + ' AND ' + this._quoteSqlValue(''));
                    }
                } else {
                    whereClauses.push(colRef + ' ' + op + ' ' + this._quoteSqlValue(f.value));
                }
            }
            sql += '\nWHERE ' + whereClauses.join('\n  AND ');
        }
        // Add GROUP BY if provided
        if (groupBy && groupBy.length > 0) {
            var groupParts = [];
            for (var gi = 0; gi < groupBy.length; gi++) {
                var g = groupBy[gi];
                groupParts.push(g.table + '.' + g.field);
            }
            sql += '\nGROUP BY ' + groupParts.join(', ');
        }
        // Add HAVING if provided
        if (having && having.length > 0) {
            var havingClauses = [];
            for (var hi = 0; hi < having.length; hi++) {
                var h = having[hi];
                var hColRef = h.table + '.' + h.field;
                if (h.aggregate) {
                    hColRef = h.aggregate.toUpperCase() + '(' + hColRef + ')';
                }
                var hOp = h.operator || '=';
                if (hOp.toUpperCase() === 'IS NULL') {
                    havingClauses.push(hColRef + ' IS NULL');
                } else if (hOp.toUpperCase() === 'IS NOT NULL') {
                    havingClauses.push(hColRef + ' IS NOT NULL');
                } else if (hOp.toUpperCase() === 'LIKE') {
                    havingClauses.push(hColRef + ' LIKE ' + this._quoteSqlValue(h.value));
                } else if (hOp.toUpperCase() === 'IN') {
                    var hInVals = String(h.value).split(',').map(function(v) { return v.trim(); }).filter(Boolean);
                    var hInQuoted = hInVals.map(function(v) { return this._quoteSqlValue(v); }, this).join(', ');
                    havingClauses.push(hColRef + ' IN (' + hInQuoted + ')');
                } else if (hOp.toUpperCase() === 'BETWEEN') {
                    var hBtwnVals = String(h.value).split(/\s+AND\s+/i).map(function(v) { return v.trim(); }).filter(Boolean);
                    if (hBtwnVals.length >= 2) {
                        havingClauses.push(hColRef + ' BETWEEN ' + this._quoteSqlValue(hBtwnVals[0]) + ' AND ' + this._quoteSqlValue(hBtwnVals[1]));
                    } else {
                        havingClauses.push(hColRef + ' BETWEEN ' + this._quoteSqlValue(h.value) + ' AND ' + this._quoteSqlValue(''));
                    }
                } else {
                    havingClauses.push(hColRef + ' ' + hOp + ' ' + this._quoteSqlValue(h.value));
                }
            }
            sql += '\nHAVING ' + havingClauses.join('\n  AND ');
        }
        // Add ORDER BY if sortBy provided
        if (sortBy && sortBy.table && sortBy.field) {
            sql += '\nORDER BY ' + sortBy.table + '.' + sortBy.field + ' ' + (sortBy.direction === 'DESC' ? 'DESC' : 'ASC');
        }
        // Add LIMIT if provided
        if (limit && parseInt(limit) > 0) {
            sql += '\nLIMIT ' + parseInt(limit);
        }
        sql += ';';
        return sql;
    }

    /**
     * Quote a SQL value appropriately (strings get single quotes, numbers don't).
     */
    _quoteSqlValue(val) {
        if (val === null || val === undefined) return 'NULL';
        var str = String(val);
        if (/^-?\d+(\.\d+)?$/.test(str)) return str;
        return "'" + str.replace(/'/g, "''") + "'";
    }

    /**
     * Determine JOINs between selected tables using FK relationships.
     */
    _determineQueryJoins(tableNames, joinType) {
        joinType = joinType || 'LEFT';
        const tableObjs = tableNames.map(t => ({ name: t, table: this.schemaRegistry.getTable(t) })).filter(t => t.table);
        const outgoingFKs = {};
        for (const tObj of tableObjs) {
            const fks = [];
            for (const f of (tObj.table.fields || [])) {
                if (f.fk && tableNames.includes(f.fk.table)) {
                    fks.push({ fromField: f.name, targetTable: f.fk.table, targetField: f.fk.field });
                }
            }
            outgoingFKs[tObj.name] = fks;
        }
        const incomingFKs = {};
        for (const tName of tableNames) {
            incomingFKs[tName] = [];
            for (const [otherName, fks] of Object.entries(outgoingFKs)) {
                for (const fk of fks) {
                    if (fk.targetTable === tName) {
                        incomingFKs[tName].push({ fromTable: otherName, fromField: fk.fromField, targetField: fk.targetField });
                    }
                }
            }
        }
        let mainTable = tableNames[0];
        let maxOutgoing = 0;
        for (const [tName, fks] of Object.entries(outgoingFKs)) {
            if (fks.length > maxOutgoing) {
                maxOutgoing = fks.length;
                mainTable = tName;
            }
        }
        const joins = [];
        const joinedTables = new Set([mainTable]);
        const queue = [mainTable];
        while (queue.length > 0) {
            const currentTable = queue.shift();
            for (const fk of (outgoingFKs[currentTable] || [])) {
                if (!joinedTables.has(fk.targetTable)) {
                    joins.push(joinType + ' JOIN ' + fk.targetTable + ' ON ' + currentTable + '.' + fk.fromField + ' = ' + fk.targetTable + '.' + fk.targetField);
                    joinedTables.add(fk.targetTable);
                    queue.push(fk.targetTable);
                }
            }
            for (const fk of (incomingFKs[currentTable] || [])) {
                if (!joinedTables.has(fk.fromTable)) {
                    joins.push(joinType + ' JOIN ' + fk.fromTable + ' ON ' + currentTable + '.' + fk.targetField + ' = ' + fk.fromTable + '.' + fk.fromField);
                    joinedTables.add(fk.fromTable);
                    queue.push(fk.fromTable);
                }
            }
        }
        for (const tName of tableNames) {
            if (!joinedTables.has(tName)) {
                joins.push('CROSS JOIN ' + tName);
                joinedTables.add(tName);
            }
        }
        return { mainTable, joins };
    }

    /**
     * Generate JS fetch function for a query.
     */
    generateQueryFetchJs(queryName, columns) {
        const route = '/api/' + queryName;
        const funcName = 'fetch' + queryName.charAt(0).toUpperCase() + queryName.slice(1);
        let js = '// ' + queryName + ' - fetch function\n';
        js += 'const API_' + queryName.toUpperCase() + " = '" + route + "';\n\n";
        js += 'async function ' + funcName + '() {\n';
        js += '  const res = await fetch(API_' + queryName.toUpperCase() + ');\n';
        js += "  if (!res.ok) throw new Error('Failed to fetch: ' + res.statusText);\n";
        js += '  return await res.json();\n';
        js += '}\n';
        return js;
    }

    /**
     * Generate Express server route for a query.
     */
    generateQueryServer(queryName, columns, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        const route = '/api/' + queryName;
        const sql = this.generateQuerySql(columns, filters, sortBy, limit, groupBy, having, distinct, joinType);
        const stmtName = 'stmt' + queryName.charAt(0).toUpperCase() + queryName.slice(1);
        let server = '// --- ' + queryName + ' ---\n';
        var escapedSql = sql.replace(/'/g, "''").replace(/\n/g, '\\n');
        server += 'const ' + stmtName + " = db.prepare('" + escapedSql + "');\n\n";
        server += '// GET ' + queryName + '\n';
        server += "app.get('" + route + "', (req, res) => {\n";
        server += '  try {\n';
        server += '    const rows = ' + stmtName + '.all();\n';
        server += '    res.json(rows);\n';
        server += '  } catch (err) {\n';
        server += '    res.status(500).json({ error: err.message });\n';
        server += '  }\n';
        server += '});\n';
        return server;
    }

    /**
     * Generate HTML card-based view for a query.
     */
    generateQueryCardHtml(queryName, columns) {
        const route = '/api/' + queryName;
        const containerId = queryName + 'CardContainer';
        const displayName = queryName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        var q = queryName;
        var cid = containerId;
        var dn = displayName;
        var r = route;

        var html = '';
        html += '<div id="' + q + 'Cards" class="query-results">\n';
        html += '  <h2>' + dn + '</h2>\n';
        html += '  <div class="card-container" id="' + cid + '">\n';
        html += '    <p class="loading">Loading...</p>\n';
        html += '  </div>\n';
        html += '</div>\n\n';

        html += '<script>\n';
        html += '(async function() {\n';
        html += "  var res = await fetch('" + r + "');\n";
        html += '  var items = await res.json();\n';
        html += "  var container = document.getElementById('" + cid + "');\n";
        html += "  if (!items || !items.length) { container.innerHTML = '<p class=\"empty\">No results found.</p>'; return; }\n";
        html += "  container.innerHTML = items.map(function(item) {\n";
        html += "    var parts = Object.entries(item).map(function(kv) {\n";
        html += "      var key = kv[0].replace(/_/g, ' ');\n";
        html += "      var val = kv[1] || '';\n";
        html += "      return '<p><strong>' + key + '</strong>: ' + val + '</p>';\n";
        html += "    }).join('');\n";
        html += "    return '<div class=\"card\">' + parts + '</div>';\n";
        html += "  }).join('');\n";
        html += '})();\n';
        html += '</script>\n';
        return html;
    }

    /**
     * Generate HTML table-based view for a query.
     */
    generateQueryTableHtml(queryName, columns) {
        const route = '/api/' + queryName;
        const tbodyId = queryName + 'TableBody';
        const displayName = queryName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        const headers = columns.map(function(c) {
            var label = c.field.replace(/_/g, ' ');
            return label.charAt(0).toUpperCase() + label.slice(1);
        });
        var colCount = columns.length;
        var q = queryName;
        var tbid = tbodyId;
        var dn = displayName;
        var r = route;

        var html = '';
        html += '<div id="' + q + 'Table" class="query-results">\n';
        html += '  <h2>' + dn + '</h2>\n';
        html += '  <table>\n';
        html += '    <thead>\n';
        html += '      <tr>\n';
        for (let i = 0; i < headers.length; i++) {
            html += '        <th>' + headers[i] + '</th>\n';
        }
        html += '      </tr>\n';
        html += '    </thead>\n';
        html += '    <tbody id="' + tbid + '">\n';
        html += '      <tr><td colspan="' + colCount + '">Loading...</td></tr>\n';
        html += '    </tbody>\n';
        html += '  </table>\n';
        html += '</div>\n\n';

        html += '<script>\n';
        html += '(async function() {\n';
        html += "  var res = await fetch('" + r + "');\n";
        html += '  var items = await res.json();\n';
        html += "  var tbody = document.getElementById('" + tbid + "');\n";
        html += "  if (!items || !items.length) { tbody.innerHTML = '<tr><td colspan=\"" + colCount + "\">No results found.</td></tr>'; return; }\n";
        html += "  tbody.innerHTML = items.map(function(item) {\n";
        html += "    var vals = Object.values(item).map(function(v) { return '<td>' + (v || '') + '</td>'; }).join('');\n";
        html += "    return '<tr>' + vals + '</tr>';\n";
        html += "  }).join('');\n";
        html += '})();\n';
        html += '</script>\n';
        return html;
    }
}

module.exports = { QueryGenerator };
