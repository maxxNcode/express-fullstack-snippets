/**
 * Scaffer — Complete Project Scaffolding Engine
 *
 * Generates a full working Express + SQLite project folder structure
 * from registered schemas, auth config, and report queries.
 *
 * For ANY exam problem. No exam-specific code.
 *
 * Output structure:
 *   project/
 *   ├── server.js          ← Express app with all routes + auth + business rules
 *   ├── package.json       ← With all npm dependencies pre-configured
 *   ├── .env               ← Environment variables (JWT secrets, port, DB path)
 *   ├── .gitignore         ← Standard Node.js ignores
 *   └── public/
 *       ├── auth.js        ← Client-side auth library (JWT, login, register, logout)
 *       ├── login.html     ← Login page (fully styled)
 *       ├── register.html  ← Register page (optional)
 *       ├── dashboard.html ← Main dashboard with navigation
 *       └── [tableName].html ← CRUD management pages for each table
 *
 * Usage:
 *   const scaffolder = new Scaffer(schemaRegistry, codeGenerator, authGenerator, ruleEngine);
 *   const files = scaffolder.generateAll(tableNames, authConfig, rules);
 */
class Scaffer {
    constructor(schemaRegistry) {
        const { CodeGenerator } = require('./generator');
        const { AuthGenerator } = require('./authGenerator');
        const { RuleEngine } = require('./ruleEngine');

        this.schemaRegistry = schemaRegistry;
        this.codeGen = new CodeGenerator(schemaRegistry);
        this.authGen = new AuthGenerator(schemaRegistry);
        this.ruleEngine = new RuleEngine(schemaRegistry);
    }

    /**
     * Generate ALL files for a complete project.
     * @param {string} projectName - Project name (used for display)
     * @param {string[]} tableNames - Array of registered table names
     * @param {object|null} authConfig - Auth configuration
     * @param {Array} businessRules - Array of business rule definitions
     * @param {Array} reports - Array of { name, title, columns, computedColumns, displayConfig, filters, sortBy, limit, groupBy, having, distinct, joinType }
     * @param {object} options - { port, includeSampleData }
     * @returns {object} Map of filePath -> fileContent
     */
    generateAll(projectName, tableNames, authConfig, businessRules, reports, options = {}) {
        const files = {};
        const port = options.port || 3000;
        const hasAuth = !!(authConfig && authConfig.tableName && authConfig.identityFields && authConfig.identityFields.length > 0 && authConfig.passwordField);
        const hasRules = !!(businessRules && businessRules.length > 0);

        files['server.js'] = this._generateServer(projectName, tableNames, authConfig, businessRules, reports, port);
        files['package.json'] = this._generatePackageJson(projectName, hasAuth);
        files['.env'] = this._generateEnv(hasAuth, port);
        files['.gitignore'] = this._generateGitignore();

        // Public directory
        if (hasAuth) {
            files['public/auth.js'] = this.authGen.generateAuthClientJs({ useJwt: true });
        }

        files['public/login.html'] = hasAuth
            ? this.authGen.generateLoginFormHtml(authConfig.tableName, authConfig.identityFields, authConfig.passwordField, { useJwt: true })
            : this._generateLoginFallback();

        if (hasAuth && authConfig.generateRegisterHtml) {
            files['public/register.html'] = this.authGen.generateRegisterFormHtml(authConfig.tableName, authConfig.passwordField, {});
        }

        files['public/dashboard.html'] = this._generateDashboard(projectName, tableNames, reports, hasAuth);

        // CRUD pages for each table
        for (const tableName of tableNames) {
            const table = this.schemaRegistry.getTable(tableName);
            if (!table) continue;
            files[`public/${tableName.toLowerCase()}.html`] = this._generateCrudPage(tableName);
        }

        // Report pages
        if (reports && reports.length > 0) {
            for (const report of reports) {
                const cols = report.displayConfig || report.columns.map(c => ({
                    field: c.field,
                    label: c.field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                    format: 'text'
                }));
                const isCustomReport = !!report.columns; // Uses query generator
                if (isCustomReport) {
                    files[`public/${report.name}.html`] = this.codeGen.generateReportHtml(report.name, report.columns, cols, { title: report.title });
                } else {
                    // Generic report using rule engine
                    files[`public/${report.name}.html`] = this.ruleEngine.generateReportHtml(report.name, cols);
                }
            }
        }

        return files;
    }

