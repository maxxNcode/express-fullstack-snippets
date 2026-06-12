/**
 * AuthGenerator — generates login, register, and auth-related code
 * for any registered table with flexible identity fields.
 *
 * Features:
 * - Pick ANY table as the auth source (Items, Students, Voters, etc.)
 * - Pick 1, 2, 3+ identity fields (e.g. ID_NO + name)
 * - Pick 1 password field
 * - Optional status field for active/inactive check
 * - Generates login route, register route, JWT, login form HTML
 */
class AuthGenerator {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
    }

    /**
     * Generate login route code (server-side Express route).
     * @param {string} tableName - Any registered table (e.g. "Items", "Students")
     * @param {string[]} identityFields - Array of field names that identify the user (e.g. ["ID_NO", "name"])
     * @param {string} passwordField - Field name for the password hash
     * @param {string|null} statusField - Optional field for active/inactive check
     * @param {object} options - { useJwt: boolean, generateHtml: boolean, generateRegister: boolean }
     * @returns {string} Generated server route code
     */
    generateLogin(tableName, identityFields, passwordField, statusField, options = {}) {
        if (!tableName || !identityFields || identityFields.length === 0 || !passwordField) {
            return '// Auth: Missing required configuration (table, identity fields, password field)';
        }

        const useJwt = options.useJwt !== false; // default true
        const useBcrypt = options.useBcrypt !== false; // default true
        const pk = this._getPK(tableName);
        const tableLower = tableName.toLowerCase();

        // Build the WHERE clause from multiple identity fields
        const whereClauses = identityFields.map(f => `${f} = ?`).join(' AND ');

        let code = '';
        code += '// --- Auth: Login ---\n';
        if (useJwt) {
            code += "const jwt = require('jsonwebtoken');\n";
        }
        if (useBcrypt) {
            code += "const bcrypt = require('bcrypt');\n";
        }
        code += '\n';

        code += `app.post('/api/auth/login', (req, res) => {\n`;
        code += '  try {\n';
        // Destructure all identity fields + password from req.body
        const allFields = [...identityFields, passwordField];
        code += `    const { ${allFields.join(', ')} } = req.body;\n`;
        // SELECT with dynamic WHERE
        const identityParams = identityFields.map(f => `req.body.${f}`).join(', ');
        code += `    const row = db.prepare('SELECT * FROM ${tableName} WHERE ${whereClauses}').get(${identityParams});\n`;
        code += `    if (!row) return res.status(401).json({ error: 'Invalid credentials' });\n`;

        // Optional status check
        if (statusField) {
            code += `    if (row.${statusField} !== 'active') return res.status(403).json({ error: 'Account is not active' });\n`;
        }

        // Password comparison
        if (useBcrypt) {
            code += `    const valid = bcrypt.compareSync(${passwordField}, row.${passwordField});\n`;
        } else {
            code += `    const valid = (${passwordField} === row.${passwordField});\n`;
        }
        code += `    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });\n`;

        // JWT generation
        if (useJwt) {
            code += `    const token = jwt.sign({ id: row.${pk} }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });\n`;
            code += `    res.json({ token, user: { ${identityFields.map(f => `${f}: row.${f}`).join(', ')} } });\n`;
        } else {
            code += `    res.json({ user: { ${identityFields.map(f => `${f}: row.${f}`).join(', ')} } });\n`;
        }

        code += '  } catch (err) {\n';
        code += '    res.status(500).json({ error: err.message });\n';
        code += '  }\n';
        code += '});\n';

        return code;
    }

    /**
     * Generate register route code.
     * @param {string} tableName - The table to insert into
     * @param {string[]} allFields - All fields to include in registration
     * @param {string} passwordField - The password field (will be bcrypt-hashed)
     * @returns {string} Generated server route code
     */
    generateRegister(tableName, allFields, passwordField, options = {}) {
        if (!tableName || !allFields || allFields.length === 0 || !passwordField) {
            return '// Auth: Missing required configuration for register';
        }

        const useBcrypt = options.useBcrypt !== false; // default true
        const insertFields = allFields.join(', ');
        const insertPlaceholders = allFields.map(f => f === passwordField ? (useBcrypt ? 'hashedPassword' : `req.body.${f}`) : `req.body.${f}`).join(', ');

        let code = '';
        code += '// --- Auth: Register ---\n';
        if (useBcrypt) {
            code += "const bcrypt = require('bcrypt');\n";
        }
        code += '\n';

        code += `app.post('/api/auth/register', (req, res) => {\n`;
        code += '  try {\n';
        code += `    const { ${allFields.join(', ')} } = req.body;\n`;
        if (useBcrypt) {
            code += `    const hashedPassword = bcrypt.hashSync(${passwordField}, 10);\n`;
        }

        // Check for duplicate identity (first field)
        const firstIdentity = allFields[0];
        code += `    const existing = db.prepare('SELECT ${firstIdentity} FROM ${tableName} WHERE ${firstIdentity} = ?').get(req.body.${firstIdentity});\n`;
        code += `    if (existing) return res.status(409).json({ error: '${firstIdentity} already exists' });\n\n`;

        code += `    const result = db.prepare('INSERT INTO ${tableName} (${insertFields}) VALUES (${allFields.map(() => '?').join(', ')})').run(${insertPlaceholders});\n`;
        const pk = this._getPK(tableName);
        code += `    res.status(201).json({ ${pk}: result.lastInsertRowid });\n`;
        code += '  } catch (err) {\n';
        code += '    res.status(500).json({ error: err.message });\n';
        code += '  }\n';
        code += '});\n';

        return code;
    }

    /**
     * Generate login form HTML.
     * @param {string[]} identityFields - Fields for the login form inputs
     * @param {string} passwordField - Password field name
     * @returns {string} HTML form code
     */
    generateLoginFormHtml(tableName, identityFields, passwordField, options = {}) {
        const useJwt = options.useJwt !== false;
        const displayName = tableName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

        const identityInputs = identityFields.map(f => {
            const label = f.replace(/_/g, ' ');
            const labelCap = label.charAt(0).toUpperCase() + label.slice(1);
            return `    <input type="text" name="${f}" placeholder="${labelCap}" required />\n`;
        }).join('');

        let html = '';
        html += '<!-- --- Auth: Login Form --- -->\n';
        html += `<div id="loginContainer" class="auth-container">\n`;
        html += `  <h2>${displayName} Login</h2>\n`;
        html += `  <form id="loginForm" onsubmit="return handleLogin(event)">\n`;
        html += identityInputs;
        html += `    <input type="password" name="${passwordField}" placeholder="Password" required />\n`;
        html += `    <button type="submit">Log In</button>\n`;
        html += `    <p id="loginError" class="error-message" style="display:none;color:#f55;"></p>\n`;
        html += `  </form>\n`;
        html += '</div>\n\n';

        html += '<script>\n';
        html += 'async function handleLogin(e) {\n';
        html += '  e.preventDefault();\n';
        html += "  const form = e.target;\n";
        html += "  const data = Object.fromEntries(new FormData(form));\n";
        html += "  const errorEl = document.getElementById('loginError');\n";
        html += '  try {\n';
        html += "    const res = await fetch('/api/auth/login', {\n";
        html += "      method: 'POST',\n";
        html += "      headers: { 'Content-Type': 'application/json' },\n";
        html += "      body: JSON.stringify(data)\n";
        html += "    });\n";
        html += "    const result = await res.json();\n";
        html += "    if (!res.ok) { errorEl.textContent = result.error; errorEl.style.display = 'block'; return false; }\n";
        if (useJwt) {
            html += "    localStorage.setItem('token', result.token);\n";
        }
        html += "    window.location.href = '/dashboard.html';\n";
        html += '  } catch (err) {\n';
        html += "    errorEl.textContent = 'Connection error';\n";
        html += "    errorEl.style.display = 'block';\n";
        html += '  }\n';
        html += '  return false;\n';
        html += '}\n';
        html += '</script>\n';

        return html;
    }

    /**
     * Generate register form HTML with all fields and JS fetch handler.
     */
    generateRegisterFormHtml(tableName, passwordField, options = {}) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '<!-- Table not found -->';

        const displayName = tableName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        const pk = this._getPK(tableName);
        const allFields = table.fields;

        const inputs = allFields.map(f => {
            const label = f.name.replace(/_/g, ' ');
            const labelCap = label.charAt(0).toUpperCase() + label.slice(1);
            const required = f.notNull ? ' required' : '';

            if (f.name === passwordField) {
                return `    <input type="password" name="${f.name}" placeholder="${labelCap}" required />`;
            }
            if (f.pk && f.type === 'INTEGER') return ''; // autoincrement PK
            if (f.fk) {
                return `    <select name="${f.name}"${required}>\n        <option value="">Select ${f.fk.table}</option>\n    </select>`;
            }
            if (f.type === 'REAL' || f.type === 'INTEGER') {
                return `    <input type="number" name="${f.name}" placeholder="${labelCap}"${required} />`;
            }
            return `    <input type="text" name="${f.name}" placeholder="${labelCap}"${required} />`;
        }).filter(Boolean).join('\n');

        let html = '';
        html += '<!-- --- Auth: Register Form --- -->\n';
        html += `<div id="registerContainer" class="auth-container">\n`;
        html += `  <h2>${displayName} Register</h2>\n`;
        html += `  <form id="registerForm" onsubmit="return handleRegister(event)">\n`;
        html += inputs;
        html += `    <button type="submit">Register</button>\n`;
        html += `    <p id="registerError" class="error-message" style="display:none;color:#f55;"></p>\n`;
        html += `  </form>\n`;
        html += `  <p>Already registered? <a href="/login.html">Log in</a></p>\n`;
        html += '</div>\n\n';

        html += '<script>\n';
        html += 'async function handleRegister(e) {\n';
        html += '  e.preventDefault();\n';
        html += '  const form = e.target;\n';
        html += '  const data = Object.fromEntries(new FormData(form));\n';
        html += "  const errorEl = document.getElementById('registerError');\n";
        html += '  try {\n';
        html += "    const res = await fetch('/api/auth/register', {\n";
        html += "      method: 'POST',\n";
        html += "      headers: { 'Content-Type': 'application/json' },\n";
        html += "      body: JSON.stringify(data)\n";
        html += "    });\n";
        html += '    const result = await res.json();\n';
        html += "    if (!res.ok) { errorEl.textContent = result.error; errorEl.style.display = 'block'; return false; }\n";
        html += '    window.location.href = \'/login.html\';\n';
        html += '  } catch (err) {\n';
        html += "    errorEl.textContent = 'Connection error';\n";
        html += "    errorEl.style.display = 'block';\n";
        html += '  }\n';
        html += '  return false;\n';
        html += '}\n';
        html += '</script>\n';

        return html;
    }

    /**
     * Get the PK of a table.
     */
    _getPK(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return 'id';
        const pk = table.fields.find(f => f.pk);
        return pk ? pk.name : (table.fields[0]?.name || 'id');
    }

    /**
     * Auto-detect likely identity fields from a table.
     * Returns a string array of suggested identity field names.
     */
    detectIdentityFields(table) {
        if (!table || !table.fields) return [];
        const suggestions = [];
        // Prefer: email, username, user, or fields ending in ID
        const fieldNames = table.fields.map(f => f.name.toLowerCase());
        for (const f of table.fields) {
            const lower = f.name.toLowerCase();
            if (lower === 'email' || lower === 'username' || lower === 'user') {
                suggestions.push(f.name);
            }
        }
        // If no email/username found, pick fields ending in 'id' or containing 'id'
        if (suggestions.length === 0) {
            for (const f of table.fields) {
                const lower = f.name.toLowerCase();
                if (lower.endsWith('id') || lower.endsWith('no')) {
                    suggestions.push(f.name);
                    break;
                }
            }
        }
        // Last resort: first non-PK field
        if (suggestions.length === 0 && table.fields.length > 0) {
            const first = table.fields.find(f => !f.pk);
            if (first) suggestions.push(first.name);
            else suggestions.push(table.fields[0].name);
        }
        return suggestions;
    }

    /**
     * Auto-detect password field from a table.
     */
    detectPasswordField(table) {
        if (!table || !table.fields) return null;
        const lowerNames = table.fields.map(f => f.name.toLowerCase());
        // Prefer: password, pass, pwd
        for (const f of table.fields) {
            const lower = f.name.toLowerCase();
            if (lower === 'password' || lower === 'pass' || lower === 'pwd') {
                return f.name;
            }
        }
        return null;
    }

    /**
     * Auto-detect status field from a table.
     */
    detectStatusField(table) {
        if (!table || !table.fields) return null;
        for (const f of table.fields) {
            const lower = f.name.toLowerCase();
            if (lower.includes('stat')) {
                return f.name;
            }
        }
        return null;
    }
}

module.exports = { AuthGenerator };
