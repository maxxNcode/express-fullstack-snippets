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
    /**
     * Generate a complete report HTML page with professional styling,
     * percentage columns, rank badges, and winner highlighting.
     * @param {string} reportName - The query/report name
     * @param {Array} columns - Array of { table, field, aggregate }
     * @param {Array} displayConfig - Array of { field, label, format, highlight }
     * @param {object} options - { hasRank, hasPercentage, title }
     * @returns {string} Complete HTML report page
     */
    generateReportHtml(reportName, columns, displayConfig, options = {}) {
        const route = '/api/' + reportName;
        const title = options.title || reportName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

        // Build display config from columns if not provided
        const displays = displayConfig || columns.map(c => ({
            field: c.field,
            label: c.field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            format: 'text'
        }));

        const hasRank = displays.some(d => d.format === 'rank');
        const hasPercentage = displays.some(d => d.format === 'percentage' || d.format === 'progress');

        let html = '';
        html += '<!-- ========= ' + title + ' Report ========= -->\n';
        html += '// SAVE THIS AS: ' + reportName + '.html (place in your public/ folder)\n';
        html += '// ============================================= -->\n\n';
        html += '<!DOCTYPE html>\n';
        html += '<html lang="en">\n';
        html += '<head>\n';
        html += '  <meta charset="UTF-8">\n';
        html += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
        html += '  <title>' + title + '</title>\n';
        html += '  <script src="auth.js"></script>\n';
        html += '  <script>redirectIfNotAuthenticated();</script>\n';
        html += '  <style>\n';
        html += '    * { margin: 0; padding: 0; box-sizing: border-box; }\n';
        html += '    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f0f2f5; padding: 20px; }\n';
        html += '    .container { max-width: 960px; margin: 0 auto; }\n';
        html += '    h1 { color: #333; margin-bottom: 20px; font-size: 24px; }\n';
        html += '    .nav-bar { background: #0078d4; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 16px; }\n';
        html += '    .nav-bar a { color: #fff; text-decoration: none; font-size: 14px; padding: 4px 8px; border-radius: 4px; }\n';
        html += '    .nav-bar a:hover { background: rgba(255,255,255,0.15); }\n';
        html += '    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }\n';
        html += '    th { background: #0078d4; color: #fff; padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; }\n';
        html += '    td { padding: 10px 16px; border-bottom: 1px solid #eee; font-size: 13px; color: #333; }\n';
        html += '    tr:last-child td { border-bottom: none; }\n';
        html += '    tr:nth-child(even) { background: #f8f9fa; }\n';
        html += '    tr:hover { background: #e8f0fe; }\n';
        html += '    .total-row { background: #e8e8e8 !important; font-weight: 600; }\n';
        html += '    .total-row td { border-top: 2px solid #0078d4; }\n';
        if (hasRank) {
            html += '    .winner-row { background: #fff8e1 !important; }\n';
            html += '    .winner-row td:first-child::before { content: "\\1F3C6 "; }\n';
            html += '    .rank-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }\n';
            html += '    .rank-1 { background: #ffd700; color: #333; }\n';
            html += '    .rank-2 { background: #c0c0c0; color: #333; }\n';
            html += '    .rank-3 { background: #cd7f32; color: #fff; }\n';
            html += '    .rank-default { background: #e0e0e0; color: #666; }\n';
        }
        if (hasPercentage) {
            html += '    .percent-bar { display: inline-block; height: 8px; border-radius: 4px; background: #4caf50; margin-right: 6px; vertical-align: middle; }\n';
        }
        html += '    .loading { text-align: center; padding: 40px; color: #888; font-size: 14px; }\n';
        html += '    .error { color: #d32f2f; padding: 16px; background: #ffebee; border-radius: 8px; }\n';
        html += '    @media print { .nav-bar { display: none; } body { padding: 0; } }\n';
        html += '  </style>\n';
        html += '</head>\n';
        html += '<body>\n';
        html += '  <div class="nav-bar">\n';
        html += '    <a href="/dashboard.html">Dashboard</a>\n';
        html += '    <a href="/login.html" onclick="logout()" style="margin-left:auto;">Logout</a>\n';
        html += '  </div>\n';
        html += '  <div class="container">\n';
        html += '    <h1>' + title + '</h1>\n';
        html += '    <div id="reportContent">\n';
        html += '      <div class="loading">Loading report data...</div>\n';
        html += '    </div>\n';
        html += '  </div>\n';
        html += '  <script>\n';
        html += '    const API = "' + route + '";\n\n';
        html += '    async function loadReport() {\n';
        html += "      const container = document.getElementById('reportContent');\n";
        html += '      try {\n';
        html += '        const res = await authFetch(API);\n';
        html += "        if (!res.ok) throw new Error('Failed to load report');\n";
        html += '        const data = await res.json();\n\n';
        html += '        if (!data || data.length === 0) {\n';
        html += "          container.innerHTML = '<p style=\"text-align:center;color:#888;padding:40px;\">No data available.</p>';\n";
        html += '          return;\n';
        html += '        }\n\n';
        html += "        var html = '<table><thead><tr>';\n";

        // Generate table headers
        for (const d of displays) {
            html += "        html += '<th>" + (d.label || d.field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())) + "</th>';\n";
        }

        html += "        html += '</tr></thead><tbody>';\n\n";
        html += '        data.forEach(function(row, idx) {\n';
        html += '          var cls = "";\n';
        if (hasRank) {
            html += '          if (row.rank === 1) cls = "winner-row";\n';
        }
        html += '          html += "<tr class=\"" + cls + "\">";\n';

        // Generate data cells with formatting
        for (const d of displays) {
            const f = d.field;
            if (d.format === 'percentage') {
                html += '          html += "<td>" + (row.' + f + ' != null ? Number(row.' + f + ').toFixed(2) + \'%\' : \'0%\') + "</td>";\n';
            } else if (d.format === 'progress') {
                html += '          var pct_' + f + ' = Number(row.' + f + ') || 0;\n';
                html += '          html += \'<td><div style="display:flex;align-items:center;"><span class="percent-bar" style="width:\' + Math.min(pct_' + f + ', 100) + \'px"></span>\' + pct_' + f + '.toFixed(1) + \'%\' + \'</div></td>\';\n';
            } else if (d.format === 'rank') {
                html += '          var rc = "rank-default";\n';
                html += '          if (row.' + f + ' === 1) rc = "rank-1";\n';
                html += '          else if (row.' + f + ' === 2) rc = "rank-2";\n';
                html += '          else if (row.' + f + ' === 3) rc = "rank-3";\n';
                html += '          html += \'<td><span class="rank-badge \' + rc + \'">#\' + row.' + f + ' + \'</span></td>\';\n';
            } else if (d.format === 'currency') {
                html += '          html += "<td>" + (row.' + f + ' != null ? \'₱\' + Number(row.' + f + ').toFixed(2) : \'₱0.00\') + "</td>";\n';
            } else if (d.format === 'boolean') {
                html += '          html += "<td>" + (row.' + f + ' ? \'✓ Yes\' : \'✗ No\') + "</td>";\n';
            } else {
                html += '          html += "<td>" + (row.' + f + ' != null ? row.' + f + ' : \'\') + "</td>";\n';
            }
        }

        html += '          html += "</tr>";\n';
        html += '        });\n\n';
        html += "        html += '</tbody></table>';\n";
        html += '        container.innerHTML = html;\n';
        html += '      } catch (err) {\n';
        html += '        container.innerHTML = \'<div class="error">\' + err.message + \'</div>\';\n';
        html += '      }\n';
        html += '    }\n\n';
        html += '    loadReport();\n';
        html += '  </script>\n';
        html += '</body>\n';
        html += '</html>\n';

        return html;
    }

    /**
     * Generate an Express server route for a report.
     * Includes the SQL query with window functions for computed columns.
     * @param {string} reportName
     * @param {Array} columns - Array of { table, field, aggregate }
     * @param {Array} computedColumns - Array of computed column definitions
     * @param {Array} [filters]
     * @param {object} [sortBy]
     * @param {string} [limit]
     * @param {Array} [groupBy]
     * @param {Array} [having]
     * @param {boolean} [distinct]
     * @param {string} [joinType]
     * @returns {string} Server route code
     */
    generateReportServer(reportName, columns, computedColumns, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        const route = '/api/' + reportName;
        const sql = this.generateReportSql(columns, computedColumns, filters, sortBy, limit, groupBy, having, distinct, joinType);
        const stmtName = 'stmt' + reportName.charAt(0).toUpperCase() + reportName.slice(1);

        let server = '';
        server += '// --- Report: ' + reportName + ' ---\n';
        const escapedSql = sql.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        server += 'const ' + stmtName + ' = db.prepare(`' + escapedSql + '`);\n\n';
        server += '// GET ' + reportName + ' (requires authentication)\n';
        server += "app.get('" + route + "', authenticate, (req, res) => {\n";
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
     * Generate a report SQL query with computed columns (percentages, ranks, etc.)
     * @param {Array} columns - Base columns
     * @param {Array} computedColumns - Array of { name, expression, sourceTable, sourceField, aggregate, partitionTable, partitionField, orderTable, orderField, orderDir, rankFunction }
     * @param {Array} [filters]
     * @param {object} [sortBy]
     * @param {string} [limit]
     * @param {Array} [groupBy]
     * @param {Array} [having]
     * @param {boolean} [distinct]
     * @param {string} [joinType]
     * @returns {string} SQL query string
     */
    generateReportSql(columns, computedColumns, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        if (!columns || columns.length === 0) return '-- No columns selected';

        // Group columns by table for FROM/JOIN construction
        const tableColumns = {};
        for (const col of columns) {
            if (!tableColumns[col.table]) tableColumns[col.table] = [];
            tableColumns[col.table].push(col);
        }
        const tableNames = Object.keys(tableColumns);
        const joinT = (joinType === 'INNER' ? 'INNER' : 'LEFT');
        const { mainTable, joins } = this._determineQueryJoins(tableNames, joinT);

        // Build SELECT parts
        const selectParts = [];
        for (const col of columns) {
            var colExpr = col.table + '.' + col.field;
            if (col.aggregate) {
                colExpr = col.aggregate.toUpperCase() + '(' + colExpr + ')';
            }
            selectParts.push('  ' + colExpr + ' AS ' + col.table + '_' + col.field);
        }

        // Build computed columns (percentage, rank, running total)
        if (computedColumns && computedColumns.length > 0) {
            for (const cc of computedColumns) {
                let expr = this._expandComputedExpression(cc);
                if (expr) {
                    selectParts.push('  ' + expr + ' AS ' + cc.name);
                }
            }
        }

        var selectKw = distinct ? 'SELECT DISTINCT' : 'SELECT';
        let sql = selectKw + '\n';
        sql += selectParts.join(',\n');
        sql += '\nFROM ' + mainTable + '\n';
        if (joins.length > 0) {
            sql += joins.join('\n');
        }

        // Add WHERE
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

        // Add GROUP BY
        if (groupBy && groupBy.length > 0) {
            var groupParts = [];
            for (var gi = 0; gi < groupBy.length; gi++) {
                var g = groupBy[gi];
                groupParts.push(g.table + '.' + g.field);
            }
            sql += '\nGROUP BY ' + groupParts.join(', ');
        }

        // Add HAVING
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

        // Add ORDER BY
        if (sortBy && sortBy.table && sortBy.field) {
            sql += '\nORDER BY ' + sortBy.table + '.' + sortBy.field + ' ' + (sortBy.direction === 'DESC' ? 'DESC' : 'ASC');
        }

        // Add LIMIT
        if (limit && parseInt(limit) > 0) {
            sql += '\nLIMIT ' + parseInt(limit);
        }

        sql += ';';
        return sql;
    }

    /**
     * Expand a computed column expression into SQL.
     * Supports percentage, runningTotal, rank, and custom formulas.
     */
    _expandComputedExpression(cc) {
        if (cc.expression === 'percentage') {
            // COUNT / SUM OVER () for percentage of total
            const countExpr = cc.aggregate
                ? `${cc.aggregate.toUpperCase()}(${cc.sourceTable}.${cc.sourceField})`
                : `COUNT(${cc.sourceTable}.${cc.sourceField})`;
            const totalExpr = cc.partitionField
                ? `SUM(${countExpr}) OVER (PARTITION BY ${cc.partitionTable}.${cc.partitionField})`
                : `SUM(${countExpr}) OVER ()`;
            return `ROUND(CAST(${countExpr} AS REAL) / NULLIF(${totalExpr}, 0) * 100, 2)`;
        }
        if (cc.expression === 'runningTotal') {
            const orderBy = cc.orderField
                ? `ORDER BY ${cc.orderTable}.${cc.orderField}`
                : '';
            const partitionBy = cc.partitionField
                ? `PARTITION BY ${cc.partitionTable}.${cc.partitionField} `
                : '';
            return `SUM(${cc.sourceTable}.${cc.sourceField}) OVER (${partitionBy}${orderBy})`;
        }
        if (cc.expression === 'rank') {
            const orderExpr = `${cc.orderTable}.${cc.orderField} ${cc.orderDir || 'DESC'}`;
            const partitionExpr = cc.partitionField
                ? `PARTITION BY ${cc.partitionTable}.${cc.partitionField} `
                : '';
            const func = cc.rankFunction || 'DENSE_RANK';
            return `${func}() OVER (${partitionExpr}ORDER BY ${orderExpr})`;
        }
        // Custom formula — return as-is
        return cc.expression || null;
    }

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