    /**
     * Generate the main server.js file.
     */
    _generateServer(projectName, tableNames, authConfig, businessRules, reports, port) {
        let code = '';
        code += '// ==========================================================\n';
        code += '// ' + projectName + ' — Auto-generated by Express Full-Stack Snippets\n';
        code += '// ==========================================================\n\n';

        // Imports
        code += 'require("dotenv").config();\n';
        code += 'const express = require("express");\n';
        code += 'const cors = require("cors");\n';
        code += 'const path = require("path");\n';
        code += 'const Database = require("better-sqlite3");\n\n';

        code += 'const app = express();\n';
        code += 'const PORT = process.env.PORT || ' + port + ';\n\n';

        code += '// --- Middleware ---\n';
        code += 'app.use(cors());\n';
        code += 'app.use(express.json());\n';
        code += 'app.use(express.static(path.join(__dirname, "public")));\n\n';

        // Database setup
        code += '// --- Database Setup ---\n';
        code += 'const db = new Database(process.env.DB_PATH || "data/database.db");\n';
        code += 'db.pragma("journal_mode = WAL");\n';
        code += 'db.pragma("foreign_keys = ON");\n\n';

        // Create tables
        code += '// --- Create Tables ---\n';
        for (const tableName of tableNames) {
            code += this.codeGen.generateCreateTable(tableName) + '\n\n';
        }

        // Auth middleware + routes
        const hasAuth = !!(authConfig && authConfig.tableName && authConfig.identityFields && authConfig.identityFields.length > 0 && authConfig.passwordField);
        const hasBcrypt = hasAuth;
        const useJwt = hasAuth;
        if (hasAuth) {
            // Need bcrypt for auth server code
            code += 'const bcrypt = require("bcrypt");\n';
            code += 'const jwt = require("jsonwebtoken");\n\n';
        }

        // Business rules middleware
        const hasRules = !!(businessRules && businessRules.length > 0);
        if (hasRules) {
            if (useJwt) {
                code += 'const jwt = require("jsonwebtoken");\n';
            }
            code += this.ruleEngine.generateAll(businessRules, [{ method: 'POST', path: '/api/*', table: '*' }]);
            code += '\n';
        }

        // Auth routes
        if (hasAuth) {
            code += '// ======================= Auth Routes =======================\n';
            code += this.authGen.generateLogin(authConfig.tableName, authConfig.identityFields, authConfig.passwordField, authConfig.statusField || null, { useJwt: true, useBcrypt: true });
            code += '\n\n';

            if (authConfig.generateRegister) {
                const table = this.schemaRegistry.getTable(authConfig.tableName);
                const allFields = table ? table.fields.map(f => f.name) : [];
                code += this.authGen.generateRegister(authConfig.tableName, allFields, authConfig.passwordField, { ...authConfig, identityFields: authConfig.identityFields });
                code += '\n\n';
            }

            code += this.authGen.generateAuthMiddleware(authConfig.tableName, authConfig.identityFields, { useJwt: true });
            code += '\n\n';

            code += '// --- Logout Endpoint ---\n';
            code += "app.post('/api/auth/logout', (req, res) => {\n";
            code += '  const header = req.headers.authorization;\n';
            code += "  if (header && header.startsWith('Bearer ')) {\n";
            code += '    const token = header.split(\' \')[1];\n';
            code += '    // In production, add token to a blacklist\n';
            code += '  }\n';
            code += "  res.json({ message: 'Logged out successfully' });\n";
            code += '});\n\n';
        }

        // CRUD routes for each table
        code += '// ======================= CRUD Routes =======================\n';
        for (const tableName of tableNames) {
            code += this.codeGen.generatePrepStatements(tableName) + '\n\n';
            code += this.codeGen.generateCrudRoutes(tableName) + '\n\n';
        }

        // Report routes
        if (reports && reports.length > 0) {
            code += '// ======================= Report Routes =======================\n';
            // Add authenticate middleware check for report routes
            if (useJwt) {
                code += '// All report routes require authentication (JWT)\n';
            }
            code += '\n';
            for (const report of reports) {
                code += this.codeGen.generateReportServer(report.name, report.columns, report.computedColumns, report.filters, report.sortBy, report.limit, report.groupBy, report.having, report.distinct, report.joinType);
                code += '\n\n';
            }
        }

        // Default route
        code += '// --- Default Route ---\n';
        code += "app.get('/', (req, res) => {\n";
        code += '  res.redirect("/dashboard.html");\n';
        code += '});\n\n';

        // Error handler
        code += '// --- Error Handler ---\n';
        code += 'app.use((err, req, res, next) => {\n';
        code += '  console.error(err.stack);\n';
        code += '  res.status(500).json({ error: "Something went wrong!" });\n';
        code += '});\n\n';

        // Start server
        code += '// --- Start Server ---\n';
        code += 'app.listen(PORT, () => {\n';
        code += '  console.log(`' + projectName + ' running on http://localhost:${PORT}`);\n';
        code += '});\n';

        return code;
    }

