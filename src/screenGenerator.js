class ScreenGenerator {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
    }

    _escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    _findFK(fromTable, toTable) {
        const from = this.schemaRegistry.getTable(fromTable);
        if (from && from.fields) {
            for (const field of from.fields) {
                if (field.fk && field.fk.table === toTable) {
                    return { name: field.name, fk: field.fk, reverse: false };
                }
            }
        }
        const to = this.schemaRegistry.getTable(toTable);
        if (to && to.fields) {
            for (const field of to.fields) {
                if (field.fk && field.fk.table === fromTable) {
                    return { name: field.name, fk: field.fk, reverse: true };
                }
            }
        }
        return null;
    }

    _buildPageConfigJs(screen) {
        return JSON.stringify(screen, null, 2)
            .replace(/\\/g, '\\\\')
            .replace(/`/g, '\\`')
            .replace(/\$/g, '\\$');
    }

    _findTableForField(fieldName) {
        const tables = this.schemaRegistry.getTables();
        for (const tName of tables) {
            const table = this.schemaRegistry.getTable(tName);
            if (table && table.fields) {
                for (const f of table.fields) {
                    if (f.name === fieldName) return tName;
                }
            }
        }
        return null;
    }

    generateTransactionPage(screen) {
        const pageConfig = this._buildPageConfigJs(screen);
        const title = this._escapeHtml(screen.title || screen.name);
        const authSection = screen.auth !== false
            ? '  <script src="auth.js"></script>\n  <script>redirectIfNotAuthenticated();</script>\n'
            : '';

        let h = '';
        h += '<!DOCTYPE html>\n';
        h += '<html lang="en">\n';
        h += '<head>\n';
        h += '  <meta charset="UTF-8">\n';
        h += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
        h += '  <title>' + title + '</title>\n';
        h += authSection;
        h += '  <style>\n';
        h += '    * { margin: 0; padding: 0; box-sizing: border-box; }\n';
        h += '    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; padding: 20px; }\n';
        h += '    .nav-bar { background: #0078d4; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 16px; }\n';
        h += '    .nav-bar .nav-title { color: #fff; font-size: 18px; font-weight: 600; margin-right: auto; }\n';
        h += '    .nav-bar a { color: #fff; text-decoration: none; font-size: 14px; padding: 4px 8px; border-radius: 4px; }\n';
        h += '    .nav-bar a:hover { background: rgba(255,255,255,0.15); }\n';
        h += '    .container { max-width: 960px; margin: 0 auto; }\n';
        h += '    h1 { color: #333; margin-bottom: 20px; font-size: 24px; }\n';
        h += '    .loading { text-align: center; padding: 40px; color: #888; font-size: 14px; }\n';
        h += '    .error { color: #d32f2f; padding: 16px; background: #ffebee; border-radius: 8px; margin-bottom: 16px; }\n';
        h += '    .screen-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 20px; }\n';
        h += '    .screen-item { background: #fff; border: 2px solid #e0e0e0; border-radius: 8px; padding: 16px; cursor: pointer; transition: all 0.2s; }\n';
        h += '    .screen-item:hover { border-color: #0078d4; box-shadow: 0 2px 8px rgba(0,120,212,0.15); }\n';
        h += '    .screen-item.selected { border-color: #0078d4; background: #e3f2fd; }\n';
        h += '    .screen-item.disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }\n';
        h += '    .item-field { margin-bottom: 4px; }\n';
        h += '    .item-label { font-size: 12px; color: #888; text-transform: uppercase; }\n';
        h += '    .item-value { font-size: 14px; color: #333; }\n';
        h += '    .group-section { margin-bottom: 24px; }\n';
        h += '    .group-header { background: #0078d4; color: #fff; padding: 8px 16px; border-radius: 6px; font-size: 16px; margin-bottom: 12px; }\n';
        h += '    .submit-area { text-align: center; padding: 16px; }\n';
        h += '    #submitBtn { padding: 12px 32px; font-size: 16px; background: #0078d4; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }\n';
        h += '    #submitBtn:disabled { background: #ccc; cursor: not-allowed; }\n';
        h += '    #submitBtn:hover:not(:disabled) { background: #005a9e; }\n';
        h += '    #resultArea { margin-top: 16px; padding: 12px 16px; border-radius: 6px; font-size: 14px; display: none; }\n';
        h += '    #resultArea.success { display: block; background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }\n';
        h += '    #resultArea.error { display: block; background: #ffebee; color: #c62828; border: 1px solid #ef9a9a; }\n';
        h += '  </style>\n';
        h += '</head>\n';
        h += '<body>\n';
        h += '  <div class="nav-bar">\n';
        h += '    <span class="nav-title">' + title + '</span>\n';
        h += '    <a href="/dashboard.html">Dashboard</a>\n';
        h += '    <a href="/login.html" onclick="logout()">Logout</a>\n';
        h += '  </div>\n';
        h += '  <div class="container">\n';
        h += '    <h1>' + title + '</h1>\n';
        h += '    <div id="screenContainer"><div class="loading">Loading...</div></div>\n';
        h += '    <div class="submit-area">\n';
        h += '      <button id="submitBtn" onclick="submitScreen()" disabled>Submit</button>\n';
        h += '      <div id="resultArea"></div>\n';
        h += '    </div>\n';
        h += '  </div>\n';
        h += '  <script>\n';
        h += '    function esc(str) { return String(str).replace(/&/g,\'&amp;\').replace(/</g,\'&lt;\').replace(/>/g,\'&gt;\').replace(/"/g,\'&quot;\'); }\n';
        h += '    const PAGE_CONFIG = ' + pageConfig + ';\n';
        h += '    const API_DATA = \'/api/\' + PAGE_CONFIG.name + \'/data\';\n';
        h += '    const API_SUBMIT = \'/api/\' + PAGE_CONFIG.name + \'/submit\';\n';
        h += '    const LIMIT_KEY = (PAGE_CONFIG.input && PAGE_CONFIG.input.limitField) ? PAGE_CONFIG.input.limitField.replace(\'.\', \'_\') : null;\n\n';

        h += '    async function loadScreen() {\n';
        h += '      const container = document.getElementById(\'screenContainer\');\n';
        h += '      container.innerHTML = \'<div class="loading">Loading...</div>\';\n';
        h += '      try {\n';
        h += '        const res = await authFetch(API_DATA);\n';
        h += '        if (!res.ok) throw new Error(\'Failed to load data\');\n';
        h += '        const data = await res.json();\n';
        h += '        const layout = PAGE_CONFIG.display.layout || \'plain\';\n';
        h += '        if (layout === \'grouped\') {\n';
        h += '          renderGrouped(data);\n';
        h += '        } else {\n';
        h += '          renderPlain(data);\n';
        h += '        }\n';
        h += '        updateSubmitButton();\n';
        h += '      } catch (err) {\n';
        h += '        container.innerHTML = \'<div class="error">Error: \' + err.message + \'</div>\';\n';
        h += '      }\n';
        h += '    }\n\n';

        h += '    function renderGrouped(data) {\n';
        h += '      const container = document.getElementById(\'screenContainer\');\n';
        h += '      const groupField = PAGE_CONFIG.display.groupField || PAGE_CONFIG.display.groupHeader;\n';
        h += '      const groupHeader = PAGE_CONFIG.display.groupHeader || groupField;\n';
        h += '      const groups = {};\n';
        h += '      data.forEach(function(item) {\n';
        h += '        const key = getItemField(item, groupField);\n';
        h += '        if (!groups[key]) groups[key] = { header: getItemField(item, groupHeader) || key, items: [] };\n';
        h += '        groups[key].items.push(item);\n';
        h += '      });\n';
        h += '      let html = \'\';\n';
        h += '      Object.keys(groups).forEach(function(key) {\n';
        h += '        const group = groups[key];\n';
        h += '        html += \'<div class="group-section">\';\n';
        h += '        html += \'<h3 class="group-header">\' + esc(group.header) + \'</h3>\';\n';
        h += '        html += \'<div class="screen-items">\';\n';
        h += '        group.items.forEach(function(item) {\n';
        h += '          html += renderItem(item);\n';
        h += '        });\n';
        h += '        html += \'</div></div>\';\n';
        h += '      });\n';
        h += '      container.innerHTML = html;\n';
        h += '    }\n\n';

        h += '    function renderPlain(data) {\n';
        h += '      const container = document.getElementById(\'screenContainer\');\n';
        h += '      let html = \'<div class="screen-items">\';\n';
        h += '      data.forEach(function(item) {\n';
        h += '        html += renderItem(item);\n';
        h += '      });\n';
        h += '      html += \'</div>\';\n';
        h += '      container.innerHTML = html;\n';
        h += '    }\n\n';

        h += '    function renderItem(item) {\n';
        h += '      const fields = PAGE_CONFIG.display.fields || [];\n';
        h += '      const selectableField = fields.find(function(f) { return f.displayAs === \'selectable\'; });\n';
        h += '      const valKey = selectableField ? selectableField.table + \'_\' + selectableField.field : null;\n';
        h += '      const value = valKey && item[valKey] != null ? item[valKey] : \'\';\n';
        h += '      const groupField = PAGE_CONFIG.display.groupField;\n';
        h += '      const groupVal = groupField ? (getItemField(item, groupField) || \'\') : \'\';\n';
        h += '      const limitVal = LIMIT_KEY ? (item[LIMIT_KEY] != null ? item[LIMIT_KEY] : 0) : 0;\n';
        h += '      let html = \'<div class="screen-item" data-value="\' + esc(value) + \'" data-group="\' + esc(groupVal) + \'" data-limit="\' + limitVal + \'" onclick="toggleSelection(this)">\';\n';
        h += '      html += renderFields(item);\n';
        h += '      html += \'</div>\';\n';
        h += '      return html;\n';
        h += '    }\n\n';

        h += '    function renderFields(item) {\n';
        h += '      const fields = PAGE_CONFIG.display.fields || [];\n';
        h += '      let html = \'\';\n';
        h += '      fields.forEach(function(f) {\n';
        h += '        if (f.show === false || f.displayAs === \'selectable\') return;\n';
        h += '        const key = f.table + \'_\' + f.field;\n';
        h += '        const val = item[key] != null ? item[key] : \'\';\n';
        h += '        html += \'<div class="item-field"><span class="item-label">\' + esc(f.field) + \':</span> <span class="item-value">\' + esc(val) + \'</span></div>\';\n';
        h += '      });\n';
        h += '      return html;\n';
        h += '    }\n\n';

        h += '    function getItemField(item, field) {\n';
        h += '      if (item[field] != null) return item[field];\n';
        h += '      var keys = Object.keys(item);\n';
        h += '      for (var i = 0; i < keys.length; i++) {\n';
        h += '        if (keys[i].endsWith(\'_\' + field)) return item[keys[i]];\n';
        h += '      }\n';
        h += '      return null;\n';
        h += '    }\n\n';

        h += '    function toggleSelection(el) {\n';
        h += '      const selType = (PAGE_CONFIG.input && PAGE_CONFIG.input.selectionType) || \'radio\';\n';
        h += '      if (selType === \'radio\') {\n';
        h += '        const group = el.closest(\'.group-section\') || document.getElementById(\'screenContainer\');\n';
        h += '        group.querySelectorAll(\'.screen-item.selected\').forEach(function(item) {\n';
        h += '          item.classList.remove(\'selected\');\n';
        h += '        });\n';
        h += '        el.classList.add(\'selected\');\n';
        h += '      } else {\n';
        h += '        el.classList.toggle(\'selected\');\n';
        h += '      }\n';
        h += '      updateSubmitButton();\n';
        h += '    }\n\n';

        h += '    function updateSubmitButton() {\n';
        h += '      const btn = document.getElementById(\'submitBtn\');\n';
        h += '      const selected = document.querySelectorAll(\'.screen-item.selected\');\n';
        h += '      btn.disabled = selected.length === 0;\n';
        h += '      if (PAGE_CONFIG.input && PAGE_CONFIG.input.limitField) {\n';
        h += '        document.querySelectorAll(\'.group-section\').forEach(function(section) {\n';
        h += '          const items = section.querySelectorAll(\'.screen-item\');\n';
        h += '          const selectedInGroup = section.querySelectorAll(\'.screen-item.selected\');\n';
        h += '          let limit = 0;\n';
        h += '          items.forEach(function(item) {\n';
        h += '            const lv = parseInt(item.getAttribute(\'data-limit\'));\n';
        h += '            if (!isNaN(lv) && lv > limit) limit = lv;\n';
        h += '          });\n';
        h += '          if (selectedInGroup.length >= limit && limit > 0) {\n';
        h += '            items.forEach(function(item) {\n';
        h += '              if (!item.classList.contains(\'selected\')) item.classList.add(\'disabled\');\n';
        h += '            });\n';
        h += '          } else {\n';
        h += '            items.forEach(function(item) { item.classList.remove(\'disabled\'); });\n';
        h += '          }\n';
        h += '        });\n';
        h += '      }\n';
        h += '    }\n\n';

        h += '    function resolveHiddenField(hf) {\n';
        h += '      var source = hf.source || \'\';\n';
        h += '      if (source.startsWith(\'jwt.\')) {\n';
        h += '        var token = localStorage.getItem(\'token\');\n';
        h += '        if (!token) return \'\';\n';
        h += '        try {\n';
        h += '          var payload = JSON.parse(atob(token.split(\'.\')[1]));\n';
        h += '          var field = source.split(\'.\')[1];\n';
        h += '          return field === \'id\' ? payload.id : (payload[field] || \'\');\n';
        h += '        } catch(e) { return \'\'; }\n';
        h += '      }\n';
        h += '      if (source.startsWith(\'url.\')) {\n';
        h += '        var param = source.split(\'.\')[1];\n';
        h += '        var params = new URL(window.location.href).searchParams;\n';
        h += '        return params.get(param) || \'\';\n';
        h += '      }\n';
        h += '      if (source.startsWith(\'fixed:\')) {\n';
        h += '        var val = source.substring(6);\n';
        h += '        try { return eval(val); } catch(e) { return val; }\n';
        h += '      }\n';
        h += '      return source;\n';
        h += '    }\n\n';

        h += '    async function submitScreen() {\n';
        h += '      var selected = document.querySelectorAll(\'.screen-item.selected[data-value]\');\n';
        h += '      if (selected.length === 0) return;\n';
        h += '      var values = [];\n';
        h += '      selected.forEach(function(el) { values.push(el.getAttribute(\'data-value\')); });\n';
        h += '      var hiddenFields = PAGE_CONFIG.input && PAGE_CONFIG.input.hiddenFields ? PAGE_CONFIG.input.hiddenFields : [];\n';
        h += '      var hidden = {};\n';
        h += '      hiddenFields.forEach(function(hf) { hidden[hf.name] = resolveHiddenField(hf); });\n';
        h += '      var resultArea = document.getElementById(\'resultArea\');\n';
        h += '      var btn = document.getElementById(\'submitBtn\');\n';
        h += '      btn.disabled = true;\n';
        h += '      try {\n';
        h += '        if (PAGE_CONFIG.input && PAGE_CONFIG.input.batch) {\n';
        h += '          for (var i = 0; i < values.length; i++) {\n';
        h += '            var payload = { value: values[i] };\n';
        h += '            Object.keys(hidden).forEach(function(k) { payload[k] = hidden[k]; });\n';
        h += '            var res = await authFetch(API_SUBMIT, { method: \'POST\', headers: { \'Content-Type\': \'application/json\' }, body: JSON.stringify(payload) });\n';
        h += '            if (!res.ok) {\n';
        h += '              var errData = await res.json().catch(function() { return { error: \'Request failed\' }; });\n';
        h += '              showResult(\'error\', (PAGE_CONFIG.result && PAGE_CONFIG.result.failureMessage) || \'Submission failed: \' + (errData.error || res.statusText));\n';
        h += '              btn.disabled = false;\n';
        h += '              return;\n';
        h += '            }\n';
        h += '          }\n';
        h += '          showResult(\'success\', (PAGE_CONFIG.result && PAGE_CONFIG.result.successMessage) || \'All submissions completed!\');\n';
        h += '        } else {\n';
        h += '          var payload = { values: values };\n';
        h += '          Object.keys(hidden).forEach(function(k) { payload[k] = hidden[k]; });\n';
        h += '          var res = await authFetch(API_SUBMIT, { method: \'POST\', headers: { \'Content-Type\': \'application/json\' }, body: JSON.stringify(payload) });\n';
        h += '          if (!res.ok) {\n';
        h += '            var errData = await res.json().catch(function() { return { error: \'Request failed\' }; });\n';
        h += '            showResult(\'error\', (PAGE_CONFIG.result && PAGE_CONFIG.result.failureMessage) || \'Submission failed: \' + (errData.error || res.statusText));\n';
        h += '            btn.disabled = false;\n';
        h += '            return;\n';
        h += '          }\n';
        h += '          showResult(\'success\', (PAGE_CONFIG.result && PAGE_CONFIG.result.successMessage) || \'Submission successful!\');\n';
        h += '        }\n';
        h += '      } catch (err) {\n';
        h += '        showResult(\'error\', \'Error: \' + err.message);\n';
        h += '        btn.disabled = false;\n';
        h += '      }\n';
        h += '    }\n\n';

        h += '    function showResult(type, message) {\n';
        h += '      var el = document.getElementById(\'resultArea\');\n';
        h += '      el.className = type;\n';
        h += '      el.textContent = message;\n';
        h += '      el.style.display = \'block\';\n';
        h += '    }\n\n';

        h += '    loadScreen();\n';
        h += '  <\/script>\n';
        h += '</body>\n';
        h += '</html>\n';

        return h;
    }

    generateReportPage(screen) {
        const pageConfig = this._buildPageConfigJs(screen);
        const title = this._escapeHtml(screen.title || screen.name);

        let h = '';
        h += '<!DOCTYPE html>\n';
        h += '<html lang="en">\n';
        h += '<head>\n';
        h += '  <meta charset="UTF-8">\n';
        h += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
        h += '  <title>' + title + '</title>\n';
        h += '  <script src="auth.js"><\/script>\n';
        h += '  <script>redirectIfNotAuthenticated();<\/script>\n';
        h += '  <style>\n';
        h += '    * { margin: 0; padding: 0; box-sizing: border-box; }\n';
        h += '    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; padding: 20px; }\n';
        h += '    .nav-bar { background: #0078d4; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 16px; }\n';
        h += '    .nav-bar .nav-title { color: #fff; font-size: 18px; font-weight: 600; margin-right: auto; }\n';
        h += '    .nav-bar a { color: #fff; text-decoration: none; font-size: 14px; padding: 4px 8px; border-radius: 4px; }\n';
        h += '    .nav-bar a:hover { background: rgba(255,255,255,0.15); }\n';
        h += '    .container { max-width: 960px; margin: 0 auto; }\n';
        h += '    h1 { color: #333; margin-bottom: 20px; font-size: 24px; }\n';
        h += '    .loading { text-align: center; padding: 40px; color: #888; font-size: 14px; }\n';
        h += '    .error { color: #d32f2f; padding: 16px; background: #ffebee; border-radius: 8px; margin-bottom: 16px; }\n';
        h += '    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }\n';
        h += '    th { background: #0078d4; color: #fff; padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; }\n';
        h += '    td { padding: 10px 16px; border-bottom: 1px solid #eee; font-size: 13px; color: #333; }\n';
        h += '    tr:last-child td { border-bottom: none; }\n';
        h += '    tr:nth-child(even) { background: #f8f9fa; }\n';
        h += '    tr:hover { background: #e8f0fe; }\n';
        h += '    .winner-row { background: #fff8e1 !important; }\n';
        h += '    .winner-row td:first-child::before { content: "\\1F3C6 "; }\n';
        h += '    .group-section { margin-bottom: 24px; }\n';
        h += '    .group-header { background: #0078d4; color: #fff; padding: 8px 16px; border-radius: 6px; font-size: 16px; margin-bottom: 12px; }\n';
        h += '    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }\n';
        h += '    .report-card { background: #fff; border: 2px solid #e0e0e0; border-radius: 8px; padding: 20px; transition: all 0.2s; }\n';
        h += '    .report-card.winner { border-color: #ffd700; box-shadow: 0 0 0 2px #ffd700; }\n';
        h += '    .report-card .card-title { font-size: 18px; font-weight: 600; color: #333; margin-bottom: 4px; }\n';
        h += '    .report-card .card-subtitle { font-size: 13px; color: #888; margin-bottom: 12px; }\n';
        h += '    .report-card .card-stat { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }\n';
        h += '    .report-card .card-stat .stat-label { color: #888; }\n';
        h += '    .report-card .card-stat .stat-value { font-weight: 600; color: #333; }\n';
        h += '    .percent-bar-wrapper { display: flex; align-items: center; gap: 8px; }\n';
        h += '    .percent-bar { display: inline-block; height: 8px; border-radius: 4px; background: #4caf50; min-width: 4px; }\n';
        h += '    .rank-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }\n';
        h += '    .rank-1 { background: #ffd700; color: #333; }\n';
        h += '    .rank-2 { background: #c0c0c0; color: #333; }\n';
        h += '    .rank-3 { background: #cd7f32; color: #fff; }\n';
        h += '    .rank-default { background: #e0e0e0; color: #666; }\n';
        h += '    @media print { .nav-bar { display: none; } body { padding: 0; } }\n';
        h += '  </style>\n';
        h += '</head>\n';
        h += '<body>\n';
        h += '  <div class="nav-bar">\n';
        h += '    <span class="nav-title">' + title + '</span>\n';
        h += '    <a href="/dashboard.html">Dashboard</a>\n';
        h += '    <a href="/login.html" onclick="logout()">Logout</a>\n';
        h += '  </div>\n';
        h += '  <div class="container">\n';
        h += '    <h1>' + title + '</h1>\n';
        h += '    <div id="reportContent"><div class="loading">Loading report data...</div></div>\n';
        h += '  </div>\n';
        h += '  <script>\n';
        h += '    function esc(str) { return String(str).replace(/&/g,\'&amp;\').replace(/</g,\'&lt;\').replace(/>/g,\'&gt;\').replace(/"/g,\'&quot;\'); }\n';
        h += '    const PAGE_CONFIG = ' + pageConfig + ';\n';
        h += '    const API = \'/api/\' + PAGE_CONFIG.name;\n\n';

        h += '    async function loadReport() {\n';
        h += '      const container = document.getElementById(\'reportContent\');\n';
        h += '      try {\n';
        h += '        const res = await authFetch(API);\n';
        h += '        if (!res.ok) throw new Error(\'Failed to load report\');\n';
        h += '        let data = await res.json();\n';
        h += '        if (!data || data.length === 0) {\n';
        h += '          container.innerHTML = \'<p style="text-align:center;color:#888;padding:40px;">No data available.</p>\';\n';
        h += '          return;\n';
        h += '        }\n';
        h += '        data = computeColumns(data, PAGE_CONFIG.computedColumns || {});\n';
        h += '        renderReport(data);\n';
        h += '      } catch (err) {\n';
        h += '        container.innerHTML = \'<div class="error">\' + err.message + \'</div>\';\n';
        h += '      }\n';
        h += '    }\n\n';

        h += '    function computeColumns(rows, computedConfig) {\n';
        h += '      var keys = Object.keys(computedConfig);\n';
        h += '      if (keys.length === 0) return rows;\n';
        h += '      keys.forEach(function(colName) {\n';
        h += '        var cfg = computedConfig[colName];\n';
        h += '        if (cfg.type === \'rank\') {\n';
        h += '          var sortField = cfg.sourceField || cfg.sortField;\n';
        h += '          var dir = (cfg.direction || \'desc\').toLowerCase();\n';
        h += '          if (cfg.perGroup) {\n';
        h += '            var groupField = PAGE_CONFIG.display.groupField;\n';
        h += '            var groups = {};\n';
        h += '            rows.forEach(function(row) {\n';
        h += '              var gkey = getItemField(row, groupField);\n';
        h += '              if (!groups[gkey]) groups[gkey] = [];\n';
        h += '              groups[gkey].push(row);\n';
        h += '            });\n';
        h += '            Object.keys(groups).forEach(function(gk) {\n';
        h += '              groups[gk].sort(function(a, b) {\n';
        h += '                var av = a[sortField] || 0, bv = b[sortField] || 0;\n';
        h += '                return dir === \'asc\' ? av - bv : bv - av;\n';
        h += '              });\n';
        h += '              groups[gk].forEach(function(row, idx) { row[colName] = idx + 1; });\n';
        h += '            });\n';
        h += '          } else {\n';
        h += '            var sorted = rows.slice().sort(function(a, b) {\n';
        h += '              var av = a[sortField] || 0, bv = b[sortField] || 0;\n';
        h += '              return dir === \'asc\' ? av - bv : bv - av;\n';
        h += '            });\n';
        h += '            sorted.forEach(function(row, idx) { row[colName] = idx + 1; });\n';
        h += '          }\n';
        h += '        } else if (cfg.type === \'percentage\') {\n';
        h += '          var sourceField = cfg.sourceField;\n';
        h += '          if (cfg.of === \'group\') {\n';
        h += '            var groupField = PAGE_CONFIG.display.groupField;\n';
        h += '            var groups = {};\n';
        h += '            rows.forEach(function(row) {\n';
        h += '              var gkey = getItemField(row, groupField);\n';
        h += '              if (!groups[gkey]) groups[gkey] = [];\n';
        h += '              groups[gkey].push(row);\n';
        h += '            });\n';
        h += '            Object.keys(groups).forEach(function(gk) {\n';
        h += '              var total = 0;\n';
        h += '              groups[gk].forEach(function(row) { total += Number(row[sourceField]) || 0; });\n';
        h += '              groups[gk].forEach(function(row) {\n';
        h += '                row[colName] = total > 0 ? (Number(row[sourceField]) / total * 100) : 0;\n';
        h += '              });\n';
        h += '            });\n';
        h += '          } else {\n';
        h += '            var grandTotal = 0;\n';
        h += '            rows.forEach(function(row) { grandTotal += Number(row[sourceField]) || 0; });\n';
        h += '            rows.forEach(function(row) {\n';
        h += '              row[colName] = grandTotal > 0 ? (Number(row[sourceField]) / grandTotal * 100) : 0;\n';
        h += '            });\n';
        h += '          }\n';
        h += '        } else if (cfg.type === \'runningTotal\') {\n';
        h += '          var sortField = cfg.sortField || cfg.sourceField;\n';
        h += '          var sourceField = cfg.sourceField;\n';
        h += '          var sorted = rows.slice().sort(function(a, b) {\n';
        h += '            var av = a[sortField], bv = b[sortField];\n';
        h += '            if (typeof av === \'string\') return String(av).localeCompare(String(bv));\n';
        h += '            return (Number(av) || 0) - (Number(bv) || 0);\n';
        h += '          });\n';
        h += '          var running = 0;\n';
        h += '          sorted.forEach(function(row) {\n';
        h += '            running += Number(row[sourceField]) || 0;\n';
        h += '            row[colName] = running;\n';
        h += '          });\n';
        h += '        }\n';
        h += '      });\n';
        h += '      return rows;\n';
        h += '    }\n\n';

        h += '    function getItemField(item, field) {\n';
        h += '      if (item[field] != null) return item[field];\n';
        h += '      var keys = Object.keys(item);\n';
        h += '      for (var i = 0; i < keys.length; i++) {\n';
        h += '        if (keys[i].endsWith(\'_\' + field)) return item[keys[i]];\n';
        h += '      }\n';
        h += '      return null;\n';
        h += '    }\n\n';

        h += '    function renderReport(rows) {\n';
        h += '      var layout = PAGE_CONFIG.display.layout || \'table\';\n';
        h += '      var container = document.getElementById(\'reportContent\');\n';
        h += '      if (layout === \'cards\') {\n';
        h += '        container.innerHTML = renderCards(rows);\n';
        h += '      } else if (layout === \'grouped-table\') {\n';
        h += '        container.innerHTML = renderGroupedTable(rows);\n';
        h += '      } else {\n';
        h += '        container.innerHTML = renderTable(rows);\n';
        h += '      }\n';
        h += '    }\n\n';

        h += '    function renderTable(rows) {\n';
        h += '      var columns = PAGE_CONFIG.display.columns || [];\n';
        h += '      if (columns.length === 0) {\n';
        h += '        var keys = Object.keys(rows[0] || {});\n';
        h += '        columns = keys.map(function(k) { return { field: k, label: k }; });\n';
        h += '      }\n';
        h += '      var html = \'<table><thead><tr>\';\n';
        h += '      columns.forEach(function(col) {\n';
        h += '        html += \'<th>\' + (col.label || col.field) + \'</th>\';\n';
        h += '      });\n';
        h += '      html += \'</tr></thead><tbody>\';\n';
        h += '      rows.forEach(function(row) {\n';
        h += '        var cls = \'\';\n';
        h += '        var rankField = columns.find(function(c) { return c.field === \'__rank__\' || c.format === \'rank\'; });\n';
        h += '        if (rankField && row[rankField.field] === 1) cls = \' class="winner-row"\';\n';
        h += '        html += \'<tr\' + cls + \'>\';\n';
        h += '        columns.forEach(function(col) {\n';
        h += '          html += \'<td>\' + formatCell(row[col.field], col) + \'</td>\';\n';
        h += '        });\n';
        h += '        html += \'</tr>\';\n';
        h += '      });\n';
        h += '      html += \'</tbody></table>\';\n';
        h += '      return html;\n';
        h += '    }\n\n';

        h += '    function renderGroupedTable(rows) {\n';
        h += '      var groupField = PAGE_CONFIG.display.groupField;\n';
        h += '      var groupHeader = PAGE_CONFIG.display.groupHeader || groupField;\n';
        h += '      var groups = {};\n';
        h += '      rows.forEach(function(row) {\n';
        h += '        var key = getItemField(row, groupField);\n';
        h += '        if (!groups[key]) groups[key] = { header: getItemField(row, groupHeader) || key, rows: [] };\n';
        h += '        groups[key].rows.push(row);\n';
        h += '      });\n';
        h += '      var html = \'\';\n';
        h += '      Object.keys(groups).forEach(function(key) {\n';
        h += '        var group = groups[key];\n';
        h += '        html += \'<div class="group-section">\';\n';
        h += '        html += \'<h3 class="group-header">\' + esc(group.header) + \'</h3>\';\n';
        h += '        html += renderTable(group.rows);\n';
        h += '        html += \'</div>\';\n';
        h += '      });\n';
        h += '      return html;\n';
        h += '    }\n\n';

        h += '    function renderCards(rows) {\n';
        h += '      var ct = PAGE_CONFIG.display.cardTemplate || {};\n';
        h += '      var stats = PAGE_CONFIG.display.stats || [];\n';
        h += '      var highlight = PAGE_CONFIG.display.highlight;\n';
        h += '      var columns = PAGE_CONFIG.display.columns || [];\n';
        h += '      var rankField = columns.find(function(c) { return c.field === \'__rank__\' || c.format === \'rank\'; });\n';
        h += '      var html = \'<div class="cards-grid">\';\n';
        h += '      rows.forEach(function(row) {\n';
        h += '        var isWinner = rankField && row[rankField.field] === 1;\n';
        h += '        if (highlight && row[highlight.field] && row[highlight.field] === highlight.value) isWinner = true;\n';
        h += '        html += \'<div class="report-card\' + (isWinner ? \' winner\' : \'\') + \'">\';\n';
        h += '        if (ct.title) html += \'<div class="card-title">\' + resolveTemplate(ct.title, row) + \'</div>\';\n';
        h += '        if (ct.subtitle) html += \'<div class="card-subtitle">\' + resolveTemplate(ct.subtitle, row) + \'</div>\';\n';
        h += '        var cardStats = stats.length > 0 ? stats : columns.filter(function(c) { return c.field !== \'__rank__\'; });\n';
        h += '        cardStats.forEach(function(s) {\n';
        h += '          var field = s.stat ? s.stat.field : s.field;\n';
        h += '          var label = s.stat ? s.stat.label : (s.label || field);\n';
        h += '          var val = field ? row[field] : \'\';\n';
        h += '          html += \'<div class="card-stat"><span class="stat-label">\' + esc(label) + \'</span><span class="stat-value">\' + esc(val != null ? val : \'\') + \'</span></div>\';\n';
        h += '        });\n';
        h += '        html += \'</div>\';\n';
        h += '      });\n';
        h += '      html += \'</div>\';\n';
        h += '      return html;\n';
        h += '    }\n\n';

        h += '    function formatCell(val, col) {\n';
        h += '      if (val == null) return \'\';\n';
        h += '      var fmt = col.format || \'text\';\n';
        h += '      if (fmt === \'percentage-bar\') {\n';
        h += '        var pct = Number(val).toFixed(1);\n';
        h += '        return \'<div class="percent-bar-wrapper"><span class="percent-bar" style="width:\' + Math.min(parseFloat(pct), 100) + \'px"></span>\' + pct + \'%</div>\';\n';
        h += '      }\n';
        h += '      if (fmt === \'percentage\') return Number(val).toFixed(2) + \'%\';\n';
        h += '      if (fmt === \'currency\') return \'₱\' + Number(val).toFixed(2);\n';
        h += '      if (fmt === \'boolean\') return val ? \'✓ Yes\' : \'✗ No\';\n';
        h += '      if (fmt === \'number\') return Number(val).toLocaleString();\n';
        h += '      if (fmt === \'rank\') {\n';
        h += '        var rc = \'rank-default\';\n';
        h += '        if (val === 1) rc = \'rank-1\';\n';
        h += '        else if (val === 2) rc = \'rank-2\';\n';
        h += '        else if (val === 3) rc = \'rank-3\';\n';
        h += '        return \'<span class="rank-badge \' + rc + \'">#\' + val + \'</span>\';\n';
        h += '      }\n';
        h += '      return String(val);\n';
        h += '    }\n\n';

        h += '    function resolveTemplate(template, item) {\n';
        h += '      return String(template).replace(/\\{\\{\\s*(\\w+)\\s*\\}\\}/g, function(match, field) {\n';
        h += '        return item[field] != null ? esc(item[field]) : \'\';\n';
        h += '      });\n';
        h += '    }\n\n';

        h += '    loadReport();\n';
        h += '  <\/script>\n';
        h += '</body>\n';
        h += '</html>\n';

        return h;
    }

    generateWidgetHtml(screen) {
        const title = this._escapeHtml(screen.title || screen.name);
        const label = this._escapeHtml(screen.label || title);
        const icon = screen.icon || '';
        const color = screen.color || '#0078d4';
        const link = screen.link ? this._escapeHtml(screen.link) : '';
        const querySql = screen.query ? screen.query.replace(/'/g, "\\'") : '';

        let h = '';
        h += '<div class="widget-card" style="background:#fff;border-radius:8px;padding:20px;border-left:4px solid ' + color + ';box-shadow:0 1px 3px rgba(0,0,0,0.1);cursor:pointer;" onclick="window.location.href=\'' + link + '\'">\n';
        h += '  <div style="display:flex;align-items:center;gap:12px;">\n';
        if (icon) {
            h += '    <span style="font-size:32px;">' + icon + '</span>\n';
        }
        h += '    <div>\n';
        h += '      <div style="font-size:13px;color:#888;text-transform:uppercase;">' + label + '</div>\n';
        h += '      <div id="widget_' + screen.name + '" style="font-size:28px;font-weight:700;color:#333;margin-top:4px;">--</div>\n';
        h += '    </div>\n';
        h += '  </div>\n';
        h += '</div>\n';
        h += '<script>\n';
        h += '(async function() {\n';
        h += '  try {\n';
        h += '    var res = await fetch(\'/api/widget/\' + \'' + screen.name + '\');\n';
        h += '    var data = await res.json();\n';
        h += '    var el = document.getElementById(\'widget_' + screen.name + '\');\n';
        h += '    if (el && data && data[0]) {\n';
        h += '      var vals = Object.values(data[0]);\n';
        h += '      el.textContent = vals.length > 0 ? vals[0] : \'0\';\n';
        h += '    }\n';
        h += '  } catch(e) { console.error(\'Widget load error\', e); }\n';
        h += '})();\n';
        h += '<\/script>\n';

        return h;
    }

    generateTransactionDataRoute(screen) {
        const fields = screen.display.fields || [];
        const groupField = screen.display.groupField;
        const groupHeader = screen.display.groupHeader;
        const limitField = screen.input ? screen.input.limitField : null;

        // Collect tables from fields
        const tables = new Set();
        fields.forEach(function(f) { if (f.table) tables.add(f.table); });

        // Parse and add tables referenced by groupField/groupHeader/limitField
        const extraFields = [];
        if (groupField && !groupField.includes('.')) {
            const t = this._findTableForField(groupField);
            if (t) extraFields.push({ table: t, field: groupField });
        } else if (groupField && groupField.includes('.')) {
            var parts = groupField.split('.');
            extraFields.push({ table: parts[0], field: parts[1] });
        }
        if (groupHeader && groupHeader !== groupField) {
            if (!groupHeader.includes('.')) {
                const t = this._findTableForField(groupHeader);
                if (t) extraFields.push({ table: t, field: groupHeader });
            } else {
                var parts = groupHeader.split('.');
                extraFields.push({ table: parts[0], field: parts[1] });
            }
        }
        if (limitField && limitField.includes('.')) {
            var parts = limitField.split('.');
            extraFields.push({ table: parts[0], field: parts[1] });
        }

        extraFields.forEach(function(ef) { if (ef.table) tables.add(ef.table); });

        var allFields = fields.concat(extraFields);
        const tableNames = Array.from(tables);
        if (tableNames.length === 0) return '// No tables specified';

        const mainTable = tableNames[0];
        const selectParts = allFields.map(function(f) {
            return '  ' + f.table + '.' + f.field + ' AS ' + f.table + '_' + f.field;
        });

        // Build JOINs for additional tables
        var joins = '';
        for (var i = 1; i < tableNames.length; i++) {
            var t2 = tableNames[i];
            var fk = this._findFK(mainTable, t2);
            if (fk) {
                if (!fk.reverse) {
                    joins += '\n  LEFT JOIN ' + t2 + ' ON ' + mainTable + '.' + fk.name + ' = ' + t2 + '.' + fk.fk.field;
                } else {
                    joins += '\n  LEFT JOIN ' + t2 + ' ON ' + mainTable + '.' + fk.fk.field + ' = ' + t2 + '.' + fk.name;
                }
            } else {
                // Try to find path through other tables
                var found = false;
                for (var j = 1; j < i; j++) {
                    var bridge = tableNames[j];
                    var fk1 = this._findFK(bridge, t2);
                    if (fk1) {
                        if (!fk1.reverse) {
                            joins += '\n  LEFT JOIN ' + t2 + ' ON ' + bridge + '.' + fk1.name + ' = ' + t2 + '.' + fk1.fk.field;
                        } else {
                            joins += '\n  LEFT JOIN ' + t2 + ' ON ' + bridge + '.' + fk1.fk.field + ' = ' + t2 + '.' + fk1.name;
                        }
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    joins += '\n  CROSS JOIN ' + t2;
                }
            }
        }

        var uniqueSelects = [];
        var seen = {};
        selectParts.forEach(function(sp) {
            if (!seen[sp]) {
                seen[sp] = true;
                uniqueSelects.push(sp);
            }
        });

        var sql = 'SELECT\n' + uniqueSelects.join(',\n') + '\nFROM ' + mainTable + joins + ';';

        var route = '';
        route += '// GET ' + screen.name + ' data\n';
        route += 'app.get(\'/api/' + screen.name + '/data\', authenticate, (req, res) => {\n';
        route += '  try {\n';
        route += '    var stmt = db.prepare(\'' + sql.replace(/'/g, "\\'") + '\');\n';
        route += '    var rows = stmt.all();\n';
        route += '    res.json(rows);\n';
        route += '  } catch (err) {\n';
        route += '    res.status(500).json({ error: err.message });\n';
        route += '  }\n';
        route += '});\n';

        return route;
    }
}

module.exports = ScreenGenerator;
