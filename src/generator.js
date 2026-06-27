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
            editStyle: raw.editStyle || 'form'
        };
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

        const headerCells = fields.map(f => `<th>${f.name.charAt(0).toUpperCase() + f.name.slice(1)}</th>`).join('');
        const cellRenderers = fields.map(f => {
            if (statField && f.name === statField.name) {
                return `<td>\${i.${f.name} === '${activeVal}' ? '<span class="status-badge status-active">${activeVal.charAt(0).toUpperCase() + activeVal.slice(1)}</span>' : (i.${f.name} === '${inactiveVal}' ? '<span class="status-badge status-inactive">${inactiveVal.charAt(0).toUpperCase() + inactiveVal.slice(1)}</span>' : i.${f.name})}</td>`;
            }
            return `<td>\${i.${f.name}}</td>`;
        }).join('');

        let html = `<h2>${tableName}</h2>\n`;
        html += `<style>.status-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}.status-active{background:#1b5e20;color:#a5d6a7}.status-inactive{background:#b71c1c;color:#ef9a9a}<\/style>\n`;
        html += `<div id="${tableName.toLowerCase()}List">Loading...</div>\n\n`;

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
                } else if (f.fk) {
                    html += `      <select name="${f.name}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;">\n`;
                    html += `        <option value="">Select ${f.fk.table}</option>\n`;
                    html += `      </select><br>\n`;
                } else if (f.type === 'TEXT' && (f.name.toLowerCase().includes('desc') || f.name.toLowerCase().includes('description'))) {
                    html += `      <textarea name="${f.name}" placeholder="${label}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;min-height:60px;"></textarea><br>\n`;
                } else if (f.type === 'REAL' || f.type === 'INTEGER') {
                    html += `      <input name="${f.name}" type="number"${f.type === 'REAL' ? ' step="any"' : ''} placeholder="${label}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"><br>\n`;
                } else {
                    html += `      <input name="${f.name}" placeholder="${label}"${required} style="width:100%;margin-bottom:8px;padding:6px 10px;font-size:14px;"><br>\n`;
                }
            }
            html += `      <div style="display:flex;gap:8px;margin-top:12px;">\n`;
            html += `        <button type="submit" style="padding:8px 16px;background:#0078d4;color:#fff;border:none;border-radius:4px;cursor:pointer;">Save Changes</button>\n`;
            html += `        <button type="button" onclick="close${tableName}EditModal()" style="padding:8px 16px;background:#6c757d;color:#fff;border:none;border-radius:4px;cursor:pointer;">Cancel</button>\n`;
            html += `      </div>\n`;
            html += `    </form>\n`;
            html += `  </div>\n`;
            html += `</div>\n\n`;
        }

        html += `<script>\n`;
        html += `  const API = '${api}';\n`;
        html += `  async function load${tableName}() {\n`;
        html += `    const res = await fetch(API);\n`;
        html += `    const items = await res.json();\n`;
        html += `    const list = document.getElementById('${tableName.toLowerCase()}List');\n`;
        html += `    if (!items.length) { list.innerHTML = '<p>No ${tableName.toLowerCase()} yet.</p>'; return; }\n`;
        html += `    list.innerHTML = \`<table><tr>${headerCells}<th>Actions</th></tr>\n`;
        html += `      \${items.map(i => \`<tr>${cellRenderers}`;
        html += `<td><button onclick="edit${tableName}(\${i.${pk}})" class="edit-btn">Edit</button> `;
        if (showDelete) {
            html += `<button onclick="deactivate${tableName}(\${i.${pk}})" class="del-btn">Deactivate</button> `;
            html += `<button onclick="hardDelete${tableName}(\${i.${pk}})" class="del-btn" style="background:#b71c1c;">Delete</button></td></tr>\`).join('')}</table>\`;\n`;
        } else {
            html += `<button onclick="${actionFunc}${tableName}(\${i.${pk}})" class="del-btn">${actionLabel}</button></td></tr>\`).join('')}</table>\`;\n`;
        }
        html += `  }\n\n`;

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
                if (isStatus && s.statusUiStyle === 'radio') {
                    html += `      document.querySelectorAll('#${tableName.toLowerCase()}EditForm [name="${f.name}"]').forEach(function(rb) { rb.checked = (rb.value === row.${f.name}); });\n`;
                } else if (isStatus && s.statusUiStyle === 'toggle') {
                    html += `      var cb = document.querySelector('#${tableName.toLowerCase()}EditForm [name="${f.name}"]'); if (cb) { cb.checked = (row.${f.name} === cb.value); cb.value = row.${f.name} || '${s.statusInactiveValue}'; }\n`;
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
            html += `    const data = Object.fromEntries(new FormData(e.target));\n`;
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

        // Default deactivate/delete function
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
            } else if (f.fk) {
                html += `  <select name="${f.name}"${required}>\n`;
                html += `    <option value="">Select ${f.fk.table}</option>\n`;
                html += `  </select><br>\n`;
            } else if (f.type === 'TEXT' && (f.name.toLowerCase().includes('desc') || f.name.toLowerCase().includes('description'))) {
                html += `  <textarea name="${f.name}" placeholder="${label}"${required}>${f.default || ''}</textarea><br>\n`;
            } else if (f.type === 'REAL' || f.type === 'INTEGER') {
                html += `  <input name="${f.name}" type="number"${f.type === 'REAL' ? ' step="any"' : ''} placeholder="${label}"${required}${defVal}><br>\n`;
            } else {
                html += `  <input name="${f.name}" placeholder="${label}"${required}${defVal}><br>\n`;
            }
        }
        html += `  <button type="submit">Add</button>\n`;
        html += `</form>\n`;
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
        js += `  const fd = new FormData(e.target);\n`;
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
                if (isStatus && s.statusUiStyle === 'radio') {
                    js += `    document.querySelectorAll('[name="${f.name}"]').forEach(function(rb) { rb.checked = (rb.value === row.${f.name}); });\n`;
                } else if (isStatus && s.statusUiStyle === 'toggle') {
                    js += `    var cb = document.querySelector('[name="${f.name}"]'); if (cb) { cb.checked = (row.${f.name} === cb.value); cb.value = row.${f.name} || '${s.statusInactiveValue}'; }\n`;
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

        const headerCells = fields.map(f => `<th>${f.name.charAt(0).toUpperCase() + f.name.slice(1)}</th>`).join('');
        const cellRenderers = fields.map(f => {
            if (statField && f.name === statField.name) {
                return `<td>\${i.${f.name} === '${activeVal}' ? '<span class="status-badge status-active">${activeVal.charAt(0).toUpperCase() + activeVal.slice(1)}</span>' : (i.${f.name} === '${inactiveVal}' ? '<span class="status-badge status-inactive">${inactiveVal.charAt(0).toUpperCase() + inactiveVal.slice(1)}</span>' : i.${f.name})}</td>`;
            }
            return `<td>\${i.${f.name}}</td>`;
        }).join('');

        let js = `const API = '${api}';\n\n`;
        js += `async function load${tableName}() {\n`;
        js += `  const res = await fetch(API);\n`;
        js += `  const items = await res.json();\n`;
        js += `  const list = document.getElementById('${tableName.toLowerCase()}List');\n`;
        js += `  if (!items.length) { list.innerHTML = '<p>No ${tableName.toLowerCase()} yet.</p>'; return; }\n`;
        js += `  list.innerHTML = \`<table><tr>${headerCells}<th>Actions</th></tr>\n`;
        js += `    \${items.map(i => \`<tr>${cellRenderers}`;
        if (showDelete) {
            js += `<td><button onclick="edit${tableName}(\${i.${pk}})" class="edit-btn">Edit</button> <button onclick="deactivate${tableName}(\${i.${pk}})" class="del-btn">Deactivate</button> <button onclick="hardDelete${tableName}(\${i.${pk}})" class="del-btn" style="background:#b71c1c;">Delete</button></td>\``;
        } else {
            js += `<td><button onclick="edit${tableName}(\${i.${pk}})" class="edit-btn">Edit</button> <button onclick="${actionFunc}${tableName}(\${i.${pk}})" class="del-btn">${actionLabel}</button></td>\``;
        }
        js += `).join('')}</table>\`;\n`;
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
        js += `// Add this CSS to your page: <style>.status-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}.status-active{background:#1b5e20;color:#a5d6a7}.status-inactive{background:#b71c1c;color:#ef9a9a}<\/style>\n`;
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