    /**
     * Generate package.json with all required dependencies.
     */
    _generatePackageJson(projectName, hasAuth) {
        const deps = {
            'express': '^4.18.2',
            'better-sqlite3': '^9.4.3',
            'cors': '^2.8.5',
            'dotenv': '^16.3.1'
        };
        if (hasAuth) {
            deps['jsonwebtoken'] = '^9.0.2';
            deps['bcrypt'] = '^5.1.1';
        }

        return JSON.stringify({
            name: projectName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            version: '1.0.0',
            description: projectName + ' — Auto-generated',
            main: 'server.js',
            scripts: {
                start: 'node server.js',
                dev: 'node --watch server.js'
            },
            dependencies: deps
        }, null, 2);
    }

    /**
     * Generate .env file.
     */
    _generateEnv(hasAuth, port) {
        let code = '';
        code += '# ' + '='.repeat(55) + '\n';
        code += '# Environment Configuration — Auto-generated\n';
        code += '# ' + '='.repeat(55) + '\n\n';
        code += '# Server\n';
        code += 'PORT=' + port + '\n';
        code += 'DB_PATH=data/database.db\n\n';
        if (hasAuth) {
            code += '# JWT Secrets — CHANGE THESE in production\n';
            code += 'JWT_SECRET=change_this_to_a_random_string_min_32_chars\n';
            code += 'JWT_REFRESH_SECRET=change_this_to_another_random_string\n';
        }
        return code;
    }

    /**
     * Generate .gitignore file.
     */
    _generateGitignore() {
        return 'node_modules/\n.env\ndata/\n*.db\n*.db-wal\n*.db-shm\n.DS_Store\n';
    }

    /**
     * Generate a login fallback page if no auth is configured.
     */
    _generateLoginFallback() {
        let html = '';
        html += '<!DOCTYPE html>\n';
        html += '<html lang="en">\n';
        html += '<head>\n';
        html += '  <meta charset="UTF-8">\n';
        html += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
        html += '  <title>Login</title>\n';
        html += '  <style>\n';
        html += '    * { margin: 0; padding: 0; box-sizing: border-box; }\n';
        html += '    body { font-family: -apple-system, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; }\n';
        html += '    .container { background: #fff; padding: 32px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; }\n';
        html += '    h1 { color: #333; margin-bottom: 10px; }\n';
        html += '    p { color: #666; }\n';
        html += '    a { color: #0078d4; text-decoration: none; }\n';
        html += '  </style>\n';
        html += '</head>\n';
        html += '<body>\n';
        html += '  <div class="container">\n';
        html += '    <h1>Welcome</h1>\n';
        html += '    <p>No authentication configured.</p>\n';
        html += '    <p><a href="/dashboard.html">Go to Dashboard</a></p>\n';
        html += '  </div>\n';
        html += '</body>\n';
        html += '</html>\n';
        return html;
    }

