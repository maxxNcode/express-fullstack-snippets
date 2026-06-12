
        const vscode = acquireVsCodeApi();

        function addTable() {
            vscode.postMessage({ command: 'addTable' });
        }

        function removeTable(name, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'removeTable', tableName: name });
        }

        function addFK(tableName, fieldName, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'addFK', tableName, fieldName });
        }

        function removeFK(tableName, fieldName, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'removeFK', tableName, fieldName });
        }

        function generateAll() {
            vscode.postMessage({ command: 'generateAll' });
        }

        function generateTable(name, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'generateTable', tableName: name });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function regenAll() {
            vscode.postMessage({ command: 'regenAll' });
        }

        // FK reference highlight on hover — also highlights the source field row
        document.addEventListener('mouseover', function(e) {
            const fk = e.target.closest('.fk-connector[data-ref-table]');
            if (fk) {
                const refTable = fk.getAttribute('data-ref-table');
                const refField = fk.getAttribute('data-ref-field');
                const srcTable = fk.closest('.table-card');
                if (srcTable) {
                    var srcField = fk.getAttribute('data-src-field');
                    if (srcField) {
                        var srcRow = srcTable.querySelector('.field-row[data-field-name="' + srcField + '"]');
                        if (srcRow) srcRow.classList.add('highlight');
                    }
                }
                const card = document.querySelector('.table-card[data-table-name="' + refTable + '"]');
                if (card) card.classList.add('highlight');
                if (refField && card) {
                    const row = card.querySelector('.field-row[data-field-name="' + refField + '"]');
                    if (row) row.classList.add('highlight');
                }
            }
        });

        document.addEventListener('mouseout', function(e) {
            const fk = e.target.closest('.fk-connector[data-ref-table]');
            if (!fk) return;
            // Don't remove highlight if still inside the same FK connector (prevents flicker on child elements)
            if (e.relatedTarget && fk.contains(e.relatedTarget)) return;
            const refTable = fk.getAttribute('data-ref-table');
            const refField = fk.getAttribute('data-ref-field');
            const srcTable = fk.closest('.table-card');
            if (srcTable) {
                var srcField = fk.getAttribute('data-src-field');
                if (srcField) {
                    var srcRow = srcTable.querySelector('.field-row[data-field-name="' + srcField + '"]');
                    if (srcRow) srcRow.classList.remove('highlight');
                }
            }
            const card = document.querySelector('.table-card[data-table-name="' + refTable + '"]');
            if (card) card.classList.remove('highlight');
            if (refField && card) {
                const row = card.querySelector('.field-row[data-field-name="' + refField + '"]');
                if (row) row.classList.remove('highlight');
            }
        });

        // --- Query Builder ---
        const qbState = { columns: [], filters: [], sortBy: null, sortLimit: '', groupBy: [], having: [], distinct: false, joinType: 'LEFT' };

        function onFieldDragStart(event, tableName, fieldName) {
            event.dataTransfer.setData('text/plain', JSON.stringify({ table: tableName, field: fieldName }));
            event.dataTransfer.effectAllowed = 'copy';
        }

        function renderFilters() {
            var container = document.getElementById('filterRows');
            if (!container) return;
            schedulePreview();

            if (qbState.filters.length === 0) {
                container.innerHTML = '<span class="qb-no-filters">No filters — all rows included</span>';
                return;
            }

            var ops = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'BETWEEN', 'IN', 'IS NULL', 'IS NOT NULL'];

            container.innerHTML = qbState.filters.map(function(f, idx) {
                // Build column dropdown with the correct 'selected' for this filter
                var colOptions = qbState.columns.map(function(c, ci) {
                    var sel = (c.table === f.table && c.field === f.field) ? ' selected' : '';
                    return '<option value="' + ci + '"' + sel + '>' + c.table + '.' + c.field + '</option>';
                }).join('');

                var opOptions = ops.map(function(op) {
                    var sel = (op === (f.operator || '=')) ? ' selected' : '';
                    return '<option value="' + op + '"' + sel + '>' + op + '</option>';
                }).join('');

                var valHtml = '';
                if (f.operator !== 'IS NULL' && f.operator !== 'IS NOT NULL') {
                    valHtml = '<input class="qb-filter-val" type="text" value="' + (f.value || '') + '" placeholder="value" onchange="updateFilterVal(' + idx + ', this.value)" />';
                }

                return '<div class="qb-filter-row">' +
                    '<select onchange="updateFilterCol(' + idx + ', this.value)">' + colOptions + '</select>' +
                    '<select class="qb-filter-op" onchange="updateFilterOp(' + idx + ', this.value)">' + opOptions + '</select>' +
                    valHtml +
                    '<button class="btn btn-danger btn-sm" onclick="removeFilter(' + idx + ')" title="Remove filter">&times;</button>' +
                    '</div>';
            }).join('');
        }

        // --- Sort / Limit / Join Type ---
        function renderSort() {
            var container = document.getElementById('sortControls');
            if (!container) return;
            schedulePreview();

            if (qbState.columns.length === 0) {
                container.innerHTML = '';
                return;
            }

            var colOptions = qbState.columns.map(function(c, ci) {
                var sel = qbState.sortBy && c.table === qbState.sortBy.table && c.field === qbState.sortBy.field ? ' selected' : '';
                return '<option value="' + ci + '"' + sel + '>' + c.table + '.' + c.field + '</option>';
            }).join('');

            var sortIdx = qbState.sortBy ? qbState.columns.findIndex(function(c) {
                return c.table === qbState.sortBy.table && c.field === qbState.sortBy.field;
            }) : -1;
            if (sortIdx < 0) sortIdx = qbState.columns.length > 0 ? 0 : -1;

            var ascActive = !qbState.sortBy || qbState.sortBy.direction !== 'DESC' ? ' sort-dir-active' : '';
            var descActive = qbState.sortBy && qbState.sortBy.direction === 'DESC' ? ' sort-dir-active' : '';

            var joinLeftSel = qbState.joinType !== 'INNER' ? ' selected' : '';
            var joinInnerSel = qbState.joinType === 'INNER' ? ' selected' : '';

            container.innerHTML = '<span class="qb-filter-label">Sort &amp; Limit:</span>' +
                '<div class="qb-sort-row">' +
                '<select class="qb-sort-col" onchange="onSortColChange(this.value)">' +
                '<option value="">None</option>' + colOptions +
                '</select>' +
                '<button class="btn btn-sm sort-dir-btn' + ascActive + '" onclick="setSortDir(' + "'ASC'" + ')" title="Ascending">ASC</button>' +
                '<button class="btn btn-sm sort-dir-btn' + descActive + '" onclick="setSortDir(' + "'DESC'" + ')" title="Descending">DESC</button>' +
                '<label class="qb-limit-label">Limit:</label>' +
                '<input class="qb-limit-input" type="number" min="0" step="1" placeholder="No limit" value="' + qbState.sortLimit + '" onchange="onSortLimitChange(this.value)" />' +
                '<label class="qb-limit-label" style="margin-left:12px;">Join:</label>' +
                '<select class="qb-sort-col" onchange="onJoinTypeChange(this.value)" style="min-width:100px;">' +
                '<option value="LEFT"' + joinLeftSel + '>LEFT JOIN</option>' +
                '<option value="INNER"' + joinInnerSel + '>INNER JOIN</option>' +
                '</select>' +
                '</div>';
        }

        function onJoinTypeChange(val) {
            qbState.joinType = val;
            schedulePreview();
        }

        function onSortColChange(val) {
            if (!val) {
                qbState.sortBy = null;
            } else {
                var idx = parseInt(val);
                var col = qbState.columns[idx];
                qbState.sortBy = { table: col.table, field: col.field, direction: qbState.sortBy ? qbState.sortBy.direction : 'ASC' };
            }
            renderSort();
        }

        function setSortDir(dir) {
            if (!qbState.sortBy && qbState.columns.length > 0) {
                qbState.sortBy = { table: qbState.columns[0].table, field: qbState.columns[0].field, direction: dir };
            } else if (qbState.sortBy) {
                qbState.sortBy.direction = dir;
            }
            renderSort();
        }

        function setColAggregate(idx, agg) {
            qbState.columns[idx].aggregate = agg || '';
            renderSelectedColumns();
        }

        // Debounced auto-refresh for SQL preview
        var previewTimer = null;
        function schedulePreview() {
            if (qbState.columns.length === 0) return;
            clearTimeout(previewTimer);
            previewTimer = setTimeout(function() {
                previewSqlQuery();
            }, 400);
        }

        function toggleDistinct(checked) {
            qbState.distinct = checked;
            schedulePreview();
        }

        function previewSqlQuery() {
            const name = document.getElementById('queryName').value.trim() || 'preview';
            vscode.postMessage({
                command: 'previewQuerySql',
                queryName: name,
                columns: qbState.columns,
                filters: qbState.filters,
                sortBy: qbState.sortBy,
                limit: qbState.sortLimit,
                groupBy: qbState.groupBy,
                having: qbState.having,
                distinct: qbState.distinct,
                joinType: qbState.joinType
            });
        }

        function onSortLimitChange(val) {
            qbState.sortLimit = val;
        }
        // --- end Sort / Limit ---

        // --- Group By ---
        function renderGroupBy() {
            var container = document.getElementById('groupByCheckboxes');
            if (!container) return;
            schedulePreview();

            if (qbState.columns.length === 0) {
                container.innerHTML = '<span class="qb-no-groupby">Add columns first</span>';
                return;
            }

            container.innerHTML = qbState.columns.map(function(col, idx) {
                var checked = qbState.groupBy.some(function(g) {
                    return g.table === col.table && g.field === col.field;
                });
                var cls = checked ? 'qb-groupby-cb checked' : 'qb-groupby-cb';
                return '<label class="' + cls + '">' +
                    '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="toggleGroupBy(' + idx + ', this.checked)" />' +
                    '<span class="qb-cb-table">' + col.table + '</span>.<span class="qb-cb-field">' + col.field + '</span>' +
                    '</label>';
            }).join('');
        }

        function toggleGroupBy(idx, checked) {
            var col = qbState.columns[idx];
            if (checked) {
                if (!qbState.groupBy.some(function(g) { return g.table === col.table && g.field === col.field; })) {
                    qbState.groupBy.push({ table: col.table, field: col.field });
                }
            } else {
                qbState.groupBy = qbState.groupBy.filter(function(g) {
                    return !(g.table === col.table && g.field === col.field);
                });
            }
            renderGroupBy();
            renderHaving();
        }
        // --- end Group By ---

        // --- Having ---
        function renderHaving() {
            var container = document.getElementById('havingRows');
            var addBtn = document.getElementById('addHavingBtn');
            if (!container || !addBtn) return;
            schedulePreview();

            if (qbState.columns.length === 0) {
                container.innerHTML = '';
                addBtn.disabled = true;
                return;
            }

            addBtn.disabled = false;

            if (qbState.having.length === 0) {
                container.innerHTML = '<span class="qb-no-filters">No having conditions — aggregate results unfiltered</span>';
                return;
            }

            var ops = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'BETWEEN', 'IN', 'IS NULL', 'IS NOT NULL'];
            var aggrFunctions = ['', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];

            container.innerHTML = qbState.having.map(function(h, idx) {
                // Column dropdown specific to this having condition
                var colOptions = qbState.columns.map(function(c, ci) {
                    var sel = (c.table === h.table && c.field === h.field) ? ' selected' : '';
                    return '<option value="' + ci + '"' + sel + '>' + c.table + '.' + c.field + '</option>';
                }).join('');

                var aggrOptions = aggrFunctions.map(function(a) {
                    var sel = (a === (h.aggregate || '')) ? ' selected' : '';
                    var label = a || 'None';
                    return '<option value="' + a + '"' + sel + '>' + label + '</option>';
                }).join('');

                var opOptions = ops.map(function(op) {
                    var sel = (op === (h.operator || '=')) ? ' selected' : '';
                    return '<option value="' + op + '"' + sel + '>' + op + '</option>';
                }).join('');

                var valHtml = '';
                if (h.operator !== 'IS NULL' && h.operator !== 'IS NOT NULL') {
                    valHtml = '<input class="qb-filter-val" type="text" value="' + (h.value || '') + '" placeholder="value" onchange="updateHavingVal(' + idx + ', this.value)" />';
                }

                return '<div class="qb-filter-row">' +
                    '<select onchange="updateHavingCol(' + idx + ', this.value)">' + colOptions + '</select>' +
                    '<select class="qb-col-aggr" onchange="setHavingAggregate(' + idx + ', this.value)">' + aggrOptions + '</select>' +
                    '<select class="qb-filter-op" onchange="updateHavingOp(' + idx + ', this.value)">' + opOptions + '</select>' +
                    valHtml +
                    '<button class="btn btn-danger btn-sm" onclick="removeHaving(' + idx + ')" title="Remove having">&times;</button>' +
                    '</div>';
            }).join('');
        }

        function setHavingAggregate(idx, agg) {
            qbState.having[idx].aggregate = agg || '';
            renderHaving();
        }

        function addHaving() {
            if (qbState.columns.length === 0) return;
            qbState.having.push({ table: qbState.columns[0].table, field: qbState.columns[0].field, operator: '=', value: '' });
            renderHaving();
        }

        function removeHaving(idx) {
            qbState.having.splice(idx, 1);
            renderHaving();
        }

        function updateHavingCol(idx, colIdx) {
            var col = qbState.columns[parseInt(colIdx)];
            qbState.having[idx].table = col.table;
            qbState.having[idx].field = col.field;
            renderHaving();
        }

        function updateHavingOp(idx, op) {
            qbState.having[idx].operator = op;
            renderHaving();
        }

        function updateHavingVal(idx, val) {
            qbState.having[idx].value = val;
        }
        // --- end Having ---

        function addFilter() {
            if (qbState.columns.length === 0) return;
            qbState.filters.push({ table: qbState.columns[0].table, field: qbState.columns[0].field, operator: '=', value: '' });
            renderFilters();
        }

        function removeFilter(idx) {
            qbState.filters.splice(idx, 1);
            renderFilters();
        }

        function updateFilterCol(idx, colIdx) {
            var col = qbState.columns[parseInt(colIdx)];
            qbState.filters[idx].table = col.table;
            qbState.filters[idx].field = col.field;
            renderFilters();
        }

        function updateFilterOp(idx, op) {
            qbState.filters[idx].operator = op;
            renderFilters();
        }

        function updateFilterVal(idx, val) {
            qbState.filters[idx].value = val;
        }

        function renderSelectedColumns() {
            const container = document.getElementById('selectedColumns');
            const dropZone = document.getElementById('dropZone');
            const addFilterBtn = document.getElementById('addFilterBtn');
            const previewBtn = document.getElementById('previewSqlBtn');
            if (!container || !dropZone) return;

            if (qbState.columns.length === 0) {
                container.innerHTML = '';
                dropZone.className = 'drop-zone';
                dropZone.innerHTML = 'Drag fields from table cards above';
                document.querySelectorAll('.gen-query-btn').forEach(b => b.disabled = true);
                document.getElementById('saveBtn').disabled = true;
                if (addFilterBtn) addFilterBtn.disabled = true;
                if (previewBtn) previewBtn.disabled = true;            qbState.filters = [];
            qbState.groupBy = [];
            qbState.having = [];
            renderFilters();
            renderSort();
            renderGroupBy();
            renderHaving();
            refreshFieldRowStates();
            return;
        }

        schedulePreview();

        var aggrFunctions = ['', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];

            dropZone.className = 'drop-zone has-items';
            dropZone.innerHTML = qbState.columns.map(function(col, idx) {
                var aggrOptions = aggrFunctions.map(function(a) {
                    var sel = (a === (col.aggregate || '')) ? ' selected' : '';
                    var label = a || 'None';
                    return '<option value="' + a + '"' + sel + '>' + label + '</option>';
                }).join('');
                return '<span class="qb-col">' +
                    '<span class="qb-col-table">' + col.table + '</span>.' +
                    '<select class="qb-col-aggr" onchange="setColAggregate(' + idx + ', this.value)">' + aggrOptions + '</select>' +
                    '<span class="qb-col-field">' + col.field + '</span>' +
                    '<button class="qb-col-remove" onclick="removeColumn(' + idx + ')" title="Remove">&times;</button></span>';
            }).join('');

            var colCount = qbState.columns.length;
            var tableNames = [];
            qbState.columns.forEach(function(c) {
                if (tableNames.indexOf(c.table) === -1) tableNames.push(c.table);
            });
            var tableCount = tableNames.length;
            container.innerHTML = '<div style="font-size:11px;color:#666;margin-top:4px;">' + colCount + ' column' + (colCount !== 1 ? 's' : '') + ' selected from ' + tableCount + ' table' + (tableCount !== 1 ? 's' : '') + '</div>';
            document.querySelectorAll('.gen-query-btn').forEach(b => b.disabled = false);
            document.getElementById('saveBtn').disabled = false;
            if (addFilterBtn) addFilterBtn.disabled = false;
            if (previewBtn) previewBtn.disabled = false;
            renderFilters();
            renderSort();
            renderGroupBy();
            renderHaving();
            refreshFieldRowStates();
        }

        function addColumn(tableName, fieldName) {
            // Avoid duplicates
            if (qbState.columns.some(c => c.table === tableName && c.field === fieldName)) return;
            qbState.columns.push({ table: tableName, field: fieldName });
            renderSelectedColumns();
        }

        function selectAllFields(tableName, event) {
            if (event) event.stopPropagation();
            // Find all field rows for this table and add each field
            var rows = document.querySelectorAll('.field-row[data-table-name="' + tableName + '"]');
            rows.forEach(function(row) {
                var field = row.getAttribute('data-field-name');
                if (!field) return;
                if (qbState.columns.some(function(c) { return c.table === tableName && c.field === field; })) return;
                qbState.columns.push({ table: tableName, field: field });
            });
            renderSelectedColumns();
        }

        function toggleFieldQuery(tableName, fieldName) {
            var idx = qbState.columns.findIndex(function(c) {
                return c.table === tableName && c.field === fieldName;
            });
            if (idx >= 0) {
                removeColumn(idx);
            } else {
                addColumn(tableName, fieldName);
            }
        }

        function refreshFieldRowStates() {
            document.querySelectorAll('.field-row').forEach(function(row) {
                var table = row.getAttribute('data-table-name');
                var field = row.getAttribute('data-field-name');
                var inQuery = qbState.columns.some(function(c) {
                    return c.table === table && c.field === field;
                });
                var cb = row.querySelector('.field-toggle-cb');
                if (cb) cb.checked = inQuery;
                row.classList.toggle('qb-active', inQuery);
            });
        }

        function removeColumn(index) {
            var removed = qbState.columns[index];
            qbState.columns.splice(index, 1);
            // Remove any filters that reference the deleted column
            qbState.filters = qbState.filters.filter(function(f) {
                return !(f.table === removed.table && f.field === removed.field);
            });
            // Clear sortBy if it referenced the deleted column
            if (qbState.sortBy && qbState.sortBy.table === removed.table && qbState.sortBy.field === removed.field) {
                qbState.sortBy = null;
            }
            // Remove from groupBy if it referenced the deleted column
            qbState.groupBy = qbState.groupBy.filter(function(g) {
                return !(g.table === removed.table && g.field === removed.field);
            });
            // Remove any having conditions that reference the deleted column
            qbState.having = qbState.having.filter(function(h) {
                return !(h.table === removed.table && h.field === removed.field);
            });
            renderSelectedColumns();
        }

        function clearQuery() {
            qbState.columns = [];
            qbState.filters = [];
            qbState.sortBy = null;
            qbState.sortLimit = '';
            qbState.groupBy = [];
            qbState.having = [];
            qbState.distinct = false;
            qbState.joinType = 'LEFT';
            document.getElementById('queryName').value = '';
            // Uncheck the DISTINCT toggle visually
            var dt = document.querySelector('.qb-distinct-toggle input');
            if (dt) dt.checked = false;
            // Clear the SQL preview
            var previewTa = document.getElementById('sqlPreview');
            if (previewTa) previewTa.value = '';
            renderSelectedColumns();
            renderFilters();
            renderSort();
            renderGroupBy();
            renderHaving();
            document.getElementById('dropZone').className = 'drop-zone';
        }

        // Listen for messages from the extension (query data, run results, etc.)
        window.addEventListener('message', function(event) {
            const msg = event.data;
            if (msg.command === 'dbFileList') {
                var select = document.getElementById('dbFileSelect');
                if (!select) return;
                var currentVal = select.value;
                var html = '<option value="">— No database selected —</option>';
                if (msg.files && msg.files.length > 0) {
                    msg.files.forEach(function(f) {
                        var sel = (f === msg.selectedPath) ? ' selected' : '';
                        html += '<option value="' + f.replace(/'/g, "\\'") + '"' + sel + '>' + f + '</option>';
                    });
                } else {
                    html += '<option value="" disabled>No .db files found in workspace</option>';
                }
                select.innerHTML = html;
                if (msg.selectedPath) {
                    selectedDbPath = msg.selectedPath;
                }
            } else if (msg.command === 'queryRunning') {
                var resultsDiv = document.getElementById('queryResults');
                if (resultsDiv) resultsDiv.innerHTML = '<div class="qb-results-running">Running query...</div>';
            } else if (msg.command === 'queryResult') {
                var resultsDiv = document.getElementById('queryResults');
                if (!resultsDiv) return;
                if (!msg.success) {
                    resultsDiv.innerHTML = '<div class="qb-results-error">' + (msg.error || 'Unknown error') + '</div>';
                } else {
                    var html = '';
                    html += '<div class="qb-results-info">';
                    html += '<span class="result-ok">&#x2713; Query executed</span>';
                    html += '<span class="qb-results-count">' + (msg.rowCount || 0) + ' row' + (msg.rowCount !== 1 ? 's' : '') + ' returned</span>';
                    html += '</div>';
                    if (msg.results && msg.results.length > 0 && msg.results[0].columns.length > 0) {
                        html += '<div class="qb-results-table-wrap"><table class="qb-results-table">';
                        html += '<thead><tr>';
                        msg.results[0].columns.forEach(function(col) {
                            html += '<th>' + col + '</th>';
                        });
                        html += '</tr></thead><tbody>';
                        msg.results[0].rows.forEach(function(row) {
                            html += '<tr>';
                            msg.results[0].columns.forEach(function(col) {
                                var val = row[col];
                                if (val === null || val === undefined) {
                                    html += '<td><span style="color:#666;font-style:italic;">NULL</span></td>';
                                } else {
                                    var escaped = String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                                    html += '<td>' + escaped + '</td>';
                                }
                            });
                            html += '</tr>';
                        });
                        html += '</tbody></table></div>';
                    } else {
                        html += '<div class="qb-results-empty">Query executed successfully (no result rows)</div>';
                    }
                    resultsDiv.innerHTML = html;
                }
            } else if (msg.command === 'queryLoaded') {
                qbState.columns = msg.columns || [];
                qbState.filters = msg.filters || [];
                qbState.sortBy = msg.sortBy || null;
                qbState.sortLimit = msg.limit || '';
                qbState.groupBy = msg.groupBy || [];
                qbState.having = msg.having || [];
                qbState.distinct = !!msg.distinct;
                qbState.joinType = msg.joinType || 'LEFT';
                document.getElementById('queryName').value = msg.queryName || '';
                // Sync the DISTINCT checkbox
                    var dt = document.querySelector('.qb-distinct-toggle input');
                if (dt) dt.checked = qbState.distinct;
                renderSelectedColumns();
                renderSort();
                renderGroupBy();
                renderHaving();
            } else if (msg.command === 'sqlPreviewResult') {
                var ta = document.getElementById('sqlPreview');
                if (ta) ta.value = msg.sql || '-- No SQL generated';
            } else if (msg.command === 'authFieldsReceived') {
                renderAuthFields(msg.table, msg.suggestedIdentity || [], msg.suggestedPassword || null, msg.suggestedStatus || null);
                // Apply any saved state overrides (e.g. after webview re-creation)
                var saved = vscode.getState();
                if (saved && saved.authTable === msg.tableName) {
                    // Restore identity field checkboxes
                    if (saved.authIdentityFields && saved.authIdentityFields.length > 0) {
                        authState.identityFields = saved.authIdentityFields.slice();
                        document.querySelectorAll('#authIdentityFields input[type="checkbox"]').forEach(function(cb) {
                            var match = cb.getAttribute('onchange').match(/toggleAuthIdentityField\('([^']+)'/);
                            if (match) {
                                var fieldName = match[1];
                                var shouldCheck = saved.authIdentityFields.indexOf(fieldName) >= 0;
                                cb.checked = shouldCheck;
                                var label = cb.closest('.auth-field-cb');
                                if (label) label.classList.toggle('checked', shouldCheck);
                            }
                        });
                    }
                    // Restore password field selection
                    if (saved.authPasswordField) {
                        authState.passwordField = saved.authPasswordField;
                        var pwSelect = document.getElementById('authPasswordSelect');
                        if (pwSelect) pwSelect.value = saved.authPasswordField;
                    }
                    // Restore status field selection
                    authState.statusField = saved.authStatusField || null;
                    var statSelect = document.getElementById('authStatusSelect');
                    if (statSelect) statSelect.value = saved.authStatusField || '';
                    updateAuthGenBtn();
                }
            } else if (msg.command === 'authPreviewResult') {
                var authTa = document.getElementById('authPreview');
                if (authTa) authTa.value = msg.code || '// No code generated';
            }
        });

        // On load: restore any saved auth state from previous webview session
        restoreAuthState();

        // Drop zone handlers
        document.addEventListener('DOMContentLoaded', function() {
            // Auto-populate database file list
            findDbFiles();

            const dropZone = document.getElementById('dropZone');
            if (!dropZone) return;

            dropZone.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                this.classList.add('drag-over');
            });

            dropZone.addEventListener('dragleave', function(e) {
                e.preventDefault();
                this.classList.remove('drag-over');
            });

            dropZone.addEventListener('drop', function(e) {
                e.preventDefault();
                this.classList.remove('drag-over');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data.table && data.field) {
                        addColumn(data.table, data.field);
                    }
                } catch (err) {
                    // Invalid drag data
                }
            });
        });

        // Saved queries
        function loadSavedQueries() {
            vscode.postMessage({ command: 'getQueries' });
        }

        function loadSavedQuery(name) {
            vscode.postMessage({ command: 'loadQuery', queryName: name });
        }

        function saveQuery() {
            const name = document.getElementById('queryName').value.trim();
            if (!name) {
                document.getElementById('queryName').focus();
                document.getElementById('queryName').style.borderColor = '#c03131';
                setTimeout(() => document.getElementById('queryName').style.borderColor = '', 1500);
                return;
            }
            if (qbState.columns.length === 0) return;
            vscode.postMessage({
                command: 'saveQuery',
                queryName: name,
                columns: qbState.columns,
                filters: qbState.filters,
                sortBy: qbState.sortBy,
                limit: qbState.sortLimit,
                groupBy: qbState.groupBy,
                having: qbState.having,
                distinct: qbState.distinct,
                joinType: qbState.joinType
            });
        }

        function generateQuery(type) {
            const name = document.getElementById('queryName').value.trim() || 'customQuery';
            if (qbState.columns.length === 0) return;
            vscode.postMessage({
                command: 'generateQuery',
                queryName: name,
                columns: qbState.columns,
                filters: qbState.filters,
                sortBy: qbState.sortBy,
                limit: qbState.sortLimit,
                groupBy: qbState.groupBy,
                having: qbState.having,
                distinct: qbState.distinct,
                joinType: qbState.joinType,
                type: type || 'all'
            });
        }

        function copySqlPreview() {
            var ta = document.getElementById('sqlPreview');
            if (!ta || !ta.value) return;
            navigator.clipboard.writeText(ta.value).then(function() {
                var btn = document.getElementById('copySqlBtn');
                if (!btn) return;
                var orig = btn.textContent;
                btn.textContent = 'Copied!';
                btn.style.background = '#0d7a3e';
                btn.style.color = '#fff';
                setTimeout(function() {
                    btn.textContent = orig;
                    btn.style.background = '';
                    btn.style.color = '';
                }, 1500);
            }).catch(function() {
                // Fallback: select the text
                ta.select();
            });
        }

        function removeQuery(name, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'removeQuery', queryName: name });
        }

        // --- DB Runner ---
        var selectedDbPath = '';

        function findDbFiles() {
            vscode.postMessage({ command: 'findDbFiles' });
        }

        function onDbFileChange(path) {
            selectedDbPath = path;
            vscode.postMessage({ command: 'selectDb', dbPath: path });
        }

        function runSqlQuery() {
            var ta = document.getElementById('sqlPreview');
            if (!ta || !ta.value) return;
            if (!selectedDbPath) {
                var results = document.getElementById('queryResults');
                if (results) results.innerHTML = '<div class="qb-results-error">Select a database file first.</div>';
                return;
            }
            vscode.postMessage({ command: 'runQuery', sql: ta.value });
        }
        // --- end DB Runner ---

        // --- Tab Navigation ---
        function switchTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(function(el) {
                el.classList.remove('tab-active');
            });
            document.querySelectorAll('.tab-btn').forEach(function(el) {
                el.classList.remove('tab-active');
            });
            var tabId = 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1) + 'Content';
            var btnId = 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
            var tabEl = document.getElementById(tabId);
            var btnEl = document.getElementById(btnId);
            if (tabEl) tabEl.classList.add('tab-active');
            if (btnEl) btnEl.classList.add('tab-active');
        }

        // --- Auth Generator ---
        var authState = { table: null, identityFields: [], passwordField: null, statusField: null };

        function saveAuthState() {
            vscode.setState({
                authTable: authState.table,
                authIdentityFields: authState.identityFields,
                authPasswordField: authState.passwordField,
                authStatusField: authState.statusField
            });
        }

        function restoreAuthState() {
            var saved = vscode.getState();
            if (saved && saved.authTable) {
                authState.table = saved.authTable;
                authState.identityFields = saved.authIdentityFields || [];
                authState.passwordField = saved.authPasswordField || null;
                authState.statusField = saved.authStatusField || null;
                // Fetch fields from extension — the message listener's override logic
                // will re-apply saved identity/password/status selections over auto-detected defaults
                vscode.postMessage({ command: 'getAuthTableFields', tableName: saved.authTable });
            }
        }

        function onAuthTableChange(tableName) {
            if (!tableName) {
                disableAuthSections();
                authState.table = null;
                saveAuthState();
                return;
            }
            authState.table = tableName;
            // Don't clear identity/password/status here — wait for extension response
            vscode.postMessage({ command: 'getAuthTableFields', tableName: tableName });
        }

        function disableAuthSections() {
            ['authIdentitySection','authPasswordSection','authStatusSection','authOptionsSection'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; }
            });
            document.getElementById('authGenBtn').disabled = true;
            document.getElementById('authPrevBtn').disabled = true;
        }

        function enableAuthSections() {
            ['authIdentitySection','authPasswordSection','authStatusSection','authOptionsSection'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.style.opacity = '1'; el.style.pointerEvents = 'auto'; }
            });
        }

        function renderAuthFields(table, suggestedIdentity, suggestedPassword, suggestedStatus) {
            enableAuthSections();

            // Render identity field checkboxes
            var container = document.getElementById('authIdentityFields');
            if (!container) return;
            authState.identityFields = [];
            container.innerHTML = table.fields.map(function(f) {
                if (f.name === suggestedPassword) return '';
                var isSuggested = suggestedIdentity.indexOf(f.name) >= 0;
                if (isSuggested) authState.identityFields.push(f.name);
                var checked = isSuggested ? ' checked' : '';
                var cls = isSuggested ? 'auth-field-cb checked' : 'auth-field-cb';
                var typeLabel = f.type || 'TEXT';
                var safeName = f.name.replace(/'/g, "\\'");
                return '<label class="' + cls + '">' +
                    '<input type="checkbox" ' + checked + ' onchange="toggleAuthIdentityField(\'' + safeName + '\', this.checked)" />' +
                    '<span>' + f.name + '</span>' +
                    '<span class="auth-cb-type">(' + typeLabel + ')</span>' +
                    '</label>';
            }).filter(Boolean).join('') || '<span class="auth-no-fields">No fields available</span>';

            // Render password dropdown
            var pwSelect = document.getElementById('authPasswordSelect');
            if (pwSelect) {
                pwSelect.innerHTML = '<option value="">— Select password field —</option>' +
                    table.fields.map(function(f) {
                        var sel = (f.name === suggestedPassword) ? ' selected' : '';
                        return '<option value="' + f.name.replace(/'/g, "\\'") + '"' + sel + '>' + f.name + ' (' + (f.type || 'TEXT') + ')</option>';
                    }).join('');
                authState.passwordField = suggestedPassword;
            }

            // Render status dropdown
            var statSelect = document.getElementById('authStatusSelect');
            if (statSelect) {
                statSelect.innerHTML = '<option value="">— None (skip status check) —</option>' +
                    table.fields.map(function(f) {
                        var sel = (f.name === suggestedStatus) ? ' selected' : '';
                        return '<option value="' + f.name.replace(/'/g, "\\'") + '"' + sel + '>' + f.name + ' (' + (f.type || 'TEXT') + ')</option>';
                    }).join('');
                authState.statusField = suggestedStatus;
            }

            updateAuthGenBtn();
        }

        function onAuthPasswordChange(val) {
            authState.passwordField = val || null;
            saveAuthState();
            updateAuthGenBtn();
        }

        function onAuthStatusChange(val) {
            authState.statusField = val || null;
            saveAuthState();
            updateAuthGenBtn();
        }

        function toggleAuthIdentityField(fieldName, checked) {
            if (checked) {
                if (authState.identityFields.indexOf(fieldName) < 0) {
                    authState.identityFields.push(fieldName);
                }
            } else {
                authState.identityFields = authState.identityFields.filter(function(f) { return f !== fieldName; });
            }
            // Update visual state
            document.querySelectorAll('#authIdentityFields .auth-field-cb').forEach(function(lbl) {
                var cb = lbl.querySelector('input[type="checkbox"]');
                var name = '';
                if (cb) {
                    var match = cb.getAttribute('onchange').match(/toggleAuthIdentityField\('([^']+)'/);
                    if (match) name = match[1];
                }
                lbl.classList.toggle('checked', authState.identityFields.indexOf(name) >= 0);
            });
            saveAuthState();
            updateAuthGenBtn();
        }

        function onAuthOptionChange() {
            updateAuthGenBtn();
        }

        function updateAuthGenBtn() {
            var hasIdentity = authState.identityFields.length > 0;
            var hasPassword = !!authState.passwordField;
            var hasRoute = document.getElementById('authOptRoute') ? document.getElementById('authOptRoute').checked : false;
            var hasRegister = document.getElementById('authOptRegister') ? document.getElementById('authOptRegister').checked : false;
            var hasHtml = document.getElementById('authOptHtml') ? document.getElementById('authOptHtml').checked : false;
            var enabled = authState.table && hasIdentity && hasPassword && (hasRoute || hasRegister || hasHtml);
            var genBtn = document.getElementById('authGenBtn');
            var prevBtn = document.getElementById('authPrevBtn');
            if (genBtn) genBtn.disabled = !enabled;
            if (prevBtn) prevBtn.disabled = !enabled;
        }

        function generateAuth() {
            if (!authState.table || authState.identityFields.length === 0 || !authState.passwordField) return;
            var genRoute = document.getElementById('authOptRoute') ? document.getElementById('authOptRoute').checked : true;
            var genRegister = document.getElementById('authOptRegister') ? document.getElementById('authOptRegister').checked : false;
            var genHtml = document.getElementById('authOptHtml') ? document.getElementById('authOptHtml').checked : true;
            var useJwt = document.getElementById('authOptJwt') ? document.getElementById('authOptJwt').checked : true;
            var useBcrypt = document.getElementById('authOptBcrypt') ? document.getElementById('authOptBcrypt').checked : true;
            vscode.postMessage({
                command: 'generateAuth',
                tableName: authState.table,
                identityFields: authState.identityFields,
                passwordField: authState.passwordField,
                statusField: authState.statusField || null,
                options: {
                    useJwt: useJwt,
                    useBcrypt: useBcrypt,
                    generateRoute: genRoute,
                    generateRegister: genRegister,
                    generateHtml: genHtml
                }
            });
        }

        function previewAuthSql() {
            if (!authState.table || authState.identityFields.length === 0 || !authState.passwordField) return;
            var useBcrypt = document.getElementById('authOptBcrypt') ? document.getElementById('authOptBcrypt').checked : true;
            vscode.postMessage({
                command: 'previewAuthSql',
                tableName: authState.table,
                identityFields: authState.identityFields,
                passwordField: authState.passwordField,
                statusField: authState.statusField || null,
                useBcrypt: useBcrypt
            });
        }

        function clearAuth() {
            var tableSelect = document.getElementById('authTableSelect');
            if (tableSelect) tableSelect.value = '';
            var idFields = document.getElementById('authIdentityFields');
            if (idFields) idFields.innerHTML = '<span class="auth-no-fields">Select a table first</span>';
            var pwSelect = document.getElementById('authPasswordSelect');
            if (pwSelect) pwSelect.innerHTML = '<option value="">— Select password field —</option>';
            var statSelect = document.getElementById('authStatusSelect');
            if (statSelect) statSelect.innerHTML = '<option value="">— None (skip status check) —</option>';
            var preview = document.getElementById('authPreview');
            if (preview) preview.value = '';
            disableAuthSections();
            authState.table = null;
            authState.identityFields = [];
            authState.passwordField = null;
            authState.statusField = null;
            saveAuthState();
        }

        function copyAuthPreview() {
            var ta = document.getElementById('authPreview');
            if (!ta || !ta.value) return;
            navigator.clipboard.writeText(ta.value).then(function() {
                var btn = document.getElementById('copyAuthBtn');
                if (!btn) return;
                var orig = btn.textContent;
                btn.textContent = 'Copied!';
                btn.style.background = '#0d7a3e';
                btn.style.color = '#fff';
                setTimeout(function() {
                    btn.textContent = orig;
                    btn.style.background = '';
                    btn.style.color = '';
                }, 1500);
            }).catch(function() {
                ta.select();
            });
        }
        // --- end Auth Generator ---

        function toggleHelp(event) {
            if (event) event.stopPropagation();
            const content = document.getElementById('helpContent');
            const btn = document.querySelector('.help-toggle');
            if (!content || !btn) return;
            content.classList.toggle('hidden');
            btn.innerHTML = '<span class="arrow">' + (content.classList.contains('hidden') ? '\u25B6' : '\u25BC') + '</span> ' + (content.classList.contains('hidden') ? 'Show' : 'Hide');
        }

        
        // --- Quick App Generator ---
        var qsTables = [];
        // Initialize qsTables with all pre-checked tables on page load
        try {
            var qsCbs = document.querySelectorAll('#qsTableList input[type="checkbox"]');
            if (qsCbs && qsCbs.length > 0) {
                qsCbs.forEach(function(cb) {
                    var onchange = cb.getAttribute('onchange') || '';
                    var m = onchange.match(/onQsTableToggle\('([^']+)'/);
                    if (m) qsTables.push(m[1]);
                });
            }
        } catch(e) {
            // Silently handle init error
        }
        updateQsBtn();

        function onQsTableToggle(name, checked) {

            if (checked) {
                if (qsTables.indexOf(name) < 0) qsTables.push(name);
            } else {
                qsTables = qsTables.filter(function(t) { return t !== name; });
            }
            updateQsBtn();
        }

        function onQsOptionChange() {
            updateQsBtn();
        }

        function onQsAuthToggle(checked) {
            updateQsBtn();
        }

        function updateQsBtn() {
            var tablesSelected = qsTables.length > 0;
            var hasRoute = document.getElementById('qsOptCrud') ? document.getElementById('qsOptCrud').checked : false;
            var hasCreate = document.getElementById('qsOptCreateTable') ? document.getElementById('qsOptCreateTable').checked : false;
            var hasPage = document.getElementById('qsOptPage') ? document.getElementById('qsOptPage').checked : false;
            var enabled = tablesSelected && (hasRoute || hasCreate || hasPage);
            var btn = document.getElementById('qsGenBtn');
            if (btn) btn.disabled = !enabled;
        }

        function generateApp() {
            var tablesList = [];
            // Collect checked tables
            document.querySelectorAll('#qsTableList .auth-field-cb input[type="checkbox"]').forEach(function(cb) {
                var onclick = cb.getAttribute('onchange') || '';
                var match = onclick.match(/onQsTableToggle\('([^']+)'/);
                if (match && cb.checked) tablesList.push(match[1]);
            });
            if (tablesList.length === 0) return;
            var crud = document.getElementById('qsOptCrud') ? document.getElementById('qsOptCrud').checked : false;
            var createTable = document.getElementById('qsOptCreateTable') ? document.getElementById('qsOptCreateTable').checked : false;
            var page = document.getElementById('qsOptPage') ? document.getElementById('qsOptPage').checked : false;
            var boilerplate = document.getElementById('qsOptBoilerplate') ? document.getElementById('qsOptBoilerplate').checked : false;
            var includeAuth = document.getElementById('qsEnableAuth') ? document.getElementById('qsEnableAuth').checked : false;

            var authConfig = null;
            if (includeAuth && window.authState && window.authState.table) {
                authConfig = {
                    tableName: window.authState.table,
                    identityFields: window.authState.identityFields,
                    passwordField: window.authState.passwordField,
                    statusField: window.authState.statusField || null,
                    useJwt: true,
                    generateRoute: true,
                    generateHtml: true
                };
            }

            vscode.postMessage({
                command: 'generateApp',
                tableConfigs: tablesList.map(function(t) {
                    return { tableName: t, crud: crud, createTable: createTable, page: page, list: false, form: false };
                }),
                authConfig: authConfig,
                options: {
                    includeServerBoilerplate: boilerplate,
                    includeHtmlBoilerplate: boilerplate
                }
            });
        }

        function clearQs() {
            document.querySelectorAll('#qsTableList input[type="checkbox"]').forEach(function(cb) {
                cb.checked = true;
            });
            document.getElementById('qsEnableAuth').checked = false;
            // Re-init qsTables
            qsTables = [];
            document.querySelectorAll('#qsTableList .auth-field-cb').forEach(function(lbl) {
                var match = lbl.querySelector('input') ? (lbl.querySelector('input').getAttribute('onchange') || '').match(/onQsTableToggle\('([^']+)'/) : null;
                if (match) qsTables.push(match[1]);
                lbl.classList.add('checked');
                lbl.style.borderColor = '#4fc3f7';
                lbl.style.background = '#0d2a2a';
                lbl.style.color = '#8cf';
            });
            updateQsBtn();
        }
        // --- end Quick App Generator ---

        function editField(tableName, fieldName, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'editField', tableName, fieldName });
        }

        function previewSql(tableName, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'previewSql', tableName });
        }

    