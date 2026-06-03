class CodeGenerator {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
    }

    getPK(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return 'id';
        const pk = table.fields.find(f => f.pk);
        return pk ? pk.name : (table.fields[0]?.name || 'id');
    }

    getNonPKFields(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return [];
        return table.fields.filter(f => !f.pk);
    }

    getStatField(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return null;
        return table.fields.find(f => f.name.toLowerCase().includes('stat')) || null;
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
            lines.push(`const ${varPrefix}Deactivate = db.prepare("UPDATE ${tableName} SET ${statField.name} = 'inactive' WHERE ${pk} = ?");`);
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
            routes += `app.put('${itemRoute}', (req, res) => {\n`;
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

        return routes;
    }

    generateListHtml(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '<!-- Table not found -->';
        const fields = this.getNonPKFields(tableName);
        const pk = this.getPK(tableName);
        const api = `/api/${tableName.toLowerCase()}`;

        let html = `<h2>${tableName}</h2>\n`;
        html += `<div id="${tableName.toLowerCase()}List">Loading...</div>\n\n`;
        html += `<script>\n`;
        html += `  const API = '${api}';\n`;
        html += `  async function load${tableName}() {\n`;
        html += `    const res = await fetch(API);\n`;
        html += `    const items = await res.json();\n`;
        html += `    const list = document.getElementById('${tableName.toLowerCase()}List');\n`;
        html += `    if (!items.length) { list.innerHTML = '<p>No ${tableName.toLowerCase()} yet.</p>'; return; }\n`;
        html += `    list.innerHTML = \`<table><tr>${fields.map(f => `<th>${f.name.charAt(0).toUpperCase() + f.name.slice(1)}</th>`).join('')}<th>Actions</th></tr>\n`;
        html += `      \${items.map(i => \`<tr>${fields.map(f => `<td>\${i.${f.name}}</td>`).join('')}`;
        html += `<td><button onclick="edit${tableName}(\${i.${pk}})" class="edit-btn">Edit</button> `;
        html += `<button onclick="deactivate${tableName}(\${i.${pk}})" class="del-btn">Deactivate</button></td></tr>\`).join('')}</table>\`;\n`;
        html += `  }\n\n`;
        html += `  async function deactivate${tableName}(id) {\n`;
        html += `    if (!confirm('Deactivate this ${tableName.toLowerCase()}?')) return;\n`;
        html += `    await fetch(\`API/\${id}\`, { method: 'DELETE' });\n`;
        html += `    load${tableName}();\n`;
        html += `  }\n\n`;
        html += `  load${tableName}();\n`;
        html += `</script>`;
        return html;
    }

    generateFormHtml(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '<!-- Table not found -->';
        const fields = this.getNonPKFields(tableName);

        let html = `<h2>Add ${tableName}</h2>\n`;
        html += `<form id="${tableName.toLowerCase()}Form">\n`;
        for (const f of fields) {
            const label = f.name.charAt(0).toUpperCase() + f.name.slice(1);
            const required = f.notNull ? ' required' : '';
            const defVal = f.default !== undefined ? ` value="${f.default}"` : '';
            if (f.fk) {
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

        let js = `let edit${tableName}Id = null;\n\n`;
        js += `document.getElementById('${tableName.toLowerCase()}Form').onsubmit = async (e) => {\n`;
        js += `  e.preventDefault();\n`;
        js += `  const fd = new FormData(e.target);\n`;
        js += `  const data = Object.fromEntries(fd);\n`;
        js += `  if (edit${tableName}Id) {\n`;
        js += `    await fetch(\`${api}/\${edit${tableName}Id}\`, {\n`;
        js += `      method: 'PUT',\n`;
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
        js += `  e.target.reset();\n`;
        js += `  if (typeof load${tableName} === 'function') load${tableName}();\n`;
        js += `};\n\n`;

        js += `function edit${tableName}(id, ${fields.map(f => f.name).join(', ')}) {\n`;
        js += `  edit${tableName}Id = id;\n`;
        for (const f of fields) {
            js += `  document.querySelector('[name="${f.name}"]').value = ${f.name};\n`;
        }
        js += `}\n`;
        return js;
    }

    generateListJs(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '// Table not found';
        const pk = this.getPK(tableName);
        const fields = this.getNonPKFields(tableName);
        const api = `/api/${tableName.toLowerCase()}`;

        let js = `const API = '${api}';\n\n`;
        js += `async function load${tableName}() {\n`;
        js += `  const res = await fetch(API);\n`;
        js += `  const items = await res.json();\n`;
        js += `  const list = document.getElementById('${tableName.toLowerCase()}List');\n`;
        js += `  if (!items.length) { list.innerHTML = '<p>No ${tableName.toLowerCase()} yet.</p>'; return; }\n`;
        js += `  list.innerHTML = \`<table><tr>${fields.map(f => `<th>${f.name.charAt(0).toUpperCase() + f.name.slice(1)}</th>`).join('')}<th>Actions</th></tr>\n`;
        js += `    \${items.map(i => \`<tr>${fields.map(f => `<td>\${i.${f.name}}</td>`).join('')}`;
        js += `<td><button onclick="edit${tableName}(\${i.${pk}})" class="edit-btn">Edit</button> `;
        js += `<button onclick="deactivate${tableName}(\${i.${pk}})" class="del-btn">Deactivate</button></td></tr>\`).join('')}</table>\`;\n`;
        js += `}\n\n`;
        js += `async function deactivate${tableName}(id) {\n`;
        js += `  if (!confirm('Deactivate this ${tableName.toLowerCase()}?')) return;\n`;
        js += `  await fetch(\`API/\${id}\`, { method: 'DELETE' });\n`;
        js += `  load${tableName}();\n`;
        js += `}\n\n`;
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

    generate(snippetType, tableName) {
        switch (snippetType) {
            case 'crud': return this.generateCrud(tableName);
            case 'list': return this.generateListHtml(tableName);
            case 'list-js': return this.generateListJs(tableName);
            case 'form': return this.generateFormHtml(tableName);
            case 'form-js': return this.generateFormJs(tableName);
            case 'page': return this.generatePageHtml(tableName);
            case 'page-js': return this.generatePageJs(tableName);
            default: return `// Unknown snippet type: ${snippetType}`;
        }
    }
}

module.exports = { CodeGenerator };