    /**
     * Generate a dashboard page with navigation to all modules.
     */
    _generateDashboard(projectName, tableNames, reports, hasAuth) {
        const displayName = projectName || 'My App';
        let html = '';
        html += '<!DOCTYPE html>\n';
        html += '<html lang="en">\n';
        html += '<head>\n';
        html += '  <meta charset="UTF-8">\n';
        html += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
        html += '  <title>' + displayName + ' Dashboard</title>\n';
        if (hasAuth) {
            html += '  <script src="auth.js"></script>\n';
            html += '  <script>redirectIfNotAuthenticated();</script>\n';
        }
        html += '  <style>\n';
        html += '    * { margin: 0; padding: 0; box-sizing: border-box; }\n';
        html += '    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f0f2f5; padding: 20px; }\n';
        html += '    .container { max-width: 960px; margin: 0 auto; }\n';
        html += '    h1 { color: #333; margin-bottom: 8px; font-size: 28px; }\n';
        html += '    p.subtitle { color: #888; margin-bottom: 24px; font-size: 14px; }\n';
        html += '    .nav-bar { background: #0078d4; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 16px; align-items: center; }\n';
        html += '    .nav-bar a { color: #fff; text-decoration: none; font-size: 14px; padding: 4px 8px; border-radius: 4px; }\n';
        html += '    .nav-bar a:hover { background: rgba(255,255,255,0.15); }\n';
        html += '    .nav-bar .brand { font-weight: 600; font-size: 16px; }\n';
        html += '    .nav-bar .spacer { flex: 1; }\n';
        html += '    .card { background: #fff; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: space-between; transition: box-shadow 0.15s; }\n';
        html += '    .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }\n';
        html += '    .card h3 { color: #333; font-size: 16px; }\n';
        html += '    .card p { color: #888; font-size: 13px; margin-top: 2px; }\n';
        html += '    .card a { text-decoration: none; color: inherit; display: flex; flex: 1; align-items: center; justify-content: space-between; }\n';
        html += '    .card .badge { background: #0078d4; color: #fff; padding: 2px 10px; border-radius: 12px; font-size: 12px; }\n';
        html += '    .section-title { font-size: 16px; font-weight: 600; color: #555; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #0078d4; }\n';
        html += '    .logout-btn { background: none; border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; }\n';
        html += '    .logout-btn:hover { background: rgba(255,255,255,0.1); }\n';
        html += '    @media print { .nav-bar { display: none; } }\n';
        html += '  </style>\n';
        html += '</head>\n';
        html += '<body>\n';
        html += '  <div class="nav-bar">\n';
        html += '    <span class="brand">' + displayName + '</span>\n';
        html += '    <a href="/dashboard.html">Dashboard</a>\n';
        html += '    <span class="spacer"></span>\n';
        if (hasAuth) {
            html += '    <button class="logout-btn" onclick="logout()">Logout</button>\n';
        }
        html += '  </div>\n';
        html += '  <div class="container">\n';
        html += '    <h1>' + displayName + '</h1>\n';
        html += '    <p class="subtitle">Select a module to manage</p>\n';

        // Management modules
        html += '    <div class="section-title">Management</div>\n';
        for (const name of tableNames) {
            const display = name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
            const table = this.schemaRegistry.getTable(name);
            const fieldCount = table ? table.fields.length : 0;
            html += '    <div class="card">\n';
            html += '      <a href="/' + name.toLowerCase() + '.html">\n';
            html += '        <div>\n';
            html += '          <h3>' + display + '</h3>\n';
            html += '          <p>' + fieldCount + ' fields — Add, Edit, Deactivate records</p>\n';
            html += '        </div>\n';
            html += '        <span class="badge">Manage &rarr;</span>\n';
            html += '      </a>\n';
            html += '    </div>\n';
        }

        // Reports
        if (reports && reports.length > 0) {
            html += '    <div class="section-title">Reports</div>\n';
            for (const report of reports) {
                const title = report.title || report.name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
                html += '    <div class="card">\n';
                html += '      <a href="/' + report.name + '.html">\n';
                html += '        <div>\n';
                html += '          <h3>' + title + '</h3>\n';
                html += '          <p>View report data</p>\n';
                html += '        </div>\n';
                html += '        <span class="badge">View &rarr;</span>\n';
                html += '      </a>\n';
                html += '    </div>\n';
            }
        }

        html += '  </div>\n';
        html += '</body>\n';
        html += '</html>\n';
        return html;
    }

