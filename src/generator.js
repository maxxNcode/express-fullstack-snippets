const { QueryGenerator } = require('./queryGenerator');

class CodeGenerator {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
        this.queryGen = new QueryGenerator(schemaRegistry);
    }

    getPK(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return 'id';
        const pk = table.fields.find(f => f.pk);
        return pk ? pk.name : (table.fields.length > 0 ? table.fields[0].name : 'id');
    }

    getNonPKFields(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return [];
        return table.fields.filter(f => !f.pk);
    }

    _getFullSettings(tableName) {
        const raw = this.schemaRegistry.getTableSettings(tableName) || {};
        return {
            statusField: raw.statusField || '',
            statusUiStyle: raw.statusUiStyle || 'radio',
            statusActiveValue: raw.statusActiveValue || 'active',
            statusInactiveValue: raw.statusInactiveValue || 'inactive',
            editMode: raw.editMode || 'put',
            showDeleteButton: raw.showDeleteButton === true,
            editStyle: raw.editStyle || 'form',
            pageSize: raw.pageSize || 10,
            sortField: raw.sortField || '',
            sortDir: raw.sortDir || 'asc',
            showColumnVisibility: raw.showColumnVisibility === true
        };
    }

    _detectUiType(field, tableName) {
        if (field.uiType) return field.uiType;
        if (field.options && field.options.length > 0) return 'select';
        const raw = (field.rawType || field.type || '').toUpperCase();
        const name = field.name.toLowerCase();
        if (field.fk) return 'fk-select';
        if (/^BOOLEAN|BOOL|BIT$/.test(raw)) return 'checkbox';
        if (/^DATE|DATETIME|TIMESTAMP$/.test(raw)) return 'date';
        if (raw === 'TIME') return 'time';
        if (raw === 'YEAR') return 'number';
        if (name.includes('email')) return 'email';
        if (name.includes('pass')) return 'password';
        if (name.includes('url') || name.includes('website') || name.includes('site')) return 'url';
        if (name.includes('phone') || name.includes('tel') || name.includes('mobile')) return 'tel';
        if (name.includes('color') || name.includes('colour')) return 'color';
        if (name.includes('desc') || name.includes('bio') || name.includes('notes') || name.includes('details') || name.includes('comment')) return 'textarea';
        if (field.type === 'INTEGER' || field.type === 'REAL') return 'number';
        return 'text';
    }

    getStatField(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return null;
        const settings = this._getFullSettings(tableName);
        if (settings.statusField) {
            if (settings.statusField === '__none__') return null;
            const match = table.fields.find(f => f.name === settings.statusField);
            if (match) return match;
        }
        return table.fields.find(f => f.name.toLowerCase().includes('stat')) || null;
    }

    _getEditMode(tableName) {
        return this._getFullSettings(tableName).editMode;
    }

    _isStatusField(tableName, fieldName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return false;
        const settings = this._getFullSettings(tableName);
        if (settings.statusField) return settings.statusField === fieldName;
        return fieldName.toLowerCase().includes('stat');
    }

    generatePrepStatements(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '// Table not found';
        const pk = this.getPK(tableName);
        const nonPK = this.getNonPKFields(tableName);
        const insertFields = nonPK.map(f => f.name).join(', ');
        const insertPlaceholders = nonPK.map(() => '?').join(', ');
        const updateSet = nonPK.map(f => `${f.name} = ?`).join(', ');
        const statField = this.getStatField(tableName);
        const varPrefix = tableName.charAt(0).toLowerCase() + tableName.slice(1);

        const lines = [];
        lines.push(`// --- ${tableName} ---`);
        lines.push(`const ${varPrefix}GetAll = db.prepare('SELECT * FROM ${tableName}');`);
        lines.push(`const ${varPrefix}GetOne = db.prepare('SELECT * FROM ${tableName} WHERE ${pk} = ?');`);
        if (insertFields) {
            lines.push(`const ${varPrefix}Insert = db.prepare('INSERT INTO ${tableName} (${insertFields}) VALUES (${insertPlaceholders})');`);
        }
        if (updateSet) {
            lines.push(`const ${varPrefix}Update = db.prepare('UPDATE ${tableName} SET ${updateSet} WHERE ${pk} = ?');`);
        }
        if (statField) {
            const s = this._getFullSettings(tableName);
            lines.push(`const ${varPrefix}Deactivate = db.prepare("UPDATE ${tableName} SET ${statField.name} = '${s.statusInactiveValue}' WHERE ${pk} = ?");`);
            lines.push(`const ${varPrefix}Activate = db.prepare("UPDATE ${tableName} SET ${statField.name} = '${s.statusActiveValue}' WHERE ${pk} = ?");`);
            if (s.showDeleteButton) {
                lines.push(`const ${varPrefix}HardDelete = db.prepare('DELETE FROM ${tableName} WHERE ${pk} = ?');`);
            }
        } else {
            lines.push(`const ${varPrefix}Remove = db.prepare('DELETE FROM ${tableName} WHERE ${pk} = ?');`);
        }
        return lines.join('\n');
    }

    generateCrudRoutes(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '// Table not found';
        const pk = this.getPK(tableName);
        const nonPK = this.getNonPKFields(tableName);
        const varPrefix = tableName.charAt(0).toLowerCase() + tableName.slice(1);
        const statField = this.getStatField(tableName);
        const s = this._getFullSettings(tableName);
        const listRoute = `/api/${tableName.toLowerCase()}`;
        const itemRoute = `/api/${tableName.toLowerCase()}/:${pk}`;

        let routes = '';

        routes += `// GET all ${tableName}\n`;
        routes += `app.get('${listRoute}', (req, res) => {\n`;
        routes += `  try {\n`;
        routes += `    res.json(${varPrefix}GetAll.all());\n`;
        routes += `  } catch (err) {\n`;
        routes += `    res.status(500).json({ error: err.message });\n`;
        routes += `  }\n`;
        routes += `});\n\n`;

        routes += `// GET one ${tableName}\n`;
        routes += `app.get('${itemRoute}', (req, res) => {\n`;
        routes += `  try {\n`;
        routes += `    const row = ${varPrefix}GetOne.get(req.params.${pk});\n`;
        routes += `    if (!row) return res.status(404).json({ error: 'Not found' });\n`;
        routes += `    res.json(row);\n`;
        routes += `  } catch (err) {\n`;
        routes += `    res.status(500).json({ error: err.message });\n`;
        routes += `  }\n`;
        routes += `});\n\n`;

        if (nonPK.length > 0) {
            routes += `// Create ${tableName}\n`;
            routes += `app.post('${listRoute}', (req, res) => {\n`;
            routes += `  try {\n`;
            routes += `    const { ${nonPK.map(f => f.name).join(', ')} } = req.body;\n`;
            routes += `    const result = ${varPrefix}Insert.run(${nonPK.map(f => f.name).join(', ')});\n`;
            routes += `    res.status(201).json({ ${pk}: result.lastInsertRowid });\n`;
            routes += `  } catch (err) {\n`;
            routes += `    res.status(500).json({ error: err.message });\n`;
            routes += `  }\n`;
            routes += `});\n\n`;

            routes += `// Update ${tableName}\n`;
            const updateMethod = this._getEditMode(tableName);
            routes += `app.${updateMethod}('${itemRoute}', (req, res) => {\n`;
            routes += `  try {\n`;
            routes += `    const { ${nonPK.map(f => f.name).join(', ')} } = req.body;\n`;
            routes += `    const result = ${varPrefix}Update.run(${nonPK.map(f => f.name).join(', ')}, req.params.${pk});\n`;
            routes += `    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });\n`;
            routes += `    res.json({ updated: result.changes });\n`;
            routes += `  } catch (err) {\n`;
            routes += `    res.status(500).json({ error: err.message });\n`;
            routes += `  }\n`;
            routes += `});\n\n`;
        }

        routes += `// ${statField ? 'Deactivate' : 'Delete'} ${tableName}\n`;
        routes += `app.delete('${itemRoute}', (req, res) => {\n`;
        routes += `  try {\n`;
        if (statField) {
            routes += `    const result = ${varPrefix}Deactivate.run(req.params.${pk});\n`;
        } else {
            routes += `    const result = ${varPrefix}Remove.run(req.params.${pk});\n`;
        }
        routes += `    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });\n`;
        routes += `    res.json({ ${statField ? 'deactivated' : 'deleted'}: result.changes });\n`;
        routes += `  } catch (err) {\n`;
        routes += `    res.status(500).json({ error: err.message });\n`;
        routes += `  }\n`;
        routes += `});\n`;

        if (statField) {
            routes += `\n// Activate ${tableName}\n`;
            routes += `app.put('${itemRoute}/activate', (req, res) => {\n`;
            routes += `  try {\n`;
            routes += `    const result = ${varPrefix}Activate.run(req.params.${pk});\n`;
            routes += `    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });\n`;
            routes += `    res.json({ activated: result.changes });\n`;
            routes += `  } catch (err) {\n`;
            routes += `    res.status(500).json({ error: err.message });\n`;
            routes += `  }\n`;
            routes += `});\n`;
        }

        if (statField && s.showDeleteButton) {
            routes += `\n// Hard-delete ${tableName}\n`;
            routes += `app.post('${itemRoute}/delete', (req, res) => {\n`;
            routes += `  try {\n`;
            routes += `    const result = ${varPrefix}HardDelete.run(req.params.${pk});\n`;
            routes += `    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });\n`;
            routes += `    res.json({ deleted: result.changes });\n`;
            routes += `  } catch (err) {\n`;
            routes += `    res.status(500).json({ error: err.message });\n`;
            routes += `  }\n`;
            routes += `});\n`;
        }

        return routes;
    }

    generateListHtml(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '<!-- Table not found -->';
        const fields = this.getNonPKFields(tableName);
        const pk = this.getPK(tableName);
        const api = `/api/${tableName.toLowerCase()}`;
        const statField = this.getStatField(tableName);
        const s = this._getFullSettings(tableName);
        const actionLabel = statField ? 'Deactivate' : 'Delete';
        const actionFunc = statField ? 'deactivate' : 'delete';
        const activeVal = statField ? s.statusActiveValue : '';
        const inactiveVal = statField ? s.statusInactiveValue : '';
        const showDelete = statField && s.showDeleteButton;

        const headerCells = fields.map(f => `<th onclick="sort${tableName}('${f.name}')" data-field="${f.name}">${f.name.charAt(0).toUpperCase() + f.name.slice(1)}</th>`).join('\n        ');
        const cellRenderers = fields.map(f => {
            if (f.options && f.options.length > 0) {
                const optMap = JSON.stringify(Object.fromEntries(f.options.map(o => [o.value, o.label])));
                return `<td data-field="${f.name}">\${(${optMap})[item.${f.name}] || item.${f.name}}</td>`;
            }
            return `<td data-field="${f.name}">\${item.${f.name}}</td>`;
        }).join('\n          ');

        let html = `<h2>${tableName}</h2>\n`;
        html += `<div style="display:flex;align-items:center;gap:8px;">\n`;
        html += `  <input type="search" id="search${tableName}" placeholder="Search ${tableName}..." oninput="search${tableName}(this.value)" style="flex:1;">\n`;
        if (s.showColumnVisibility) {
            html += `  <div style="position:relative;">\n`;
            html += `    <button type="button" onclick="toggleColMenu${tableName}()">Columns</button>\n`;
            html += `    <div id="colMenu${tableName}" style="display:none;position:absolute;right:0;z-index:10;">\n`;
            for (const f of fields) {
                html += `      <label><input type="checkbox" data-field="${f.name}" checked onchange="toggleCol${tableName}('${f.name}', this.checked)"> ${f.name.charAt(0).toUpperCase() + f.name.slice(1)}</label>\n`;
            }
            html += `      <label><input type="checkbox" data-field="__actions__" checked onchange="toggleCol${tableName}('__actions__', this.checked)"> Actions</label>\n`;
            html += `    </div>\n`;
            html += `  </div>\n`;
        }
        html += `</div>\n`;
        html += `<div id="${tableName.toLowerCase()}List">Loading...</div>\n`;
        html += `<div id="pagination${tableName}" style="display:flex;align-items:center;justify-content:center;gap:4px;"></div>\n\n`;

        if (s.editStyle === 'modal') {
            html += `<div id="${tableName.toLowerCase()}EditModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;align-items:center;justify-content:center;">\n`;
            html += `  <div style="max-width:500px;width:90%;">\n`;
            html += `    <h3>Edit ${tableName}</h3>\n`;
            html += `    <form id="${tableName.toLowerCase()}EditForm">\n`;
            for (const f of fields) {
                const label = f.name.charAt(0).toUpperCase() + f.name.slice(1);
                const required = f.notNull ? ' required' : '';
                const isStatus = this._isStatusField(tableName, f.name);
                if (isStatus && s.statusField && s.statusField !== '__none__') {
                    const active = s.statusActiveValue;
                    const inactive = s.statusInactiveValue;
                    if (s.statusUiStyle === 'radio') {
                        html += `      <div><label>${label}</label><br>\n`;
                        html += `        <label><input type="radio" name="${f.name}" value="${active}" /> ${active.charAt(0).toUpperCase() + active.slice(1)}</label>\n`;
                        html += `        <label><input type="radio" name="${f.name}" value="${inactive}" /> ${inactive.charAt(0).toUpperCase() + inactive.slice(1)}</label>\n`;
                        html += `      </div>\n`;
                    } else if (s.statusUiStyle === 'dropdown') {
                        html += `      <select name="${f.name}"${required}>\n`;
                        html += `        <option value="${active}">${active.charAt(0).toUpperCase() + active.slice(1)}</option>\n`;
                        html += `        <option value="${inactive}">${inactive.charAt(0).toUpperCase() + inactive.slice(1)}</option>\n`;
                        html += `      </select><br>\n`;
                    } else if (s.statusUiStyle === 'toggle') {
                        html += `      <div><label>${label}</label><br>\n`;
                        html += `        <label>\n`;
                        html += `          <input type="checkbox" name="${f.name}" value="${active}" onchange="this.value=this.checked?'${active}':'${inactive}'">\n`;
                        html += `          <span></span>\n`;
                        html += `        </label>\n`;
                        html += `        <span id="m${f.name}Label">${active.charAt(0).toUpperCase() + active.slice(1)}</span>\n`;
                        html += `        <script>document.querySelector('#${tableName.toLowerCase()}EditForm [name="${f.name}"]').addEventListener('change',function(){document.getElementById('m${f.name}Label').textContent=this.checked?'${active.charAt(0).toUpperCase() + active.slice(1)}':'${inactive.charAt(0).toUpperCase() + inactive.slice(1)}';})<\/script>\n`;
                        html += `      </div>\n`;
                    } else {
                        html += `      <input name="${f.name}"${required}><br>\n`;
                    }
                } else {
                    const uiType = this._detectUiType(f, tableName);
                    if (uiType === 'fk-select') {
                        html += `      <select name="${f.name}" id="${tableName.toLowerCase()}_${f.name}"${required}>\n`;
                        html += `        <option value="">Select ${f.fk.table}</option>\n`;
                        html += `      </select><br>\n`;
                    } else if (uiType === 'select') {
                        html += `      <select name="${f.name}"${required}>\n`;
                        html += `        <option value="">Select ${label}</option>\n`;
                        if (f.options) {
                            for (const o of f.options) {
                                html += `        <option value="${o.value}">${o.label}</option>\n`;
                            }
                        }
                        html += `      </select><br>\n`;
                    } else if (uiType === 'radio') {
                        html += `      <div><label>${label}</label><br>\n`;
                        if (f.options) {
                            for (const o of f.options) {
                                html += `        <label><input type="radio" name="${f.name}" value="${o.value}"> ${o.label}</label>\n`;
                            }
                        }
                        html += `      </div>\n`;
                    } else if (uiType === 'checkbox') {
                        if (f.options && f.options.length > 0) {
                            html += `      <div><label>${label}</label><br>\n`;
                            html += `        <input type="hidden" name="${f.name}" id="e${f.name}Val">\n`;
                            for (const o of f.options) {
                                html += `        <label><input type="checkbox" data-field="${f.name}" value="${o.value}" onchange="updateE${f.name}()"> ${o.label}</label><br>\n`;
                            }
                            html += `        <script>function updateE${f.name}(){var a=[];document.querySelectorAll('#${mid} [data-field="${f.name}"]:checked').forEach(function(c){a.push(c.value)});document.getElementById('e${f.name}Val').value=a.join(',')}<\/script>\n`;
                            html += `      </div>\n`;
                        } else {
                            html += `      <label><input type="checkbox" name="${f.name}" value="1"${required}> ${label}</label>\n`;
                        }
                    } else if (uiType === 'textarea') {
                        html += `      <textarea name="${f.name}" placeholder="${label}"${required}></textarea><br>\n`;
                    } else if (uiType === 'date') {
                        html += `      <input name="${f.name}" type="date"${required}><br>\n`;
                    } else if (uiType === 'time') {
                        html += `      <input name="${f.name}" type="time"${required}><br>\n`;
                    } else if (uiType === 'email') {
                        html += `      <input name="${f.name}" type="email" placeholder="${label}"${required}><br>\n`;
                    } else if (uiType === 'password') {
                        html += `      <input name="${f.name}" type="password" placeholder="${label}"${required}><br>\n`;
                    } else if (uiType === 'url') {
                        html += `      <input name="${f.name}" type="url" placeholder="${label}"${required}><br>\n`;
                    } else if (uiType === 'tel') {
                        html += `      <input name="${f.name}" type="tel" placeholder="${label}"${required}><br>\n`;
                    } else if (uiType === 'color') {
                        html += `      <input name="${f.name}" type="color"${required}><br>\n`;
                    } else if (uiType === 'hidden') {
                        html += `      <input name="${f.name}" type="hidden">\n`;
                    } else if (uiType === 'number') {
                        html += `      <input name="${f.name}" type="number"${f.type === 'REAL' ? ' step="any"' : ''} placeholder="${label}"${required}><br>\n`;
                    } else {
                        html += `      <input name="${f.name}" type="text" placeholder="${label}"${required}><br>\n`;
                    }
                }
            }
            html += `      <div style="display:flex;gap:8px;margin-top:12px;">\n`;
            html += `        <button type="submit">Save Changes</button>\n`;
            html += `        <button type="button" onclick="close${tableName}EditModal()">Cancel</button>\n`;
            html += `      </div>\n`;
            html += `    </form>\n`;
            html += `  </div>\n`;
            html += `</div>\n\n`;

            // Inline FK fetch for modal selects
            const fkFields = fields.filter(f => f.fk);
            for (const f of fkFields) {
                html += `<script>\n`;
                html += `(async function load${f.fk.table}() {\n`;
                html += `  try {\n`;
                html += `    const res = await fetch('/api/${f.fk.table.toLowerCase()}');\n`;
                html += `    const data = await res.json();\n`;
                html += `    const sel = document.getElementById('${tableName.toLowerCase()}_${f.name}');\n`;
                html += `    if (!sel) return;\n`;
                html += `    data.forEach(function(item) {\n`;
                html += `      const opt = document.createElement('option');\n`;
                html += `      opt.value = item.${this.getPK(f.fk.table)};\n`;
                html += `      opt.textContent = Object.values(item).filter(v => v != null).join(' - ');\n`;
                html += `      sel.appendChild(opt);\n`;
                html += `    });\n`;
                html += `  } catch(e) { console.error('Failed to load ${f.fk.table}', e); }\n`;
                html += `})();\n`;
                html += `<\/script>\n`;
            }
        }

        html += `<script>\n`;
        html += `  const API = '${api}';\n`;
        html += `  var data = [];\n`;
        html += `  var currentPage = 1;\n`;
        html += `  var searchQuery = '';\n`;
        html += `  var sortField = '${s.sortField}';\n`;
        html += `  var sortDir = '${s.sortDir || 'asc'}';\n`;
        html += `  var pageSize = ${s.pageSize || 10};\n\n`;
        html += `  async function load${tableName}() {\n`;
        html += `    var response = await fetch(API);\n`;
        html += `    data = await response.json();\n`;
        html += `    currentPage = 1;\n`;
        html += `    searchQuery = '';\n`;
        html += `    var searchEl = document.getElementById('search${tableName}');\n`;
        html += `    if (searchEl) {\n`;
        html += `      searchEl.value = '';\n`;
        html += `    }\n`;
        html += `    render${tableName}();\n`;
        html += `  }\n\n`;
        html += `  function render${tableName}() {\n`;
        html += `    var items = data.slice();\n\n`;
        html += `    // Search filter\n`;
        html += `    if (searchQuery) {\n`;
        html += `      var q = searchQuery.toLowerCase();\n`;
        html += `      items = items.filter(function(item) {\n`;
        html += `        return Object.values(item).some(function(value) {\n`;
        html += `          return String(value).toLowerCase().includes(q);\n`;
        html += `        });\n`;
        html += `      });\n`;
        html += `    }\n\n`;
        html += `    // Sort\n`;
        html += `    if (sortField) {\n`;
        html += `      items.sort(function(a, b) {\n`;
        html += `        var va = a[sortField];\n`;
        html += `        var vb = b[sortField];\n`;
        html += `        if (va == null) va = '';\n`;
        html += `        if (vb == null) vb = '';\n`;
        html += `        if (typeof va === 'number') {\n`;
        html += `          return sortDir === 'asc' ? va - vb : vb - va;\n`;
        html += `        }\n`;
        html += `        var result = String(va).toLowerCase().localeCompare(String(vb).toLowerCase());\n`;
        html += `        return sortDir === 'asc' ? result : -result;\n`;
        html += `      });\n`;
        html += `    }\n\n`;
        html += `    var total = items.length;\n`;
        html += `    var totalPages = Math.ceil(total / pageSize) || 1;\n`;
        html += `    if (currentPage > totalPages) {\n`;
        html += `      currentPage = totalPages;\n`;
        html += `    }\n\n`;
        html += `    var list = document.getElementById('${tableName.toLowerCase()}List');\n\n`;
        html += `    // Empty state\n`;
        html += `    if (total === 0) {\n`;
        html += `      list.innerHTML = '<p>No ${tableName.toLowerCase()} yet.</p>';\n`;
        html += `      document.getElementById('pagination${tableName}').innerHTML = '';\n`;
        html += `      return;\n`;
        html += `    }\n\n`;
        html += `    var pageItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);\n\n`;
        html += `    // Render table\n`;
        html += `    list.innerHTML = \`<table>\n`;
        html += `      <tr>\n`;
        html += `        ${headerCells}\n`;
        html += `        <th data-field="__actions__">Actions</th>\n`;
        html += `      </tr>\n`;
        html += `      \${pageItems.map(function(item) {\n`;
        html += `        return \`<tr>\n`;
        html += `          ${cellRenderers}`;
        let actionsHtml = `\n          <td data-field="__actions__"><button onclick="edit${tableName}(\${item.${pk}})">Edit</button> `;
        if (statField) {
            actionsHtml += `\${item.${statField.name} === '${inactiveVal}' ? \`<button onclick="activate${tableName}(\${item.${pk}})">Activate</button>\` : \`<button onclick="deactivate${tableName}(\${item.${pk}})">Deactivate</button>\`}`;
            if (showDelete) {
                actionsHtml += ` <button onclick="hardDelete${tableName}(\${item.${pk}})">Delete</button>`;
            }
        } else {
            actionsHtml += `<button onclick="${actionFunc}${tableName}(\${item.${pk}})">${actionLabel}</button>`;
        }
        actionsHtml += `</td>\n        `;
        html += actionsHtml;
        html += `\`;\n`;
        html += `      }).join('')}\n`;
        html += `    </table>\`;\n\n`;
        html += `    // Pagination controls\n`;
        html += `    var p = '';\n`;
        html += `    p += '<button onclick="goToPage${tableName}(1)">&laquo;</button>';\n`;
        html += `    p += '<button onclick="goToPage${tableName}(' + (currentPage - 1) + ')"';\n`;
        html += `    if (currentPage <= 1) p += ' disabled';\n`;
        html += `    p += '>&lsaquo;</button>';\n`;
        html += `    p += '<span>Page ' + currentPage + ' of ' + totalPages + ' (' + total + ')</span>';\n`;
        html += `    p += '<button onclick="goToPage${tableName}(' + (currentPage + 1) + ')"';\n`;
        html += `    if (currentPage >= totalPages) p += ' disabled';\n`;
        html += `    p += '>&rsaquo;</button>';\n`;
        html += `    p += '<button onclick="goToPage${tableName}(' + totalPages + ')">&raquo;</button>';\n`;
        html += `    document.getElementById('pagination${tableName}').innerHTML = p;\n`;
        html += `  }\n\n`;
        html += `  function search${tableName}(query) {\n`;
        html += `    searchQuery = query;\n`;
        html += `    currentPage = 1;\n`;
        html += `    render${tableName}();\n`;
        html += `  }\n\n`;
        html += `  function sort${tableName}(field) {\n`;
        html += `    if (sortField === field) {\n`;
        html += `      sortDir = sortDir === 'asc' ? 'desc' : 'asc';\n`;
        html += `    } else {\n`;
        html += `      sortField = field;\n`;
        html += `      sortDir = 'asc';\n`;
        html += `    }\n`;
        html += `    render${tableName}();\n`;
        html += `  }\n\n`;
        html += `  function goToPage${tableName}(page) {\n`;
        html += `    if (page < 1 || page > Math.ceil(data.length / pageSize)) return;\n`;
        html += `    currentPage = page;\n`;
        html += `    render${tableName}();\n`;
        html += `  }\n\n`;
        if (s.showColumnVisibility) {
            html += `  function toggleCol${tableName}(field, show) {\n`;
            html += `    var cells = document.querySelectorAll('#${tableName.toLowerCase()}List [data-field="' + field + '"]');\n`;
            html += `    cells.forEach(function(el) { el.style.display = show ? '' : 'none'; });\n`;
            html += `  }\n\n`;
            html += `  function toggleColMenu${tableName}() {\n`;
            html += `    var menu = document.getElementById('colMenu${tableName}');\n`;
            html += `    menu.style.display = menu.style.display === 'none' ? '' : 'none';\n`;
            html += `  }\n`;
            html += `  document.addEventListener('click', function(e) {\n`;
            html += `    var menu = document.getElementById('colMenu${tableName}');\n`;
            html += `    if (!e.target.closest('#colMenu${tableName}, [onclick*="toggleColMenu${tableName}"]')) {\n`;
            html += `      menu.style.display = 'none';\n`;
            html += `    }\n`;
            html += `  });\n\n`;
        }

        if (s.editStyle === 'modal') {
            const mid = tableName.toLowerCase() + 'EditModal';
            const mf = tableName.toLowerCase() + 'EditForm';
            html += `  var eid = null;\n\n`;
            html += `  async function edit${tableName}(id) {\n`;
            html += `    eid = id;\n`;
            html += `    try {\n`;
            html += `      var row = await (await fetch(API + '/' + id)).json();\n`;
            for (const f of fields) {
                const q = `'#${mf} [name="${f.name}"]'`;
                const isStatus = this._isStatusField(tableName, f.name);
                const uiType = this._detectUiType(f, tableName);
                if (isStatus && s.statusUiStyle === 'radio') {
                    html += `      document.querySelectorAll(${q}).forEach(function(c) { c.checked = (c.value == row.${f.name}); });\n`;
                } else if (isStatus && s.statusUiStyle === 'toggle') {
                    html += `      var cb = document.querySelector(${q}); if (cb) { cb.checked = (row.${f.name} == cb.value); cb.value = row.${f.name} || '${s.statusInactiveValue}'; }\n`;
                } else if (uiType === 'select') {
                    html += `      var sel = document.querySelector(${q}); if (sel) { sel.value = row.${f.name} ?? ''; }\n`;
                } else if (uiType === 'radio') {
                    html += `      document.querySelectorAll(${q}).forEach(function(c) { c.checked = (c.value == row.${f.name}); });\n`;
                } else if (uiType === 'checkbox' && f.options && f.options.length > 0) {
                    html += `      document.querySelectorAll('#${mid} [data-field="${f.name}"]').forEach(function(c) { c.checked = (String(row.${f.name}).split(',').indexOf(c.value) !== -1); });\n`;
                    html += `      updateE${f.name}();\n`;
                } else if (uiType === 'checkbox') {
                    html += `      var cb = document.querySelector(${q}); if (cb) { cb.checked = (row.${f.name} == 1 || row.${f.name} === true); }\n`;
                } else {
                    html += `      var el = document.querySelector(${q}); if (el) { el.value = row.${f.name} ?? ''; }\n`;
                }
            }
            html += `      document.getElementById('${mid}').style.display = 'flex';\n`;
            html += `    } catch (err) { alert('Error: ' + err.message); }\n`;
            html += `  }\n\n`;
            html += `  function close${tableName}EditModal() { document.getElementById('${mid}').style.display = 'none'; eid = null; }\n\n`;
            html += `  document.getElementById('${mf}').onsubmit = async function(e) {\n`;
            html += `    e.preventDefault();\n`;
            html += `    var d = Object.fromEntries(new FormData(e.target));\n`;
            html += `    /* set unchecked binary checkboxes to '0' */\n`;
            html += `    document.querySelectorAll('#${mf} input[type=checkbox]:not(:checked)').forEach(function(c) { if (!c.name.endsWith('[]')) { d[c.name] = '0'; } });\n`;
            html += `    try {\n`;
            html += `      await fetch(API + '/' + eid, { method: '${s.editMode.toUpperCase()}', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });\n`;
            html += `      close${tableName}EditModal(); load${tableName}();\n`;
            html += `    } catch (err) { alert('Error: ' + err.message); }\n`;
            html += `  };\n\n`;
        }

        html += `  async function ${actionFunc}${tableName}(id) { if (!confirm('${actionLabel} this ${tableName.toLowerCase()}?')) return; await fetch(API + '/' + id, { method: 'DELETE' }); load${tableName}(); }\n\n`;

        if (statField) {
            html += `  async function activate${tableName}(id) { if (!confirm('Activate this ${tableName.toLowerCase()}?')) return; await fetch(API + '/' + id + '/activate', { method: 'PUT' }); load${tableName}(); }\n\n`;
        }

        if (showDelete) {
            html += `  async function hardDelete${tableName}(id) { if (!confirm('Permanently DELETE this ${tableName.toLowerCase()}?')) return; await fetch(API + '/' + id + '/delete', { method: 'POST' }); load${tableName}(); }\n\n`;
        }

        html += `  load${tableName}();\n`;
        html += `</script>`;
        return html;
    }

    generateFormHtml(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '<!-- Table not found -->';
        const fields = this.getNonPKFields(tableName);

        const s = this._getFullSettings(tableName);

        let html = `<h2>Add ${tableName}</h2>\n`;
        html += `<form id="${tableName.toLowerCase()}Form">\n`;
        for (const f of fields) {
            const label = f.name.charAt(0).toUpperCase() + f.name.slice(1);
            const required = f.notNull ? ' required' : '';
            const defVal = f.default !== undefined ? ` value="${f.default}"` : '';
            const isStatus = this._isStatusField(tableName, f.name);
            if (isStatus && s.statusField && s.statusField !== '__none__') {
                const active = s.statusActiveValue;
                const inactive = s.statusInactiveValue;
                if (s.statusUiStyle === 'radio') {
                    html += `  <div><label>${label}</label><br>\n`;
                    html += `    <label><input type="radio" name="${f.name}" value="${active}" checked /> ${active.charAt(0).toUpperCase() + active.slice(1)}</label>\n`;
                    html += `    <label><input type="radio" name="${f.name}" value="${inactive}" /> ${inactive.charAt(0).toUpperCase() + inactive.slice(1)}</label>\n`;
                    html += `  </div>\n`;
                } else if (s.statusUiStyle === 'dropdown') {
                    html += `  <select name="${f.name}"${required}>\n`;
                    html += `    <option value="${active}" selected>${active.charAt(0).toUpperCase() + active.slice(1)}</option>\n`;
                    html += `    <option value="${inactive}">${inactive.charAt(0).toUpperCase() + inactive.slice(1)}</option>\n`;
                    html += `  </select><br>\n`;
                } else if (s.statusUiStyle === 'toggle') {
                    html += `  <div><label>${label}</label><br>\n`;
                    html += `    <label>\n`;
                    html += `      <input type="checkbox" name="${f.name}" value="${active}" onchange="this.value=this.checked?'${active}':'${inactive}'" checked>\n`;
                    html += `      <span></span>\n`;
                    html += `    </label>\n`;
                    html += `    <span id="${f.name}Label">${active.charAt(0).toUpperCase() + active.slice(1)}</span>\n`;
                    html += `    <script>document.querySelector('[name="${f.name}"]').addEventListener('change',function(){document.getElementById('${f.name}Label').textContent=this.checked?'${active.charAt(0).toUpperCase() + active.slice(1)}':'${inactive.charAt(0).toUpperCase() + inactive.slice(1)}';})<\/script>\n`;
                    html += `  </div>\n`;
                } else {
                    html += `  <input name="${f.name}" value="${active}"${required}><br>\n`;
                }
            } else {
                const uiType = this._detectUiType(f, tableName);
                if (uiType === 'fk-select') {
                    html += `  <select name="${f.name}" id="${tableName.toLowerCase()}_${f.name}"${required}>\n`;
                    html += `    <option value="">Select ${f.fk.table}</option>\n`;
                    html += `  </select><br>\n`;
                } else if (uiType === 'select') {
                    html += `  <select name="${f.name}"${required}>\n`;
                    html += `    <option value="">Select ${label}</option>\n`;
                    if (f.options) {
                        for (const o of f.options) {
                            html += `    <option value="${o.value}">${o.label}</option>\n`;
                        }
                    }
                    html += `  </select><br>\n`;
                } else if (uiType === 'radio') {
                    html += `  <div><label>${label}</label><br>\n`;
                    if (f.options) {
                        for (let i = 0; i < f.options.length; i++) {
                            const o = f.options[i];
                            html += `    <label><input type="radio" name="${f.name}" value="${o.value}"${i === 0 ? ' checked' : ''}> ${o.label}</label>\n`;
                        }
                    }
                    html += `  </div>\n`;
                } else if (uiType === 'checkbox') {
                    if (f.options && f.options.length > 0) {
                        html += `  <div><label>${label}</label><br>\n`;
                        html += `    <input type="hidden" name="${f.name}" id="${f.name}Val">\n`;
                        for (const o of f.options) {
                            html += `    <label><input type="checkbox" data-field="${f.name}" value="${o.value}" onchange="update${f.name}()"> ${o.label}</label><br>\n`;
                        }
                        html += `    <script>function update${f.name}(){var a=[];document.querySelectorAll('[data-field="${f.name}"]:checked').forEach(function(c){a.push(c.value)});document.getElementById('${f.name}Val').value=a.join(',')}<\/script>\n`;
                        html += `  </div>\n`;
                    } else {
                        html += `  <label><input type="checkbox" name="${f.name}" value="1"> ${label}</label><br>\n`;
                    }
                } else if (uiType === 'textarea') {
                    html += `  <textarea name="${f.name}" placeholder="${label}"${required}>${f.default || ''}</textarea><br>\n`;
                } else if (uiType === 'date') {
                    html += `  <input name="${f.name}" type="date"${required}${defVal}><br>\n`;
                } else if (uiType === 'time') {
                    html += `  <input name="${f.name}" type="time"${required}${defVal}><br>\n`;
                } else if (uiType === 'email') {
                    html += `  <input name="${f.name}" type="email" placeholder="${label}"${required}${defVal}><br>\n`;
                } else if (uiType === 'password') {
                    html += `  <input name="${f.name}" type="password" placeholder="${label}"${required}${defVal}><br>\n`;
                } else if (uiType === 'url') {
                    html += `  <input name="${f.name}" type="url" placeholder="${label}"${required}${defVal}><br>\n`;
                } else if (uiType === 'tel') {
                    html += `  <input name="${f.name}" type="tel" placeholder="${label}"${required}${defVal}><br>\n`;
                } else if (uiType === 'color') {
                    html += `  <input name="${f.name}" type="color"${required}${defVal}><br>\n`;
                } else if (uiType === 'hidden') {
                    html += `  <input name="${f.name}" type="hidden">\n`;
                } else if (uiType === 'number') {
                    html += `  <input name="${f.name}" type="number"${f.type === 'REAL' ? ' step="any"' : ''} placeholder="${label}"${required}${defVal}><br>\n`;
                } else {
                    html += `  <input name="${f.name}" type="text" placeholder="${label}"${required}${defVal}><br>\n`;
                }
            }
        }
        html += `  <button type="submit">Add</button>\n`;
        html += `</form>\n`;

        // Inline FK fetch for form selects
        for (const f of fields) {
            if (!f.fk) continue;
            html += `<script>\n`;
            html += `(async function load${f.fk.table}() {\n`;
            html += `  try {\n`;
            html += `    const res = await fetch('/api/${f.fk.table.toLowerCase()}');\n`;
            html += `    const data = await res.json();\n`;
            html += `    const sel = document.getElementById('${tableName.toLowerCase()}_${f.name}');\n`;
            html += `    if (!sel) return;\n`;
            html += `    data.forEach(function(item) {\n`;
            html += `      const opt = document.createElement('option');\n`;
            html += `      opt.value = item.${this.getPK(f.fk.table)};\n`;
            html += `      opt.textContent = Object.values(item).filter(v => v != null).join(' - ');\n`;
            html += `      sel.appendChild(opt);\n`;
            html += `    });\n`;
            html += `  } catch(e) { console.error('Failed to load ${f.fk.table}', e); }\n`;
            html += `})();\n`;
            html += `<\/script>\n`;
        }
        return html;
    }

    generateFormJs(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '// Table not found';
        const pk = this.getPK(tableName);
        const fields = this.getNonPKFields(tableName);
        const api = `/api/${tableName.toLowerCase()}`;
        const editMode = this._getEditMode(tableName);
        const s = this._getFullSettings(tableName);
        const isModalEdit = s.editStyle === 'modal';
        const fn = tableName.toLowerCase() + 'Form';
        const lf = 'load' + tableName;

        let js = `var eid = null;\n\n`;
        js += `document.getElementById('${fn}').onsubmit = async function(e) {\n`;
        js += `  e.preventDefault();\n`;
        js += `  var d = Object.fromEntries(new FormData(e.target));\n`;
        js += `  e.target.querySelectorAll('input[type=checkbox]:not(:checked)').forEach(function(c) { if (c.name) { d[c.name] = '0'; } });\n`;
        if (isModalEdit) {
            js += `  await fetch('${api}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });\n`;
        } else {
            js += `  var url = eid ? '${api}/' + eid : '${api}';\n`;
            js += `  var method = eid ? '${editMode.toUpperCase()}' : 'POST';\n`;
            js += `  await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });\n`;
            js += `  eid = null;\n`;
        }
        js += `  e.target.reset();\n`;
        js += `  if (typeof ${lf} === 'function') ${lf}();\n`;
        js += `};\n\n`;

        if (isModalEdit) {
            js += `async function edit${tableName}(id) { if (typeof open${tableName}EditModal === 'function') open${tableName}EditModal(id); }\n`;
        } else {
            js += `async function edit${tableName}(id) {\n`;
            js += `  try {\n`;
            js += `    var row = await (await fetch(API + '/' + id)).json();\n`;
            for (const f of fields) {
                const q = `'[name="${f.name}"]'`;
                const isStatus = this._isStatusField(tableName, f.name);
                const uiType = this._detectUiType(f, tableName);
                if (isStatus && s.statusUiStyle === 'radio') {
                    js += `    document.querySelectorAll(${q}).forEach(function(c) { c.checked = (c.value == row.${f.name}); });\n`;
                } else if (isStatus && s.statusUiStyle === 'toggle') {
                    js += `    var cb = document.querySelector(${q}); if (cb) { cb.checked = (row.${f.name} == cb.value); cb.value = row.${f.name} || '${s.statusInactiveValue}'; }\n`;
                } else if (uiType === 'select') {
                    js += `    var sel = document.querySelector(${q}); if (sel) { sel.value = row.${f.name} ?? ''; }\n`;
                } else if (uiType === 'radio') {
                    js += `    document.querySelectorAll(${q}).forEach(function(c) { c.checked = (c.value == row.${f.name}); });\n`;
                } else if (uiType === 'checkbox' && f.options && f.options.length > 0) {
                    js += `    document.querySelectorAll('[data-field="${f.name}"]').forEach(function(c) { c.checked = (String(row.${f.name}).split(',').indexOf(c.value) !== -1); });\n`;
                    js += `    var hv = document.getElementById('${f.name}Val'); if (hv) { hv.value = row.${f.name} ?? ''; }\n`;
                } else if (uiType === 'checkbox') {
                    js += `    var cb = document.querySelector(${q}); if (cb) { cb.checked = (row.${f.name} == 1 || row.${f.name} === true); }\n`;
                } else {
                    js += `    var el = document.querySelector(${q}); if (el) { el.value = row.${f.name} ?? ''; }\n`;
                }
            }
            js += `    eid = id;\n`;
            js += `  } catch (err) { alert('Error: ' + err.message); }\n`;
            js += `}\n`;
        }
        return js;
    }

    generateListJs(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '// Table not found';
        const pk = this.getPK(tableName);
        const fields = this.getNonPKFields(tableName);
        const api = `/api/${tableName.toLowerCase()}`;
        const statField = this.getStatField(tableName);
        const s = this._getFullSettings(tableName);
        const actionLabel = statField ? 'Deactivate' : 'Delete';
        const actionFunc = statField ? 'deactivate' : 'delete';
        const activeVal = statField ? s.statusActiveValue : '';
        const inactiveVal = statField ? s.statusInactiveValue : '';
        const showDelete = statField && s.showDeleteButton;

        const headerCells = fields.map(f => `<th onclick="sort${tableName}('${f.name}')" data-field="${f.name}">${f.name.charAt(0).toUpperCase() + f.name.slice(1)}</th>`).join('\n      ');
        const cellRenderers = fields.map(f => {
            if (f.options && f.options.length > 0) {
                const optMap = JSON.stringify(Object.fromEntries(f.options.map(o => [o.value, o.label])));
                return `<td data-field="${f.name}">\${(${optMap})[item.${f.name}] || item.${f.name}}</td>`;
            }
            return `<td data-field="${f.name}">\${item.${f.name}}</td>`;
        }).join('\n        ');

        const lid = tableName.toLowerCase() + 'List';
        const pid = 'pagination' + tableName;

        let js = `const API = '${api}';\n`;
        js += `var data = [];\n`;
        js += `var currentPage = 1;\n`;
        js += `var searchQuery = '';\n`;
        js += `var sortField = '${s.sortField}';\n`;
        js += `var sortDir = '${s.sortDir || 'asc'}';\n`;
        js += `var pageSize = ${s.pageSize || 10};\n\n`;
        js += `/* Required HTML:\n`;
        js += `   <input type="search" id="search${tableName}" placeholder="Search ${tableName}..." oninput="search${tableName}(this.value)">\n`;
        js += `   <div id="${lid}">Loading...</div>\n`;
        js += `   <div id="${pid}" style="display:flex;align-items:center;justify-content:center;gap:4px;"></div>\n`;
        js += `*/\n\n`;
        js += `async function load${tableName}() {\n`;
        js += `  var response = await fetch(API);\n`;
        js += `  data = await response.json();\n`;
        js += `  currentPage = 1;\n`;
        js += `  searchQuery = '';\n`;
        js += `  var searchEl = document.getElementById('search${tableName}');\n`;
        js += `  if (searchEl) {\n`;
        js += `    searchEl.value = '';\n`;
        js += `  }\n`;
        js += `  render${tableName}();\n`;
        js += `}\n\n`;
        js += `function render${tableName}() {\n`;
        js += `  var items = data.slice();\n\n`;
        js += `  // Search filter\n`;
        js += `  if (searchQuery) {\n`;
        js += `    var q = searchQuery.toLowerCase();\n`;
        js += `    items = items.filter(function(item) {\n`;
        js += `      return Object.values(item).some(function(value) {\n`;
        js += `        return String(value).toLowerCase().includes(q);\n`;
        js += `      });\n`;
        js += `    });\n`;
        js += `  }\n\n`;
        js += `  // Sort\n`;
        js += `  if (sortField) {\n`;
        js += `    items.sort(function(a, b) {\n`;
        js += `      var va = a[sortField];\n`;
        js += `      var vb = b[sortField];\n`;
        js += `      if (va == null) va = '';\n`;
        js += `      if (vb == null) vb = '';\n`;
        js += `      if (typeof va === 'number') {\n`;
        js += `        return sortDir === 'asc' ? va - vb : vb - va;\n`;
        js += `      }\n`;
        js += `      var result = String(va).toLowerCase().localeCompare(String(vb).toLowerCase());\n`;
        js += `      return sortDir === 'asc' ? result : -result;\n`;
        js += `    });\n`;
        js += `  }\n\n`;
        js += `  var total = items.length;\n`;
        js += `  var totalPages = Math.ceil(total / pageSize) || 1;\n`;
        js += `  if (currentPage > totalPages) {\n`;
        js += `    currentPage = totalPages;\n`;
        js += `  }\n\n`;
        js += `  var list = document.getElementById('${lid}');\n\n`;
        js += `  // Empty state\n`;
        js += `  if (total === 0) {\n`;
        js += `    list.innerHTML = '<p>No ${tableName.toLowerCase()} yet.</p>';\n`;
        js += `    document.getElementById('${pid}').innerHTML = '';\n`;
        js += `    return;\n`;
        js += `  }\n\n`;
        js += `  var pageItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);\n\n`;
        js += `  // Render table\n`;
        js += `  list.innerHTML = \`<table>\n`;
        js += `    <tr>\n`;
        js += `      ${headerCells}\n`;
        js += `      <th data-field="__actions__">Actions</th>\n`;
        js += `    </tr>\n`;
        js += `    \${pageItems.map(function(item) {\n`;
        js += `      return \`<tr>\n`;
        js += `        ${cellRenderers}`;
        if (statField) {
            let actionsJs = `\n        <td data-field="__actions__"><button onclick="edit${tableName}(\${item.${pk}})">Edit</button> \${item.${statField.name} === '${inactiveVal}' ? \`<button onclick="activate${tableName}(\${item.${pk}})">Activate</button>\` : \`<button onclick="deactivate${tableName}(\${item.${pk}})">Deactivate</button>\`}`;
            if (showDelete) {
                actionsJs += ` <button onclick="hardDelete${tableName}(\${item.${pk}})">Delete</button>`;
            }
            actionsJs += `</td>\n      `;
            js += actionsJs;
        } else {
            js += `\n        <td data-field="__actions__"><button onclick="edit${tableName}(\${item.${pk}})">Edit</button> <button onclick="${actionFunc}${tableName}(\${item.${pk}})">${actionLabel}</button></td>\n      `;
        }
        js += `\`;\n`;
        js += `    }).join('')}\n`;
        js += `  </table>\`;\n\n`;
        js += `  // Pagination controls\n`;
        js += `  var p = '';\n`;
        js += `  p += '<button onclick="goToPage${tableName}(1)">&laquo;</button>';\n`;
        js += `  p += '<button onclick="goToPage${tableName}(' + (currentPage - 1) + ')"';\n`;
        js += `  if (currentPage <= 1) p += ' disabled';\n`;
        js += `  p += '>&lsaquo;</button>';\n`;
        js += `  p += '<span>Page ' + currentPage + ' of ' + totalPages + ' (' + total + ')</span>';\n`;
        js += `  p += '<button onclick="goToPage${tableName}(' + (currentPage + 1) + ')"';\n`;
        js += `  if (currentPage >= totalPages) p += ' disabled';\n`;
        js += `  p += '>&rsaquo;</button>';\n`;
        js += `  p += '<button onclick="goToPage${tableName}(' + totalPages + ')">&raquo;</button>';\n`;
        js += `  document.getElementById('${pid}').innerHTML = p;\n`;
        js += `}\n\n`;
        js += `function search${tableName}(query) {\n`;
        js += `  searchQuery = query;\n`;
        js += `  currentPage = 1;\n`;
        js += `  render${tableName}();\n`;
        js += `}\n\n`;
        js += `function sort${tableName}(field) {\n`;
        js += `  if (sortField === field) {\n`;
        js += `    sortDir = sortDir === 'asc' ? 'desc' : 'asc';\n`;
        js += `  } else {\n`;
        js += `    sortField = field;\n`;
        js += `    sortDir = 'asc';\n`;
        js += `  }\n`;
        js += `  render${tableName}();\n`;
        js += `}\n\n`;
        js += `function goToPage${tableName}(page) {\n`;
        js += `  if (page < 1 || page > Math.ceil(data.length / pageSize)) return;\n`;
        js += `  currentPage = page;\n`;
        js += `  render${tableName}();\n`;
        js += `}\n\n`;
        if (s.showColumnVisibility) {
            js += `function toggleCol${tableName}(field, show) {\n`;
            js += `  var cells = document.querySelectorAll('#${lid} [data-field="' + field + '"]');\n`;
            js += `  cells.forEach(function(el) {\n`;
            js += `    el.style.display = show ? '' : 'none';\n`;
            js += `  });\n`;
            js += `}\n\n`;
        }
        js += `async function ${actionFunc}${tableName}(id) { if (!confirm('${actionLabel} this ${tableName.toLowerCase()}?')) return; await fetch(API + '/' + id, { method: 'DELETE' }); load${tableName}(); }\n\n`;
        if (statField) {
            js += `async function activate${tableName}(id) { if (!confirm('Activate this ${tableName.toLowerCase()}?')) return; await fetch(API + '/' + id + '/activate', { method: 'PUT' }); load${tableName}(); }\n\n`;
        }
        if (showDelete) {
            js += `async function hardDelete${tableName}(id) { if (!confirm('Permanently DELETE this ${tableName.toLowerCase()}?')) return; await fetch(API + '/' + id + '/delete', { method: 'POST' }); load${tableName}(); }\n\n`;
        }
        js += `load${tableName}();\n`;
        return js;
    }

    generatePageHtml(tableName) {
        return this.generateFormHtml(tableName) + '\n' + this.generateListHtml(tableName);
    }

    generatePageJs(tableName) {
        return this.generateFormJs(tableName) + '\n' + `// Initial load\nload${tableName}();\n`;
    }

    generateCrud(tableName) {
        return this.generatePrepStatements(tableName) + '\n\n' + this.generateCrudRoutes(tableName);
    }

    generateCreateTable(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '// Table not found';
        const fields = table.fields;

        const fieldLines = fields.map(f => {
            let line = `    ${f.name} ${f.type}`;
            if (f.pk) {
                line += ' PRIMARY KEY';
                if (f.type === 'INTEGER' && f.autoIncrement) {
                    line += ' AUTOINCREMENT';
                }
            }
            if (f.notNull) line += ' NOT NULL';
            if (f.default !== undefined) {
                let defVal = String(f.default).replace(/;+$/, '').replace(/^['"]|['"]$/g, '');
                if (f.type !== 'INTEGER' && f.type !== 'REAL') {
                    defVal = `'${defVal}'`;
                }
                line += ` DEFAULT ${defVal}`;
            }
            if (f.fk) {
                line += ` REFERENCES ${f.fk.table}(${f.fk.field})`;
            }
            return line;
        });

        const sql = [
            `db.exec(\``,
            `  CREATE TABLE IF NOT EXISTS ${tableName} (`,
            fieldLines.join(',\n'),
            `  )`,
            `\`);`,
            `console.log('Table ${tableName} is ready.');`
        ].join('\n');

        return sql;
    }

    // --- Query Builder delegation to QueryGenerator ---
    generateQuerySql(columns, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        return this.queryGen.generateQuerySql(columns, filters, sortBy, limit, groupBy, having, distinct, joinType);
    }
    generateQueryFetchJs(queryName, columns) {
        return this.queryGen.generateQueryFetchJs(queryName, columns);
    }
    generateQueryServer(queryName, columns, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        return this.queryGen.generateQueryServer(queryName, columns, filters, sortBy, limit, groupBy, having, distinct, joinType);
    }
    generateQueryCardHtml(queryName, columns) {
        return this.queryGen.generateQueryCardHtml(queryName, columns);
    }
    generateQueryTableHtml(queryName, columns) {
        return this.queryGen.generateQueryTableHtml(queryName, columns);
    }

    generate(snippetType, tableNameOrQuery) {
        // Support query snippet types: 'query-sql', 'query-js', 'query-server', etc.
        if (snippetType.startsWith('query-')) {
            const parts = snippetType.split('-');
            const type = parts.slice(1).join('-');
            const queryName = tableNameOrQuery;
            const query = this.schemaRegistry.getQuery(queryName);
            if (!query) return '// Query "' + queryName + '" not found';
            const cols = query.columns;
            switch (type) {
                case 'sql': return this.queryGen.generateQuerySql(cols, query.filters, query.sortBy, query.limit, query.groupBy, query.having, query.distinct, query.joinType);
                case 'js': return this.queryGen.generateQueryFetchJs(queryName, cols);
                case 'server': return this.queryGen.generateQueryServer(queryName, cols, query.filters, query.sortBy, query.limit, query.groupBy, query.having, query.distinct, query.joinType);
                case 'card': return this.queryGen.generateQueryCardHtml(queryName, cols);
                case 'table': return this.queryGen.generateQueryTableHtml(queryName, cols);
                default: return '// Unknown query type: ' + type;
            }
        }
        switch (snippetType) {
            case 'crud': return this.generateCrud(tableNameOrQuery);
            case 'list': return this.generateListHtml(tableNameOrQuery);
            case 'list-js': return this.generateListJs(tableNameOrQuery);
            case 'form': return this.generateFormHtml(tableNameOrQuery);
            case 'form-js': return this.generateFormJs(tableNameOrQuery);
            case 'page': return this.generatePageHtml(tableNameOrQuery);
            case 'page-js': return this.generatePageJs(tableNameOrQuery);
            default: return '// Unknown snippet type: ' + snippetType;
        }
    }
}

module.exports = { CodeGenerator };

