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
            sortDir: raw.sortDir || 'asc'
        };
    }

    _detectUiType(field, tableName) {
        if (field.uiType) return field.uiType;
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
        routes += `    const rows = ${varPrefix}GetAll.all();\n`;
        routes += `    res.json(rows);\n`;
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

        const headerCells = fields.map(f => `<th onclick="sort${tableName}('${f.name}')" data-field="${f.name}" style="cursor:pointer;user-select:none;">${f.name.charAt(0).toUpperCase() + f.name.slice(1)} <span id="sort${tableName}${f.name}" style="font-size:11px;color:#888;"></span></th>`).join('');
        const cellRenderers = fields.map(f => {
            if (statField && f.name === statField.name) {
                return `<td data-field="${f.name}">\${i.${f.name} === '${activeVal}' ? '<span class="status-badge status-active">${activeVal.charAt(0).toUpperCase() + activeVal.slice(1)}</span>' : (i.${f.name} === '${inactiveVal}' ? '<span class="status-badge status-inactive">${inactiveVal.charAt(0).toUpperCase() + inactiveVal.slice(1)}</span>' : i.${f.name})}</td>`;
            }
            return `<td data-field="${f.name}">\${i.${f.name}}</td>`;
        }).join('');

        let html = `<h2>${tableName}</h2>\n`;
        html += `<style>.status-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}.status-active{background:#1b5e20;color:#a5d6a7}.status-inactive{background:#b71c1c;color:#ef9a9a}.pg-btn{padding:4px 10px;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;cursor:pointer;}.pg-btn[disabled]{opacity:0.5;cursor:default;}.pg-info{padding:4px 10px;color:#ccc;}<\/style>\n`;
        html += `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">\n`;
        html += `  <input type="search" id="search${tableName}" placeholder="Search ${tableName}..." oninput="search${tableName}(this.value)" style="flex:1;padding:6px 10px;font-size:14px;border:1px solid #555;border-radius:4px;background:#1e1e1e;color:#ddd;">\n`;
        html += `  <div style="position:relative;">\n`;
        html += `    <button onclick="toggleColMenu${tableName}()" style="padding:6px 12px;background:#333;color:#ddd;border:1px solid #555;border-radius:4px;cursor:pointer;">Columns</button>\n`;
        html += `    <div id="colMenu${tableName}" style="display:none;position:absolute;right:0;top:100%;background:#2d2d2d;border:1px solid #555;border-radius:4px;padding:8px;z-index:10;min-width:180px;max-height:300px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.4);">\n`;
        for (const f of fields) {
            html += `      <label style="display:block;padding:4px 8px;color:#ccc;font-size:13px;white-space:nowrap;cursor:pointer;"><input type="checkbox" data-field="${f.name}" checked onchange="toggleCol${tableName}('${f.name}', this.checked)" style="margin-right:6px;"> ${f.name.charAt(0).toUpperCase() + f.name.slice(1)}</label>\n`;
        }
        html += `      <label style="display:block;padding:4px 8px;color:#ccc;font-size:13px;white-space:nowrap;cursor:pointer;"><input type="checkbox" data-field="__actions__" checked onchange="toggleCol${tableName}('__actions__', this.checked)" style="margin-right:6px;"> Actions</label>\n`;
        html += `    </div>\n`;
        html += `  </div>\n`;
        html += `</div>\n`;
        html += `<div id="${tableName.toLowerCase()}List">Loading...</div>\n`;
        html += `<div id="pagination${tableName}" style="display:flex;gap:4px;align-items:center;justify-content:center;margin-top:8px;"></div>\n\n`;

        // Modal edit overlay
        if (s.editStyle === 'modal') {
            html += `<div id="${tableName.toLowerCase()}EditModal" class="modal-overlay" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">\n`;
            html += `  <div class="modal-content" style="background:#fff;max-width:500px;margin:auto;padding:24px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">\n`;
            html += `    <h3 style="margin:0 0 16px;">Edit ${tableName}</h3>\n`;
            html += `    <form id="${tableName.toLowerCase()}EditForm">\n`;
            for (const f of fields) {
                const label = f.name.charAt(0).toUpperCase() + f.name.slice(1);
                const required = f.notNull ? ' required' : '';
                const isStatus = this._isStatusField(tableName, f.name);
                if (isStatus && s.statusField && s.statusField !== '__none__') {
                    const active = s.statusActiveValue;
                    const inactive = s.statusInactiveValue;
                    if (s.statusUiStyle === 'radio') {
                        html += `      <div style="margin-bottom:8px;"><label>${label}</label><br>\n`;
                        html += `        <label style="margin-right:12px;"><input type="radio" name="${f.name}" value="${active}" /> ${active.charAt(0).toUpperCase() + active.slice(1)}</label>\n`;
                        html += `        <label><input type="radio" name="${f.name}" value="${inactive}" /> ${inactive.charAt(0).toUpperCase() + inactive.slice(1)}</label>\n`;
                        html += `      </div>\n`;
                    } else if (s.statusUiStyle === 'dropdown') {
                        html += `      <select name="${f.name}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;">\n`;
                        html += `        <option value="${active}">${active.charAt(0).toUpperCase() + active.slice(1)}</option>\n`;
                        html += `        <option value="${inactive}">${inactive.charAt(0).toUpperCase() + inactive.slice(1)}</option>\n`;
                        html += `      </select><br>\n`;
                    } else if (s.statusUiStyle === 'toggle') {
                        html += `      <div style="margin-bottom:8px;"><label>${label}</label><br>\n`;
                        html += `        <label class="switch" style="position:relative;display:inline-block;width:44px;height:24px;">\n`;
                        html += `          <input type="checkbox" name="${f.name}" value="${active}" onchange="this.value=this.checked?'${active}':'${inactive}'">\n`;
                        html += `          <span class="slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#555;border-radius:24px;transition:.3s;"></span>\n`;
                        html += `        </label>\n`;
                        html += `        <span id="m${f.name}Label" style="margin-left:8px;font-size:13px;">${active.charAt(0).toUpperCase() + active.slice(1)}</span>\n`;
                        html += `        <script>document.querySelector('#${tableName.toLowerCase()}EditForm [name="${f.name}"]').addEventListener('change',function(){document.getElementById('m${f.name}Label').textContent=this.checked?'${active.charAt(0).toUpperCase() + active.slice(1)}':'${inactive.charAt(0).toUpperCase() + inactive.slice(1)}';})<\/script>\n`;
                        html += `      </div>\n`;
                    } else {
                        html += `      <input name="${f.name}" style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"${required}><br>\n`;
                    }
                } else {
                    const uiType = this._detectUiType(f, tableName);
                    if (uiType === 'fk-select') {
                        html += `      <select name="${f.name}" id="${tableName.toLowerCase()}_${f.name}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;">\n`;
                        html += `        <option value="">Select ${f.fk.table}</option>\n`;
                        html += `      </select><br>\n`;
                    } else if (uiType === 'checkbox') {
                        html += `      <label style="display:block;margin-bottom:8px;"><input type="checkbox" name="${f.name}" value="1"${required}> ${label}</label>\n`;
                    } else if (uiType === 'textarea') {
                        html += `      <textarea name="${f.name}" placeholder="${label}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;min-height:60px;"></textarea><br>\n`;
                    } else if (uiType === 'date') {
                        html += `      <input name="${f.name}" type="date"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"><br>\n`;
                    } else if (uiType === 'time') {
                        html += `      <input name="${f.name}" type="time"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"><br>\n`;
                    } else if (uiType === 'email') {
                        html += `      <input name="${f.name}" type="email" placeholder="${label}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"><br>\n`;
                    } else if (uiType === 'password') {
                        html += `      <input name="${f.name}" type="password" placeholder="${label}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"><br>\n`;
                    } else if (uiType === 'url') {
                        html += `      <input name="${f.name}" type="url" placeholder="${label}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"><br>\n`;
                    } else if (uiType === 'tel') {
                        html += `      <input name="${f.name}" type="tel" placeholder="${label}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"><br>\n`;
                    } else if (uiType === 'color') {
                        html += `      <input name="${f.name}" type="color"${required} style="width:100%;margin-bottom:8px;padding:2px 6px;font-size:14px;height:36px;"><br>\n`;
                    } else if (uiType === 'hidden') {
                        html += `      <input name="${f.name}" type="hidden">\n`;
                    } else if (uiType === 'number') {
                        html += `      <input name="${f.name}" type="number"${f.type === 'REAL' ? ' step="any"' : ''} placeholder="${label}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"><br>\n`;
                    } else {
                        html += `      <input name="${f.name}" type="text" placeholder="${label}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"><br>\n`;
                    }
                }
            }
            html += `      <div style="display:flex;gap:8px;margin-top:12px;">\n`;
            html += `        <button type="submit" style="padding:8px 16px;background:#0078d4;color:#fff;border:none;border-radius:4px;cursor:pointer;">Save Changes</button>\n`;
            html += `        <button type="button" onclick="close${tableName}EditModal()" style="padding:8px 16px;background:#6c757d;color:#fff;border:none;border-radius:4px;cursor:pointer;">Cancel</button>\n`;
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
        html += `  let _allItems = [];\n`;
        html += `  let _currentPage = 1;\n`;
        html += `  let _searchTerm = '';\n`;
        html += `  let _sortField = '${s.sortField}';\n`;
        html += `  let _sortDir = '${s.sortDir || 'asc'}';\n`;
        html += `  const _pageSize = ${s.pageSize || 10};\n\n`;
        html += `  async function load${tableName}() {\n`;
        html += `    const res = await fetch(API);\n`;
        html += `    _allItems = await res.json();\n`;
        html += `    _currentPage = 1;\n`;
        html += `    _searchTerm = '';\n`;
        html += `    const searchEl = document.getElementById('search${tableName}');\n`;
        html += `    if (searchEl) searchEl.value = '';\n`;
        html += `    render${tableName}();\n`;
        html += `  }\n\n`;
        html += `  function render${tableName}() {\n`;
        html += `    let items = _allItems;\n`;
        html += `    if (_searchTerm) {\n`;
        html += `      const term = _searchTerm.toLowerCase();\n`;
        html += `      items = items.filter(function(i) { return Object.values(i).some(function(v) { return String(v).toLowerCase().includes(term); }); });\n`;
        html += `    }\n`;
        html += `    if (_sortField) {\n`;
        html += `      items.sort(function(a, b) {\n`;
        html += `        let va = a[_sortField], vb = b[_sortField];\n`;
        html += `        if (va == null) va = ''; if (vb == null) vb = '';\n`;
        html += `        if (typeof va === 'number') return _sortDir === 'asc' ? va - vb : vb - va;\n`;
        html += `        va = String(va).toLowerCase(); vb = String(vb).toLowerCase();\n`;
        html += `        return _sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);\n`;
        html += `      });\n`;
        html += `    }\n`;
        html += `    const total = items.length;\n`;
        html += `    const totalPages = Math.ceil(total / _pageSize) || 1;\n`;
        html += `    if (_currentPage > totalPages) _currentPage = totalPages;\n`;
        html += `    const start = (_currentPage - 1) * _pageSize;\n`;
        html += `    const page = items.slice(start, start + _pageSize);\n`;
        html += `    const list = document.getElementById('${tableName.toLowerCase()}List');\n`;
        html += `    if (!total) {\n`;
        html += `      list.innerHTML = '<p>No ${tableName.toLowerCase()} yet.</p>';\n`;
        html += `      document.getElementById('pagination${tableName}').innerHTML = '';\n`;
        html += `      return;\n`;
        html += `    }\n`;
        html += `    list.innerHTML = \`<table><tr>${headerCells}<th data-field="__actions__">Actions</th></tr>\n`;
        html += `      \${page.map(i => \`<tr>${cellRenderers}`;
        if (showDelete) {
            html += `<td data-field="__actions__"><button onclick="edit${tableName}(\${i.${pk}})" class="edit-btn">Edit</button> <button onclick="deactivate${tableName}(\${i.${pk}})" class="del-btn">Deactivate</button> <button onclick="hardDelete${tableName}(\${i.${pk}})" class="del-btn" style="background:#b71c1c;">Delete</button></td>\``;
        } else {
            html += `<td data-field="__actions__"><button onclick="edit${tableName}(\${i.${pk}})" class="edit-btn">Edit</button> <button onclick="${actionFunc}${tableName}(\${i.${pk}})" class="del-btn">${actionLabel}</button></td>\``;
        }
        html += `).join('')}</table>\`;\n`;
        html += `    var pgHtml = '';\n`;
        html += `    pgHtml += '<button onclick="goToPage${tableName}(1)" class="pg-btn">&laquo;</button>';\n`;
        html += `    pgHtml += '<button onclick="goToPage${tableName}(' + (_currentPage - 1) + ')" class="pg-btn"' + (_currentPage <= 1 ? ' disabled' : '') + '>&lsaquo;</button>';\n`;
        html += `    pgHtml += '<span class="pg-info">Page ' + _currentPage + ' of ' + totalPages + ' (' + total + ' total)</span>';\n`;
        html += `    pgHtml += '<button onclick="goToPage${tableName}(' + (_currentPage + 1) + ')" class="pg-btn"' + (_currentPage >= totalPages ? ' disabled' : '') + '>&rsaquo;</button>';\n`;
        html += `    pgHtml += '<button onclick="goToPage${tableName}(' + totalPages + ')" class="pg-btn">&raquo;</button>';\n`;
        html += `    document.getElementById('pagination${tableName}').innerHTML = pgHtml;\n`;
        html += `  }\n\n`;
        html += `  function search${tableName}(term) {\n`;
        html += `    _searchTerm = term;\n`;
        html += `    _currentPage = 1;\n`;
        html += `    render${tableName}();\n`;
        html += `  }\n\n`;
        html += `  function sort${tableName}(field) {\n`;
        html += `    if (_sortField === field) {\n`;
        html += `      _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';\n`;
        html += `    } else {\n`;
        html += `      _sortField = field;\n`;
        html += `      _sortDir = 'asc';\n`;
        html += `    }\n`;
        html += `    render${tableName}();\n`;
        html += `  }\n\n`;
        html += `  function goToPage${tableName}(page) {\n`;
        html += `    if (page < 1 || page > Math.ceil(_allItems.length / _pageSize)) return;\n`;
        html += `    _currentPage = page;\n`;
        html += `    render${tableName}();\n`;
        html += `  }\n\n`;
        html += `  function toggleCol${tableName}(field, visible) {\n`;
        html += `    document.querySelectorAll('#${tableName.toLowerCase()}List [data-field="' + field + '"]').forEach(function(el) {\n`;
        html += `      el.style.display = visible ? '' : 'none';\n`;
        html += `    });\n`;
        html += `  }\n\n`;
        html += `  let colMenuVisible${tableName} = false;\n`;
        html += `  function toggleColMenu${tableName}() {\n`;
        html += `    colMenuVisible${tableName} = !colMenuVisible${tableName};\n`;
        html += `    document.getElementById('colMenu${tableName}').style.display = colMenuVisible${tableName} ? 'block' : 'none';\n`;
        html += `  }\n`;
        html += `  document.addEventListener('click', function(e) {\n`;
        html += `    if (!e.target.closest('#colMenu${tableName}, [onclick*="toggleColMenu${tableName}"]')) {\n`;
        html += `      document.getElementById('colMenu${tableName}').style.display = 'none';\n`;
        html += `      colMenuVisible${tableName} = false;\n`;
        html += `    }\n`;
        html += `  });\n\n`;

        if (s.editStyle === 'modal') {
            html += `  let edit${tableName}Id = null;\n\n`;
            html += `  async function edit${tableName}(id) {\n`;
            html += `    edit${tableName}Id = id;\n`;
            html += `    try {\n`;
            html += `      const res = await fetch(\`\${API}/\${id}\`);\n`;
            html += `      if (!res.ok) throw new Error('Fetch failed');\n`;
            html += `      const row = await res.json();\n`;
            for (const f of fields) {
                const isStatus = this._isStatusField(tableName, f.name);
                const uiType = this._detectUiType(f, tableName);
                if (isStatus && s.statusUiStyle === 'radio') {
                    html += `      document.querySelectorAll('#${tableName.toLowerCase()}EditForm [name="${f.name}"]').forEach(function(rb) { rb.checked = (rb.value === row.${f.name}); });\n`;
                } else if (isStatus && s.statusUiStyle === 'toggle') {
                    html += `      var cb = document.querySelector('#${tableName.toLowerCase()}EditForm [name="${f.name}"]'); if (cb) { cb.checked = (row.${f.name} === cb.value); cb.value = row.${f.name} || '${s.statusInactiveValue}'; }\n`;
                } else if (uiType === 'checkbox') {
                    html += `      var cb = document.querySelector('#${tableName.toLowerCase()}EditForm [name="${f.name}"]'); if (cb) cb.checked = row.${f.name} == 1 || row.${f.name} === true;\n`;
                } else {
                    html += `      var el = document.querySelector('#${tableName.toLowerCase()}EditForm [name="${f.name}"]'); if (el) el.value = row.${f.name} != null ? row.${f.name} : '';\n`;
                }
            }
            html += `      document.getElementById('${tableName.toLowerCase()}EditModal').style.display = 'flex';\n`;
            html += `    } catch (err) { alert('Error: ' + err.message); }\n`;
            html += `  }\n\n`;
            html += `  function close${tableName}EditModal() {\n`;
            html += `    document.getElementById('${tableName.toLowerCase()}EditModal').style.display = 'none';\n`;
            html += `    edit${tableName}Id = null;\n`;
            html += `  }\n\n`;
            html += `  document.getElementById('${tableName.toLowerCase()}EditForm').onsubmit = async function(e) {\n`;
            html += `    e.preventDefault();\n`;
            html += `    var formData = new FormData(e.target);\n`;
            html += `    document.querySelectorAll('#${tableName.toLowerCase()}EditForm input[type=checkbox]').forEach(function(cb) { if (!cb.checked) formData.set(cb.name, '0'); });\n`;
            html += `    const data = Object.fromEntries(formData);\n`;
            html += `    try {\n`;
            html += `      await fetch(\`\${API}/\${edit${tableName}Id}\`, {\n`;
            html += `        method: '${s.editMode.toUpperCase()}',\n`;
            html += `        headers: { 'Content-Type': 'application/json' },\n`;
            html += `        body: JSON.stringify(data)\n`;
            html += `      });\n`;
            html += `      close${tableName}EditModal();\n`;
            html += `      load${tableName}();\n`;
            html += `    } catch (err) { alert('Error: ' + err.message); }\n`;
            html += `  };\n\n`;
        }

        html += `  async function ${actionFunc}${tableName}(id) {\n`;
        html += `    if (!confirm('${actionLabel} this ${tableName.toLowerCase()}?')) return;\n`;
        html += `    await fetch(\`\${API}/\${id}\`, { method: 'DELETE' });\n`;
        html += `    load${tableName}();\n`;
        html += `  }\n\n`;

        if (showDelete) {
            html += `  async function hardDelete${tableName}(id) {\n`;
            html += `    if (!confirm('Permanently DELETE this ${tableName.toLowerCase()}?')) return;\n`;
            html += `    await fetch(\`\${API}/\${id}/delete\`, { method: 'POST' });\n`;
            html += `    load${tableName}();\n`;
            html += `  }\n\n`;
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
                    html += `  <div style="margin-bottom:8px;"><label>${label}</label><br>\n`;
                    html += `    <label style="margin-right:12px;"><input type="radio" name="${f.name}" value="${active}" checked /> ${active.charAt(0).toUpperCase() + active.slice(1)}</label>\n`;
                    html += `    <label><input type="radio" name="${f.name}" value="${inactive}" /> ${inactive.charAt(0).toUpperCase() + inactive.slice(1)}</label>\n`;
                    html += `  </div>\n`;
                } else if (s.statusUiStyle === 'dropdown') {
                    html += `  <select name="${f.name}"${required}>\n`;
                    html += `    <option value="${active}" selected>${active.charAt(0).toUpperCase() + active.slice(1)}</option>\n`;
                    html += `    <option value="${inactive}">${inactive.charAt(0).toUpperCase() + inactive.slice(1)}</option>\n`;
                    html += `  </select><br>\n`;
                } else if (s.statusUiStyle === 'toggle') {
                    html += `  <div style="margin-bottom:8px;"><label>${label}</label><br>\n`;
                    html += `    <label class="switch" style="position:relative;display:inline-block;width:44px;height:24px;">\n`;
                    html += `      <input type="checkbox" name="${f.name}" value="${active}" onchange="this.value=this.checked?'${active}':'${inactive}'" checked>\n`;
                    html += `      <span class="slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#555;border-radius:24px;transition:.3s;"></span>\n`;
                    html += `    </label>\n`;
                    html += `    <span id="${f.name}Label" style="margin-left:8px;font-size:13px;">${active.charAt(0).toUpperCase() + active.slice(1)}</span>\n`;
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
                } else if (uiType === 'checkbox') {
                    html += `  <label><input type="checkbox" name="${f.name}" value="1"> ${label}</label><br>\n`;
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

        let js = `let edit${tableName}Id = null;\n\n`;
        js += `document.getElementById('${tableName.toLowerCase()}Form').onsubmit = async (e) => {\n`;
        js += `  e.preventDefault();\n`;
        js += `  var fd = new FormData(e.target);\n`;
        js += `  e.target.querySelectorAll('input[type=checkbox]').forEach(function(cb) { if (!cb.checked) fd.set(cb.name, '0'); });\n`;
        js += `  const data = Object.fromEntries(fd);\n`;
        if (isModalEdit) {
            js += `  await fetch('${api}', {\n`;
            js += `    method: 'POST',\n`;
            js += `    headers: { 'Content-Type': 'application/json' },\n`;
            js += `    body: JSON.stringify(data)\n`;
            js += `  });\n`;
        } else {
            js += `  if (edit${tableName}Id) {\n`;
            js += `    await fetch(\`${api}/\${edit${tableName}Id}\`, {\n`;
            js += `      method: '${editMode.toUpperCase()}',\n`;
            js += `      headers: { 'Content-Type': 'application/json' },\n`;
            js += `      body: JSON.stringify(data)\n`;
            js += `    });\n`;
            js += `    edit${tableName}Id = null;\n`;
            js += `  } else {\n`;
            js += `    await fetch('${api}', {\n`;
            js += `      method: 'POST',\n`;
            js += `      headers: { 'Content-Type': 'application/json' },\n`;
            js += `      body: JSON.stringify(data)\n`;
            js += `    });\n`;
            js += `  }\n`;
        }
        js += `  e.target.reset();\n`;
        js += `  if (typeof load${tableName} === 'function') load${tableName}();\n`;
        js += `};\n\n`;

        if (isModalEdit) {
            js += `async function edit${tableName}(id) {\n`;
            js += `  if (typeof open${tableName}EditModal === 'function') {\n`;
            js += `    open${tableName}EditModal(id);\n`;
            js += `  }\n`;
            js += `}\n`;
        } else {
            js += `async function edit${tableName}(id) {\n`;
            js += `  try {\n`;
            js += `    const res = await fetch(\`\${API}/\${id}\`);\n`;
            js += `    if (!res.ok) throw new Error('Failed to fetch');\n`;
            js += `    const row = await res.json();\n`;
            js += `    edit${tableName}Id = id;\n`;
            for (const f of fields) {
                const isStatus = this._isStatusField(tableName, f.name);
                const uiType = this._detectUiType(f, tableName);
                if (isStatus && s.statusUiStyle === 'radio') {
                    js += `    document.querySelectorAll('[name="${f.name}"]').forEach(function(rb) { rb.checked = (rb.value === row.${f.name}); });\n`;
                } else if (isStatus && s.statusUiStyle === 'toggle') {
                    js += `    var cb = document.querySelector('[name="${f.name}"]'); if (cb) { cb.checked = (row.${f.name} === cb.value); cb.value = row.${f.name} || '${s.statusInactiveValue}'; }\n`;
                } else if (uiType === 'checkbox') {
                    js += `    var cb = document.querySelector('[name="${f.name}"]'); if (cb) cb.checked = row.${f.name} == 1 || row.${f.name} === true;\n`;
                } else {
                    js += `    document.querySelector('[name="${f.name}"]').value = row.${f.name} != null ? row.${f.name} : '';\n`;
                }
            }
            js += `  } catch (err) {\n`;
            js += `    alert('Error: ' + err.message);\n`;
            js += `  }\n`;
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

        const headerCells = fields.map(f => `<th onclick="sort${tableName}('${f.name}')" data-field="${f.name}" style="cursor:pointer;user-select:none;">${f.name.charAt(0).toUpperCase() + f.name.slice(1)}</th>`).join('');
        const cellRenderers = fields.map(f => {
            if (statField && f.name === statField.name) {
                return `<td data-field="${f.name}">\${i.${f.name} === '${activeVal}' ? '<span class="status-badge status-active">${activeVal.charAt(0).toUpperCase() + activeVal.slice(1)}</span>' : (i.${f.name} === '${inactiveVal}' ? '<span class="status-badge status-inactive">${inactiveVal.charAt(0).toUpperCase() + inactiveVal.slice(1)}</span>' : i.${f.name})}</td>`;
            }
            return `<td data-field="${f.name}">\${i.${f.name}}</td>`;
        }).join('');

        let js = `const API = '${api}';\n\n`;
        js += `// Pagination + search state\n`;
        js += `let _allItems = [];\n`;
        js += `let _currentPage = 1;\n`;
        js += `let _searchTerm = '';\n`;
        js += `let _sortField = '${s.sortField}';\n`;
        js += `let _sortDir = '${s.sortDir || 'asc'}';\n`;
        js += `const _pageSize = ${s.pageSize || 10};\n\n`;
        js += `/* Required HTML (add to your page):\n`;
        js += `   <input type="search" id="search${tableName}" placeholder="Search ${tableName}..." oninput="search${tableName}(this.value)" style="flex:1;...">\n`;
        js += `   <div id="${tableName.toLowerCase()}List">Loading...</div>\n`;
        js += `   <div id="pagination${tableName}" style="display:flex;gap:4px;align-items:center;justify-content:center;margin-top:8px;"></div>\n`;
        js += `*/\n\n`;
        js += `async function load${tableName}() {\n`;
        js += `  const res = await fetch(API);\n`;
        js += `  _allItems = await res.json();\n`;
        js += `  _currentPage = 1;\n`;
        js += `  _searchTerm = '';\n`;
        js += `  const searchEl = document.getElementById('search${tableName}');\n`;
        js += `  if (searchEl) searchEl.value = '';\n`;
        js += `  render${tableName}();\n`;
        js += `}\n\n`;
        js += `function render${tableName}() {\n`;
        js += `  let items = _allItems;\n`;
        js += `  if (_searchTerm) {\n`;
        js += `    const term = _searchTerm.toLowerCase();\n`;
        js += `    items = items.filter(function(i) { return Object.values(i).some(function(v) { return String(v).toLowerCase().includes(term); }); });\n`;
        js += `  }\n`;
        js += `  if (_sortField) {\n`;
        js += `    items.sort(function(a, b) {\n`;
        js += `      let va = a[_sortField], vb = b[_sortField];\n`;
        js += `      if (va == null) va = ''; if (vb == null) vb = '';\n`;
        js += `      if (typeof va === 'number') return _sortDir === 'asc' ? va - vb : vb - va;\n`;
        js += `      va = String(va).toLowerCase(); vb = String(vb).toLowerCase();\n`;
        js += `      return _sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);\n`;
        js += `    });\n`;
        js += `  }\n`;
        js += `  const total = items.length;\n`;
        js += `  const totalPages = Math.ceil(total / _pageSize) || 1;\n`;
        js += `  if (_currentPage > totalPages) _currentPage = totalPages;\n`;
        js += `  const start = (_currentPage - 1) * _pageSize;\n`;
        js += `  const page = items.slice(start, start + _pageSize);\n`;
        js += `  const list = document.getElementById('${tableName.toLowerCase()}List');\n`;
        js += `  if (!total) {\n`;
        js += `    list.innerHTML = '<p>No ${tableName.toLowerCase()} yet.</p>';\n`;
        js += `    document.getElementById('pagination${tableName}').innerHTML = '';\n`;
        js += `    return;\n`;
        js += `  }\n`;
        js += `  list.innerHTML = \`<table><tr>${headerCells}<th data-field="__actions__">Actions</th></tr>\n`;
        js += `    \${page.map(i => \`<tr>${cellRenderers}`;
        if (showDelete) {
            js += `<td data-field="__actions__"><button onclick="edit${tableName}(\${i.${pk}})" class="edit-btn">Edit</button> <button onclick="deactivate${tableName}(\${i.${pk}})" class="del-btn">Deactivate</button> <button onclick="hardDelete${tableName}(\${i.${pk}})" class="del-btn" style="background:#b71c1c;">Delete</button></td>\``;
        } else {
            js += `<td data-field="__actions__"><button onclick="edit${tableName}(\${i.${pk}})" class="edit-btn">Edit</button> <button onclick="${actionFunc}${tableName}(\${i.${pk}})" class="del-btn">${actionLabel}</button></td>\``;
        }
        js += `).join('')}</table>\`;\n`;
        js += `  var pgHtml = '';\n`;
        js += `  pgHtml += '<button onclick="goToPage${tableName}(1)" class="pg-btn">&laquo;</button>';\n`;
        js += `  pgHtml += '<button onclick="goToPage${tableName}(' + (_currentPage - 1) + ')" class="pg-btn"' + (_currentPage <= 1 ? ' disabled' : '') + '>&lsaquo;</button>';\n`;
        js += `  pgHtml += '<span class="pg-info">Page ' + _currentPage + ' of ' + totalPages + ' (' + total + ' total)</span>';\n`;
        js += `  pgHtml += '<button onclick="goToPage${tableName}(' + (_currentPage + 1) + ')" class="pg-btn"' + (_currentPage >= totalPages ? ' disabled' : '') + '>&rsaquo;</button>';\n`;
        js += `  pgHtml += '<button onclick="goToPage${tableName}(' + totalPages + ')" class="pg-btn">&raquo;</button>';\n`;
        js += `  document.getElementById('pagination${tableName}').innerHTML = pgHtml;\n`;
        js += `}\n\n`;
        js += `function search${tableName}(term) {\n`;
        js += `  _searchTerm = term;\n`;
        js += `  _currentPage = 1;\n`;
        js += `  render${tableName}();\n`;
        js += `}\n\n`;
        js += `function sort${tableName}(field) {\n`;
        js += `  if (_sortField === field) {\n`;
        js += `    _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';\n`;
        js += `  } else {\n`;
        js += `    _sortField = field;\n`;
        js += `    _sortDir = 'asc';\n`;
        js += `  }\n`;
        js += `  render${tableName}();\n`;
        js += `}\n\n`;
        js += `function goToPage${tableName}(page) {\n`;
        js += `  if (page < 1 || page > Math.ceil(_allItems.length / _pageSize)) return;\n`;
        js += `  _currentPage = page;\n`;
        js += `  render${tableName}();\n`;
        js += `}\n\n`;
        js += `function toggleCol${tableName}(field, visible) {\n`;
        js += `  document.querySelectorAll('#${tableName.toLowerCase()}List [data-field="' + field + '"]').forEach(function(el) {\n`;
        js += `    el.style.display = visible ? '' : 'none';\n`;
        js += `  });\n`;
        js += `}\n\n`;
        js += `async function ${actionFunc}${tableName}(id) {\n`;
        js += `  if (!confirm('${actionLabel} this ${tableName.toLowerCase()}?')) return;\n`;
        js += `  await fetch(\`\${API}/\${id}\`, { method: 'DELETE' });\n`;
        js += `  load${tableName}();\n`;
        js += `}\n\n`;
        if (showDelete) {
            js += `async function hardDelete${tableName}(id) {\n`;
            js += `  if (!confirm('Permanently DELETE this ${tableName.toLowerCase()}?')) return;\n`;
            js += `  await fetch(\`\${API}/\${id}/delete\`, { method: 'POST' });\n`;
            js += `  load${tableName}();\n`;
            js += `}\n\n`;
        }
        js += `load${tableName}();\n`;
        js += `// Add this CSS to your page: <style>.status-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}.status-active{background:#1b5e20;color:#a5d6a7}.status-inactive{background:#b71c1c;color:#ef9a9a}.pg-btn{padding:4px 10px;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;cursor:pointer;}.pg-btn[disabled]{opacity:0.5;cursor:default;}.pg-info{padding:4px 10px;color:#ccc;}<\/style>\n`;
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