    /**
     * Generate a CRUD management page for a single table.
     * Includes: data table listing, add form, edit prefill, deactivate button.
     */
    _generateCrudPage(tableName) {
        const displayName = tableName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '<!-- Table not found -->';

        const fields = table.fields.filter(f => !f.pk);
        const pk = table.fields.find(f => f.pk);
        const pkName = pk ? pk.name : 'id';
        const api = '/api/' + tableName.toLowerCase();
        const hasStat = fields.some(f => f.name.toLowerCase().includes('stat'));

        // Detect FK fields for dropdown population
        const fkFields = fields.filter(f => f.fk);
        const fkFetchData = fkFields.map(f => `const ${f.fk.table}Data = await fetch('/api/${f.fk.table.toLowerCase()}').then(r => r.json());`).join('\n        ');
        const fkSelectPopulate = fkFields.map(f => {
            const selectId = `${tableName.toLowerCase()}_${f.name}`;
            return `
              const ${selectId} = document.getElementById('${selectId}');
              ${f.fk.table}Data.forEach(function(item) {
                const opt = document.createElement('option');
                opt.value = item.${this._getPK(f.fk.table)};
                opt.textContent = Object.values(item).filter(v => v !== null && v !== undefined).join(' - ');
                ${selectId}.appendChild(opt);
              });`;
        }).join('\n        ');
        const fkEditPopulate = fkFields.map(f => {
            const selectId = `${tableName.toLowerCase()}_${f.name}`;
            return `if (document.getElementById('${selectId}')) document.getElementById('${selectId}').value = row.${f.name};`;
        }).join('\n          ');

        let html = '';
        html += '<!DOCTYPE html>\n';
        html += '<html lang="en">\n';
        html += '<head>\n';
        html += '  <meta charset="UTF-8">\n';
        html += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
        html += '  <title>' + displayName + ' Management</title>\n';
        html += '  <script src="auth.js"></script>\n';
        html += '  <script>redirectIfNotAuthenticated();</script>\n';
        html += '  <style>\n';
        html += '    * { margin: 0; padding: 0; box-sizing: border-box; }\n';
        html += '    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f0f2f5; padding: 20px; }\n';
        html += '    .container { max-width: 960px; margin: 0 auto; }\n';
        html += '    h1 { color: #333; margin-bottom: 8px; font-size: 24px; }\n';
        html += '    .nav-bar { background: #0078d4; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 16px; }\n';
        html += '    .nav-bar a { color: #fff; text-decoration: none; font-size: 14px; padding: 4px 8px; border-radius: 4px; }\n';
        html += '    .nav-bar a:hover { background: rgba(255,255,255,0.15); }\n';
        html += '    .nav-bar .back { margin-left:auto; }\n';
        html += '    .card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }\n';
        html += '    .card h2 { font-size: 16px; color: #555; margin-bottom: 12px; }\n';
        html += '    input, select { width: 100%; padding: 8px 12px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }\n';
        html += '    input:focus, select:focus { outline: none; border-color: #0078d4; }\n';
        html += '    button { padding: 8px 16px; border: none; border-radius: 4px; font-size: 14px; cursor: pointer; }\n';
        html += '    .btn-primary { background: #0078d4; color: #fff; }\n';
        html += '    .btn-primary:hover { background: #005a9e; }\n';
        html += '    .btn-danger { background: #d32f2f; color: #fff; }\n';
        html += '    .btn-danger:hover { background: #b71c1c; }\n';
        html += '    .btn-sm { padding: 4px 10px; font-size: 12px; }\n';
        html += '    .btn-success { background: #388e3c; color: #fff; }\n';
        html += '    .btn-success:hover { background: #2e7d32; }\n';
        html += '    .btn-warning { background: #f57c00; color: #fff; }\n';
        html += '    .btn-warning:hover { background: #e65100; }\n';
        html += '    table { width: 100%; border-collapse: collapse; }\n';
        html += '    th { background: #f5f5f5; padding: 10px 12px; text-align: left; font-size: 13px; font-weight: 600; color: #555; border-bottom: 2px solid #ddd; }\n';
        html += '    td { padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px; }\n';
        html += '    tr:hover { background: #f8f9fa; }\n';
        html += '    .actions { display: flex; gap: 4px; }\n';
        html += '    .message { padding: 8px 12px; border-radius: 4px; margin-bottom: 8px; font-size: 13px; }\n';
        html += '    .message-success { background: #e8f5e9; color: #2e7d32; }\n';
        html += '    .message-error { background: #ffebee; color: #c62828; }\n';
        html += '    .form-row { display: flex; gap: 12px; }\n';
        html += '    .form-row > * { flex: 1; }\n';
        html += '    @media (max-width: 600px) { .form-row { flex-direction: column; } }\n';
        html += '  </style>\n';
        html += '</head>\n';
        html += '<body>\n';
        html += '  <div class="nav-bar">\n';
        html += '    <a href="/dashboard.html">&larr; Dashboard</a>\n';
        html += '    <span style="color:rgba(255,255,255,0.7);font-size:14px;margin-left:8px;">' + displayName + '</span>\n';
        html += '    <a class="back" href="/login.html" onclick="logout()">Logout</a>\n';
        html += '  </div>\n';
        html += '  <div class="container">\n';
        html += '    <h1>' + displayName + ' Management</h1>\n\n';

        // Form card
        html += '    <div class="card">\n';
        html += '      <h2 id="formTitle">Add ' + displayName + '</h2>\n';
        html += '      <form id="recordForm">\n';
        html += '        <div class="form-row">\n';

        // Generate input fields (2 per row)
        for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            const required = f.notNull ? ' required' : '';
            const label = f.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

            if (f.fk) {
                html += '          <div>\n';
                html += '            <label style="font-size:12px;color:#888;margin-bottom:2px;display:block;">' + label + '</label>\n';
                html += '            <select id="' + tableName.toLowerCase() + '_' + f.name + '" name="' + f.name + '"' + required + '>\n';
                html += '              <option value="">Select ' + f.fk.table + '</option>\n';
                html += '            </select>\n';
                html += '          </div>\n';
            } else if (f.type === 'REAL' || f.type === 'INTEGER') {
                html += '          <div>\n';
                html += '            <label style="font-size:12px;color:#888;margin-bottom:2px;display:block;">' + label + '</label>\n';
                html += '            <input type="number" name="' + f.name + '" step="' + (f.type === 'REAL' ? 'any' : '1') + '" placeholder="' + label + '"' + required + ' />\n';
                html += '          </div>\n';
            } else {
                html += '          <div>\n';
                html += '            <label style="font-size:12px;color:#888;margin-bottom:2px;display:block;">' + label + '</label>\n';
                html += '            <input type="text" name="' + f.name + '" placeholder="' + label + '"' + required + ' />\n';
                html += '          </div>\n';
            }

            // Close row every 2 fields or at the end
            if ((i + 1) % 2 === 0 && i + 1 < fields.length) {
                html += '        </div>\n';
                html += '        <div class="form-row">\n';
            }
        }

        // Close the last form-row if it didn't end with a 2-field group
        if (fields.length % 2 !== 0 && fields.length > 0) {
            html += '        </div>\n';
        }

        html += '        </div>\n';
        html += '        <div style="margin-top:12px;display:flex;gap:8px;">\n';
        html += '          <button type="submit" class="btn-primary" id="saveBtn">Add Record</button>\n';
        html += '          <button type="button" class="btn-warning" id="cancelBtn" style="display:none;" onclick="cancelEdit()">Cancel</button>\n';
        html += '        </div>\n';
        html += '      </form>\n';
        html += '      <div id="formMessage"></div>\n';
        html += '    </div>\n\n';

        // Table card
        html += '    <div class="card">\n';
        html += '      <h2>' + displayName + ' Records</h2>\n';
        html += '      <div id="recordsTable">\n';
        html += '        <p style="color:#888;font-size:13px;">Loading...</p>\n';
        html += '      </div>\n';
        html += '    </div>\n';
        html += '  </div>\n\n';

        // JavaScript
        html += '  <script>\n';
        html += '    const API = "' + api + '";\n';
        html += '    let editId = null;\n\n';

        html += '    // Load FK dropdown data on page load\n';
        html += '    async function loadFKData() {\n';
        html += '      try {\n';
        html += '        ' + fkFetchData + '\n';
        html += '        ' + fkSelectPopulate + '\n';
        html += '      } catch (e) { /* FK data not critical */ }\n';
        html += '    }\n\n';

        // Load records
        html += '    async function loadRecords() {\n';
        html += '      try {\n';
        html += '        const res = await authFetch(API);\n';
        html += '        if (!res.ok) throw new Error("Failed to load");\n';
        html += '        const data = await res.json();\n';
        html += '        const container = document.getElementById("recordsTable");\n';
        html += '        if (!data || data.length === 0) {\n';
        html += '          container.innerHTML = \'<p style="color:#888;padding:12px;text-align:center;">No records yet. Add one above.</p>\';\n';
        html += '          return;\n';
        html += '        }\n';
        html += '        let html = \'<table><thead><tr>\';\n';

        // Generate table headers
        for (const f of fields) {
            const label = f.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            html += "        html += '<th>" + label + "</th>';\\\n";
        }
        html += "        html += '<th>Actions</th></tr></thead><tbody>';\\\n";

        html += '        data.forEach(function(row) {\\\n';
        html += "          html += '<tr>';\\\n";
        for (const f of fields) {
            html += "          html += '<td>' + (row." + f.name + " !== null && row." + f.name + " !== undefined ? row." + f.name + " : '') + '</td>';\\\n";
        }
        html += "          html += '<td class=\"actions\">';\\\n";
        html += "          html += '<button class=\"btn-primary btn-sm\" onclick=\"editRecord(" + pkName + ")\">Edit</button> ';\\\n";
        if (hasStat) {
            html += "          html += '<button class=\"btn-danger btn-sm\" onclick=\"deactivateRecord(row." + pkName + ")\">Deactivate</button>';\\\n";
        } else {
            html += "          html += '<button class=\"btn-danger btn-sm\" onclick=\"deleteRecord(row." + pkName + ")\">Delete</button>';\\\n";
        }
        html += "          html += '</td></tr>';\\\n";
        html += '        });\\\n';
        html += "        html += '</tbody></table>';\\\n";
        html += '        container.innerHTML = html;\\\n';
        html += '      } catch (err) {\\\n';
        html += "        document.getElementById('recordsTable').innerHTML = '<p style=\"color:#d32f2f;\">Error: ' + err.message + '</p>';\\\n";
        html += '      }\\\n';
        html += '    }\\\n\n';

        // Form submit handler
        html += "    document.getElementById('recordForm').onsubmit = async function(e) {\\\n";
        html += '      e.preventDefault();\\\n';
        html += "      const form = e.target;\\\n";
        html += "      const data = Object.fromEntries(new FormData(form));\\\n";
        html += "      const msg = document.getElementById('formMessage');\\\n";
        html += '      try {\\\n';
        html += '        if (editId) {\\\n';
        html += "          await authFetch(API + '/' + editId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });\\\n";
        html += '          editId = null;\\\n';
        html += "          document.getElementById('saveBtn').textContent = 'Add Record';\\\n";
        html += "          document.getElementById('formTitle').textContent = 'Add " + displayName + "';\\\n";
        html += "          document.getElementById('cancelBtn').style.display = 'none';\\\n";
        html += "          msg.innerHTML = '<div class=\\\"message message-success\\\">Record updated successfully!</div>';\\\n";
        html += '        } else {\\\n';
        html += "          const res = await authFetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });\\\n";
        html += "          if (!res.ok) { const err = await res.json(); throw new Error(err.error); }\\\n";
        html += "          msg.innerHTML = '<div class=\\\"message message-success\\\">Record added successfully!</div>';\\\n";
        html += '        }\\\n';
        html += '        form.reset();\\\n';
        html += '        loadRecords();\\\n';
        html += "        setTimeout(function() { msg.innerHTML = ''; }, 3000);\\\n";
        html += '      } catch (err) {\\\n';
        html += "        msg.innerHTML = '<div class=\\\"message message-error\\\">' + err.message + '</div>';\\\n";
        html += '      }\\\n';
        html += '    };\\\n\n';

        // Edit record
        html += '    async function editRecord(id) {\
\\n';
        html += '      try {\\\n';
        html += '        const res = await authFetch(API + \'/\' + id);\\\n';
        html += '        if (!res.ok) throw new Error(\'Failed to fetch record\');\\\n';
        html += '        const row = await res.json();\
\\n';
        html += '        editId = id;\\\n';
        for (const f of fields) {
            if (f.fk) {
                html += '        ' + fkEditPopulate + '\\\n';
            } else {
                html += "        if (document.querySelector('[name=\\\"" + f.name + "\\\"]')) document.querySelector('[name=\\\"" + f.name + "\\\"]').value = row." + f.name + " != null ? row." + f.name + " : '';\\\n";
            }
        }
        html += "        document.getElementById('saveBtn').textContent = 'Update Record';\\\n";
        html += "        document.getElementById('formTitle').textContent = 'Edit " + displayName + "';\\\n";
        html += "        document.getElementById('cancelBtn').style.display = 'inline-block';\\\n";
        html += "        document.getElementById('formMessage').innerHTML = '';\\\n";
        html += '      } catch (err) {\n';
        html += "        alert('Error: ' + err.message);\n";
        html += '      }\n';
        html += '    }\n\n';

        // Cancel edit
        html += '    function cancelEdit() {\\\n';
        html += '      editId = null;\\\n';
        html += "      document.getElementById('recordForm').reset();\\\n";
        html += "      document.getElementById('saveBtn').textContent = 'Add Record';\\\n";
        html += "      document.getElementById('formTitle').textContent = 'Add " + displayName + "';\\\n";
        html += "      document.getElementById('cancelBtn').style.display = 'none';\\\n";
        html += "      document.getElementById('formMessage').innerHTML = '';\\\n";
        html += '    }\\\n\n';

        // Deactivate record
        if (hasStat) {
            html += '    async function deactivateRecord(id) {\\\n';
            html += "      if (!confirm('Deactivate this record?')) return;\\\n";
            html += '      try {\\\n';
            html += "        await authFetch(API + '/' + id, { method: 'DELETE' });\\\n";
            html += '        loadRecords();\\\n';
            html += "        document.getElementById('formMessage').innerHTML = '<div class=\\\"message message-success\\\">Record deactivated.</div>';\\\n";
            html += '      } catch (err) {\\\n';
            html += "        document.getElementById('formMessage').innerHTML = '<div class=\\\"message message-error\\\">' + err.message + '</div>';\\\n";
            html += '      }\\\n';
            html += '    }\\\n\n';
        } else {
            html += '    async function deleteRecord(id) {\\\n';
            html += "      if (!confirm('Delete this record?')) return;\\\n";
            html += '      try {\\\n';
            html += "        await authFetch(API + '/' + id, { method: 'DELETE' });\\\n";
            html += '        loadRecords();\\\n';
            html += '      } catch (err) {\\\n';
            html += '        alert(err.message);\\\n';
            html += '      }\\\n';
            html += '    }\\\n\n';
        }

        // Init
        html += '    loadFKData();\\\n';
        html += '    loadRecords();\\\n';
        html += '  </script>\\\n';
        html += '</body>\\\n';
        html += '</html>\\\n';

        return html;
    }

    _getPK(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return 'id';
        const pk = table.fields.find(f => f.pk);
        return pk ? pk.name : ((table.fields && table.fields[0]) ? table.fields[0].name : 'id');
    }
}

module.exports = { Scaffer };
