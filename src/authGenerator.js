class AuthGenerator {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
    }

    generateLogin(tableName, identityFields, passwordField, statusField, options = {}) {
        if (!tableName || !identityFields || identityFields.length === 0 || !passwordField) {
            return '// Auth: Missing required configuration (table, identity fields, password field)';
        }

        const useJwt = options.useJwt !== false;
        const useBcrypt = options.useBcrypt !== false;
        const useRefreshToken = options.useRefreshToken !== false;
        const secretStorage = options.secretStorage || 'env';
        const jwtSecret = secretStorage === 'config' ? 'config.JWT_SECRET' : 'process.env.JWT_SECRET';
        const jwtRefreshSecret = secretStorage === 'config' ? 'config.JWT_REFRESH_SECRET' : 'process.env.JWT_REFRESH_SECRET';
        const pk = this._getPK(tableName);
        const whereClauses = identityFields.map(f => `${f} = ?`).join(' AND ');

        let code = '';
        code += '// ======================= Auth: Login Route =======================\n';
        code += '// PASTE THIS IN: server.js (inside the route section)\n';
        code += '// Requires: npm install jsonwebtoken bcrypt express-rate-limit\n';
        code += '// Also requires dotenv: npm install dotenv\n';
        code += '// =================================================================\n\n';

        if (useJwt) {
            code += "const jwt = require('jsonwebtoken');\n";
            if (secretStorage === 'config') {
                code += "const config = require('./config');\n";
            }
        }
        if (useBcrypt) {
            code += "const bcrypt = require('bcrypt');\n";
        }
        code += '\n';

        const allFields = [...identityFields, passwordField];
        code += `app.post('/api/auth/login', async (req, res) => {\n`;
        code += '  try {\n';
        code += `    const { ${allFields.join(', ')} } = req.body;\n`;
        const identityParams = identityFields.map(f => `req.body.${f}`).join(', ');
        code += `    const row = db.prepare('SELECT * FROM ${tableName} WHERE ${whereClauses}').get(${identityParams});\n`;
        code += `    if (!row) return res.status(401).json({ error: 'Invalid credentials' });\n`;

        if (statusField) {
            code += `    if (row.${statusField} !== 'active') return res.status(403).json({ error: 'Account is not active' });\n`;
        }

        if (useBcrypt) {
            code += `    const valid = await bcrypt.compare(${passwordField}, row.${passwordField});\n`;
        } else {
            code += `    const valid = (${passwordField} === row.${passwordField});\n`;
        }
        code += `    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });\n`;

        if (useJwt) {
            code += `    const token = jwt.sign(\n`;
            code += `      { id: row.${pk}, type: 'access' },\n`;
            code += `      ${jwtSecret},\n`;
            code += `      { expiresIn: '15m' }\n`;
            code += `    );\n`;
            if (useRefreshToken) {
                code += `    const refreshToken = jwt.sign(\n`;
                code += `      { id: row.${pk}, type: 'refresh' },\n`;
                code += `      ${jwtRefreshSecret},\n`;
                code += `      { expiresIn: '7d' }\n`;
                code += `    );\n`;
                code += `    res.json({ token, refreshToken, user: { ${identityFields.map(f => `${f}: row.${f}`).join(', ')} } });\n`;
            } else {
                code += `    res.json({ token, user: { ${identityFields.map(f => `${f}: row.${f}`).join(', ')} } });\n`;
            }
        } else {
            code += `    res.json({ user: { ${identityFields.map(f => `${f}: row.${f}`).join(', ')} } });\n`;
        }

        code += '  } catch (err) {\n';
        code += '    res.status(500).json({ error: err.message });\n';
        code += '  }\n';
        code += '});\n';

        return code;
    }

    generateRegister(tableName, allFields, passwordField, options = {}) {
        if (!tableName || !allFields || allFields.length === 0 || !passwordField) {
            return '// Auth: Missing required configuration for register';
        }

        const useBcrypt = options.useBcrypt !== false;
        const nonPkFields = allFields.filter(f => {
            if (f === passwordField) return true;
            const table = this.schemaRegistry.getTable(tableName);
            if (!table) return true;
            const fieldObj = table.fields.find(fo => fo.name === f);
            return !(fieldObj && fieldObj.pk && fieldObj.type === 'INTEGER');
        });
        const insertFields = nonPkFields.join(', ');
        const insertPlaceholders = nonPkFields.map(f => f === passwordField
            ? (useBcrypt ? 'hashedPassword' : `req.body.${f}`)
            : `req.body.${f}`
        ).join(', ');

        let code = '';
        code += '// ======================= Auth: Register Route =======================\n';
        code += '// PASTE THIS IN: server.js (inside the route section)\n';
        code += '// =================================================================\n\n';
        if (useBcrypt) {
            code += "const bcrypt = require('bcrypt');\n\n";
        }

        code += `app.post('/api/auth/register', async (req, res) => {\n`;
        code += '  try {\n';
        code += `    const { ${allFields.join(', ')} } = req.body;\n`;
        if (useBcrypt) {
            code += `    const hashedPassword = await bcrypt.hash(${passwordField}, 10);\n`;
        }

        const identityForDupCheck = options.identityFields || [];
        if (identityForDupCheck.length > 0) {
            const dupWhere = identityForDupCheck.map(f => `${f} = ?`).join(' OR ');
            const dupParams = identityForDupCheck.map(f => `req.body.${f}`).join(', ');
            code += `    const existing = db.prepare('SELECT ${identityForDupCheck[0]} FROM ${tableName} WHERE ${dupWhere}').get(${dupParams});\n`;
            const dupFields = identityForDupCheck.map(f => `'\${req.body.${f}}'`).join(' + " or " + ');
            code += `    if (existing) return res.status(409).json({ error: 'Account with ' + ${dupFields} + ' already exists' });\n\n`;
        } else {
            const firstField = nonPkFields[0] || allFields[0];
            code += `    const existing = db.prepare('SELECT ${firstField} FROM ${tableName} WHERE ${firstField} = ?').get(req.body.${firstField});\n`;
            code += `    if (existing) return res.status(409).json({ error: '${firstField} already exists' });\n\n`;
        }

        code += `    const result = db.prepare('INSERT INTO ${tableName} (${insertFields}) VALUES (${nonPkFields.map(() => '?').join(', ')})').run(${insertPlaceholders});\n`;
        const pk = this._getPK(tableName);
        code += `    res.status(201).json({ ${pk}: result.lastInsertRowid });\n`;
        code += '  } catch (err) {\n';
        code += '    res.status(500).json({ error: err.message });\n';
        code += '  }\n';
        code += '});\n';

        return code;
    }

    generateAuthMiddleware(tableName, identityFields, options = {}) {
        const useJwt = options.useJwt !== false;
        const useRefreshToken = options.useRefreshToken !== false;
        const useRateLimiter = options.useRateLimiter !== false;
        const secretStorage = options.secretStorage || 'env';
        const jwtSecret = secretStorage === 'config' ? 'config.JWT_SECRET' : 'process.env.JWT_SECRET';
        const jwtRefreshSecret = secretStorage === 'config' ? 'config.JWT_REFRESH_SECRET' : 'process.env.JWT_REFRESH_SECRET';

        let code = '';
        code += '// ======================= Auth: Middleware & Utilities =======================\n';
        code += '// PASTE THIS IN: server.js (before your protected routes)\n';
        code += '// ==========================================================================\n\n';

        if (!useJwt) {
            code += '// JWT not enabled. Skipping middleware generation.\n';
            return code;
        }

        code += "const jwt = require('jsonwebtoken');\n";
        if (secretStorage === 'config') {
            code += "const config = require('./config');\n";
        }
        code += '\n';

        // --- Rate Limiter (define FIRST, then apply to routes) ---
        if (useRateLimiter) {
            code += '// npm install express-rate-limit\n';
            code += "const rateLimit = require('express-rate-limit');\n";
            code += 'const authLimiter = rateLimit({\n';
            code += '  windowMs: 15 * 60 * 1000,\n';
            code += '  max: 10,\n';
            code += "  message: { error: 'Too many attempts, please try again after 15 minutes' }\n";
            code += '});\n';
            code += "app.use('/api/auth/login', authLimiter);\n\n";
        }

        // --- JWT Verification Middleware ---
        code += 'const authenticate = (req, res, next) => {\n';
        code += '  const header = req.headers.authorization;\n';
        code += '  if (!header || !header.startsWith(\'Bearer \')) {\n';
        code += '    return res.status(401).json({ error: \'No token provided\' });\n';
        code += '  }\n';
        code += '  const token = header.split(\' \')[1];\n';
        code += '  try {\n';
        code += `    const decoded = jwt.verify(token, ${jwtSecret});\n`;
        code += '    if (decoded.type !== \'access\') {\n';
        code += '      return res.status(401).json({ error: \'Invalid token type\' });\n';
        code += '    }\n';
        code += '    req.user = decoded;\n';
        code += '    next();\n';
        code += '  } catch (err) {\n';
        code += '    if (err.name === \'TokenExpiredError\') {\n';
        code += '      return res.status(401).json({ error: \'Token expired\', code: \'TOKEN_EXPIRED\' });\n';
        code += '    }\n';
        code += '    return res.status(401).json({ error: \'Invalid token\' });\n';
        code += '  }\n';
        code += '};\n\n';

        if (useRefreshToken) {
            code += '// --- Token Refresh Endpoint ---\n';
            code += "app.post('/api/auth/refresh', (req, res) => {\n";
            code += '  try {\n';
            code += '    const { refreshToken } = req.body;\n';
            code += '    if (!refreshToken) {\n';
            code += '      return res.status(400).json({ error: \'Refresh token required\' });\n';
            code += '    }\n';
            code += `    const decoded = jwt.verify(refreshToken, ${jwtRefreshSecret});\n`;
            code += '    if (decoded.type !== \'refresh\') {\n';
            code += '      return res.status(401).json({ error: \'Invalid token type\' });\n';
            code += '    }\n';
            code += '    const newToken = jwt.sign(\n';
            code += '      { id: decoded.id, type: \'access\' },\n';
            code += `      ${jwtSecret},\n`;
            code += '      { expiresIn: \'15m\' }\n';
            code += '    );\n';
            code += '    const newRefreshToken = jwt.sign(\n';
            code += '      { id: decoded.id, type: \'refresh\' },\n';
            code += `      ${jwtRefreshSecret},\n`;
            code += '      { expiresIn: \'7d\' }\n';
            code += '    );\n';
            code += '    res.json({ token: newToken, refreshToken: newRefreshToken });\n';
            code += '  } catch (err) {\n';
            code += '    return res.status(401).json({ error: \'Invalid or expired refresh token\' });\n';
            code += '  }\n';
            code += '});\n';
        }

        return code;
    }

    generateLogout(options = {}) {
        let code = '';
        code += '// ======================= Auth: Logout Route =======================\n';
        code += '// PASTE THIS IN: server.js (inside the route section)\n';
        code += '// =================================================================\n\n';

        code += "app.post('/api/auth/logout', (req, res) => {\n";
        code += '  res.json({ message: \'Logged out successfully\' });\n';
        code += '});\n';

        return code;
    }

    generateLoginFormHtml(tableName, identityFields, passwordField, options = {}) {
        const useJwt = options.useJwt !== false;
        const useRefreshToken = options.useRefreshToken !== false;
        // useAuthJs = true ONLY when the auth.js client library is actually generated
        // (i.e. JWT is on). When false, the form inlines a plain fetch so the page
        // is fully self-contained and works without auth.js.
        const useAuthJs = options.useAuthJs !== undefined ? options.useAuthJs : useJwt;
        const dashboardPath = options.dashboardPath || '/dashboard.html';
        const displayName = tableName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

        const identityInputs = identityFields.map(f => {
            const label = f.replace(/_/g, ' ');
            const labelCap = label.charAt(0).toUpperCase() + label.slice(1);
            return `    <input type="text" name="${f}" placeholder="${labelCap}" required />\n`;
        }).join('');

        let html = '';
        html += '<!-- ========= Auth: Login Form ========= -->\n';
        html += '// SAVE THIS AS: login.html (place in your public/ folder)\n';
        if (useAuthJs) {
            html += '// IMPORTANT: Include auth.js BEFORE this file:\n';
            html += '//   <script src="auth.js"></script>\n';
            html += '//   <script>redirectIfAuthenticated();</script>\n';
        } else {
            html += '// Self-contained: no auth.js required. Calls /api/auth/login directly.\n';
        }
        html += '// ===================================== -->\n';
        html += '<!DOCTYPE html>\n';
        html += '<html lang="en">\n';
        html += '<head>\n';
        html += '  <meta charset="UTF-8">\n';
        html += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
        html += '  <title>Login - ' + displayName + '</title>\n';
        if (useAuthJs) {
            html += '  <script src="auth.js"></script>\n';
            html += '  <script>redirectIfAuthenticated();</script>\n';
        }
        html += '  <style>\n';
        html += '    * { margin: 0; padding: 0; box-sizing: border-box; }\n';
        html += '    body { font-family: -apple-system, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; }\n';
        html += '    .auth-container { background: #fff; padding: 32px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }\n';
        html += '    h2 { margin-bottom: 20px; color: #333; }\n';
        html += '    input { width: 100%; padding: 10px; margin: 6px 0; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }\n';
        html += '    button { width: 100%; padding: 10px; background: #0078d4; color: #fff; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; margin-top: 10px; }\n';
        html += '    button:hover { background: #005a9e; }\n';
        html += '    .error-message { margin-top: 10px; }\n';
        html += '    .auth-link { display: block; text-align: center; margin-top: 16px; color: #666; }\n';
        html += '  </style>\n';
        html += '</head>\n';
        html += '<body>\n';
        html += `<div class="auth-container">\n`;
        html += `  <h2>${displayName} Login</h2>\n`;
        html += `  <form id="loginForm">\n`;
        html += identityInputs;
        html += `    <input type="password" name="${passwordField}" placeholder="Password" required />\n`;
        html += `    <button type="submit">Log In</button>\n`;
        html += `    <p id="loginError" class="error-message" style="display:none;color:#f55;"></p>\n`;
        html += `  </form>\n`;
        html += `  <a href="/register.html" class="auth-link">Don't have an account? Register</a>\n`;
        html += '</div>\n\n';

        html += '<script>\n';
        html += `document.getElementById('loginForm').onsubmit = async (e) => {\n`;
        html += '  e.preventDefault();\n';
        html += "  const data = Object.fromEntries(new FormData(e.target));\n";
        html += "  const errorEl = document.getElementById('loginError');\n";
        html += "  function showError(msg) { errorEl.textContent = msg; errorEl.style.display = 'block'; }\n";
        html += '  try {\n';
        if (useAuthJs) {
            // Use the auth.js client library (handles token storage + refresh)
            html += '    await login(data);\n';
            html += '    redirectToDashboard();\n';
        } else {
            // Self-contained: plain fetch, no auth.js dependency
            html += "    const res = await fetch('/api/auth/login', {\n";
            html += "      method: 'POST',\n";
            html += "      headers: { 'Content-Type': 'application/json' },\n";
            html += '      body: JSON.stringify(data)\n';
            html += '    });\n';
            html += '    const result = await res.json();\n';
            html += '    if (!res.ok) throw new Error(result.error || \'Login failed\');\n';
            if (useJwt) {
                // JWT path but without auth.js: store tokens manually, then redirect
                html += '    if (result.token) localStorage.setItem(\'token\', result.token);\n';
                if (useRefreshToken) {
                    html += '    if (result.refreshToken) localStorage.setItem(\'refreshToken\', result.refreshToken);\n';
                }
            }
            html += `    window.location.href = '${dashboardPath}';\n`;
        }
        html += '  } catch (err) {\n';
        html += '    showError(err.message);\n';
        html += '  }\n';
        html += '};\n';
        html += '</script>\n';
        html += '</body>\n';
        html += '</html>\n';

        return html;
    }

    generateRegisterFormHtml(tableName, passwordField, options = {}) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '<!-- Table not found -->';

        const useJwt = options.useJwt !== false;
        const useAuthJs = options.useAuthJs !== undefined ? options.useAuthJs : useJwt;
        const displayName = tableName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        const allFields = table.fields;

        const inputs = allFields.map(f => {
            const label = f.name.replace(/_/g, ' ');
            const labelCap = label.charAt(0).toUpperCase() + label.slice(1);
            const required = f.notNull ? ' required' : '';

            if (f.name === passwordField) {
                return `    <input type="password" name="${f.name}" placeholder="${labelCap}" required />`;
            }
            if (f.pk && f.type === 'INTEGER') return '';
            if (f.fk) {
                return `    <select name="${f.name}"${required}>\n        <option value="">Select ${f.fk.table}</option>\n    </select>`;
            }
            if (f.type === 'REAL' || f.type === 'INTEGER') {
                return `    <input type="number" name="${f.name}" placeholder="${labelCap}"${required} />`;
            }
            return `    <input type="text" name="${f.name}" placeholder="${labelCap}"${required} />`;
        }).filter(Boolean).join('\n');

        let html = '';
        html += '<!-- ========= Auth: Register Form ========= -->\n';
        html += '// SAVE THIS AS: register.html (place in your public/ folder)\n';
        if (useAuthJs) {
            html += '// IMPORTANT: Include auth.js BEFORE this file:\n';
            html += '//   <script src="auth.js"></script>\n';
            html += '//   <script>redirectIfAuthenticated();</script>\n';
        } else {
            html += '// Self-contained: no auth.js required. Calls /api/auth/register directly.\n';
        }
        html += '// ========================================= -->\n';
        html += '<!DOCTYPE html>\n';
        html += '<html lang="en">\n';
        html += '<head>\n';
        html += '  <meta charset="UTF-8">\n';
        html += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
        html += '  <title>Register - ' + displayName + '</title>\n';
        if (useAuthJs) {
            html += '  <script src="auth.js"></script>\n';
            html += '  <script>redirectIfAuthenticated();</script>\n';
        }
        html += '  <style>\n';
        html += '    * { margin: 0; padding: 0; box-sizing: border-box; }\n';
        html += '    body { font-family: -apple-system, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }\n';
        html += '    .auth-container { background: #fff; padding: 32px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); width: 100%; max-width: 500px; }\n';
        html += '    h2 { margin-bottom: 20px; color: #333; }\n';
        html += '    input, select { width: 100%; padding: 10px; margin: 6px 0; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }\n';
        html += '    button { width: 100%; padding: 10px; background: #0078d4; color: #fff; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; margin-top: 10px; }\n';
        html += '    button:hover { background: #005a9e; }\n';
        html += '    .error-message { margin-top: 10px; }\n';
        html += '    .auth-link { display: block; text-align: center; margin-top: 16px; color: #666; }\n';
        html += '  </style>\n';
        html += '</head>\n';
        html += '<body>\n';
        html += `<div class="auth-container">\n`;
        html += `  <h2>${displayName} Register</h2>\n`;
        html += `  <form id="registerForm">\n`;
        html += inputs;
        html += `    <button type="submit">Register</button>\n`;
        html += `    <p id="registerError" class="error-message" style="display:none;color:#f55;"></p>\n`;
        html += `  </form>\n`;
        html += `  <a href="/login.html" class="auth-link">Already registered? Log in</a>\n`;
        html += '</div>\n\n';

        html += '<script>\n';
        html += `document.getElementById('registerForm').onsubmit = async (e) => {\n`;
        html += '  e.preventDefault();\n';
        html += '  const data = Object.fromEntries(new FormData(e.target));\n';
        html += "  const errorEl = document.getElementById('registerError');\n";
        html += "  function showError(msg) { errorEl.textContent = msg; errorEl.style.display = 'block'; }\n";
        html += '  try {\n';
        if (useAuthJs) {
            html += '    await register(data);\n';
            html += "    window.location.href = '/login.html';\n";
        } else {
            // Self-contained: plain fetch, no auth.js dependency
            html += "    const res = await fetch('/api/auth/register', {\n";
            html += "      method: 'POST',\n";
            html += "      headers: { 'Content-Type': 'application/json' },\n";
            html += '      body: JSON.stringify(data)\n';
            html += '    });\n';
            html += '    const result = await res.json();\n';
            html += '    if (!res.ok) throw new Error(result.error || \'Registration failed\');\n';
            html += "    window.location.href = '/login.html';\n";
        }
        html += '  } catch (err) {\n';
        html += '    showError(err.message);\n';
        html += '  }\n';
        html += '};\n';
        html += '</script>\n';
        html += '</body>\n';
        html += '</html>\n';

        return html;
    }

    generateEnvContent(tableName, options = {}) {
        const useJwt = options.useJwt !== false;
        const useRefreshToken = options.useRefreshToken !== false;
        const secretStorage = options.secretStorage || 'env';
        const dbStorage = options.dbStorage || 'server';
        const storeSecretsHere = secretStorage === 'config';
        let code = '';
        code += '# ======================= .env File =======================\n';
        code += '# CREATE THIS FILE: .env (in your project root)\n';
        code += '# Then add this to server.js at the VERY TOP:\n';
        code += '#   require("dotenv").config();\n';
        code += '# Install: npm install dotenv\n';
        code += '# =========================================================\n\n';

        if (useJwt && !storeSecretsHere) {
            code += '# JWT Secret — CHANGE THIS to a random 64-char string\n';
            code += '# Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n';
            code += 'JWT_SECRET=your_super_secret_key_change_me_to_random_64_chars\n\n';
            if (useRefreshToken) {
                code += '# JWT Refresh Secret — also change this\n';
                code += 'JWT_REFRESH_SECRET=your_refresh_secret_change_me_too\n\n';
            }
        }

        if (dbStorage === 'env') {
            code += '# Database file path\n';
            code += 'DB_PATH=data.db\n\n';
        }

        return code;
    }

    generateConfigJs(options = {}) {
        const useJwt = options.useJwt !== false;
        const useRefreshToken = options.useRefreshToken !== false;
        const dbStorage = options.dbStorage || 'server';
        let code = '';
        code += '// ======================= config.js =======================\n';
        code += '// CREATE THIS FILE: config.js (in your project root)\n';
        code += '// Then add this to server.js at the top:\n';
        code += '//   const config = require(\'./config\');\n';
        code += '// =========================================================\n\n';
        code += 'module.exports = {\n';
        if (dbStorage === 'config') {
            code += "  DB_PATH: 'data.db',\n\n";
        }
        if (useJwt) {
            code += '  // JWT Secret — CHANGE THIS to a random 64-char string\n';
            code += "  JWT_SECRET: 'your_super_secret_key_change_me_to_random_64_chars',\n\n";
            if (useRefreshToken) {
                code += '  // JWT Refresh Secret — also change this\n';
                code += "  JWT_REFRESH_SECRET: 'your_refresh_secret_change_me_too',\n\n";
            }
        }
        code += '};\n';
        return code;
    }

    generateSetupGuide(tableName, identityFields, passwordField, options = {}) {
        const useJwt = options.useJwt !== false;
        const useBcrypt = options.useBcrypt !== false;
        const useRefreshToken = options.useRefreshToken !== false;
        const secretStorage = options.secretStorage || 'env';
        const storeSecretsHere = secretStorage === 'config';
        const dbStorage = options.dbStorage || 'server';

        // Detect which sections were actually generated so the guide only mentions them.
        const genLoginRoute   = options.generateRoute !== false;
        const genRegisterRoute = !!options.generateRegister;
        const genLogout        = !!options.generateLogout;
        const genMiddleware    = useJwt && (genLoginRoute || genRegisterRoute);
        const envNeededForJwt  = useJwt && secretStorage === 'env';
        const envNeededForDb   = dbStorage === 'env';
        const genEnv           = envNeededForJwt || envNeededForDb;
        const genConfigJs      = secretStorage === 'config' || dbStorage === 'config';
        const genAuthJs        = options.useAuthJs !== false && useJwt && (options.generateHtml !== false || !!options.generateRegisterHtml);
        const genLoginHtml     = options.generateHtml !== false;
        const genRegisterHtml  = !!options.generateRegisterHtml;
        const needConfigRequire = genConfigJs && (useJwt || dbStorage === 'config');

        // Build npm install list (only what's actually needed)
        const deps = ['express', 'better-sqlite3', 'cors'];
        if (genEnv) deps.push('dotenv');
        if (useJwt) deps.push('jsonwebtoken');
        if (useBcrypt) deps.push('bcrypt');

        let code = '';
        code += '/*\n';
        code += ' * ======================= SETUP INSTRUCTIONS =======================\n';
        code += ' * Follow these steps to integrate the generated auth code.\n';
        code += ' * Only the items you selected are listed below.\n';
        code += ' * ==================================================================\n';
        code += ' *\n';
        code += ' * 1. INSTALL DEPENDENCIES\n';
        code += ' *    Run in your project root:\n';
        code += ` *      npm install ${deps.join(' ')}\n`;
        code += ' *\n';
        code += ' * 2. ADD THESE REQUIRES TO server.js (at the very top)\n';
        if (genEnv) {
            code += ' *      require("dotenv").config();\n';
        }
        if (needConfigRequire) {
            code += ' *      const config = require(\'./config\');\n';
        }
        code += ' *\n';

        let step = 3;

        if (genEnv) {
            code += ` * ${step}. CREATE .env FILE\n`;
            code += ' *    Create a .env file in project root with:\n';
            if (dbStorage === 'env') {
                code += ' *      DB_PATH=data.db\n';
            }
            if (useJwt && secretStorage === 'env') {
                code += ' *      JWT_SECRET=<random 64-char hex string>\n';
                if (useRefreshToken) {
                    code += ' *      JWT_REFRESH_SECRET=<another random string>\n';
                }
            }
            code += ' *\n';
            step++;
        }
        if (genConfigJs) {
            code += ` * ${step}. CREATE config.js FILE\n`;
            code += ' *    Create a config.js file in project root with:\n';
            code += ' *      module.exports = {\n';
            if (dbStorage === 'config') {
                code += ' *        DB_PATH: \'data.db\',\n';
            }
            if (useJwt) {
                code += ' *        JWT_SECRET: \'<random 64-char hex string>\',\n';
                if (useRefreshToken) {
                    code += ' *        JWT_REFRESH_SECRET: \'<another random string>\',\n';
                }
            }
            code += ' *      };\n';
            code += ' *\n';
            step++;
        }

        // List only the sections the user actually generated
        if (genLoginRoute || genRegisterRoute || genLogout || genMiddleware) {
            code += ` * ${step}. SERVER CODE (paste into server.js)\n`;
            if (genLoginRoute)
                code += ' *    - Login route      -> paste after db setup, before app.listen\n';
            if (genRegisterRoute)
                code += ' *    - Register route   -> paste after db setup, before app.listen\n';
            if (genLogout)
                code += ' *    - Logout route     -> paste after db setup, before app.listen\n';
            if (genMiddleware) {
                code += ' *    - Auth middleware   -> paste before any protected routes\n';
                code += ' *      Then use it: app.get("/api/items", authenticate, handler);\n';
            }
            code += ' *\n';
            step++;
        }

        if (genLoginHtml || genRegisterHtml || genAuthJs) {
            code += ` * ${step}. CLIENT FILES (place in your public/ folder)\n`;
            if (genAuthJs)
                code += ' *    - auth.js          -> save as public/auth.js\n';
            if (genLoginHtml)
                code += ' *    - Login form       -> save as public/login.html\n';
            if (genRegisterHtml)
                code += ' *    - Register form    -> save as public/register.html\n';
            code += ' *\n';
            step++;
        }

        code += ` * ${step}. CREATE THE DATABASE TABLE\n`;
        code += ' *    Make sure you have registered the "' + tableName + '" table\n';
        code += ' *    using the Schema Visualizer or njs:register command.\n';
        code += ' *    Then generate the CREATE TABLE SQL from the Tables tab.\n';
        code += ' * ==================================================================\n';
        code += ' */\n';

        return code;
    }

    _getPK(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return 'id';
        const pk = table.fields.find(f => f.pk);
        return pk ? pk.name : (table.fields[0]?.name || 'id');
    }

    detectIdentityFields(table) {
        if (!table || !table.fields) return [];
        const suggestions = [];
        const fieldNames = table.fields.map(f => f.name.toLowerCase());
        for (const f of table.fields) {
            const lower = f.name.toLowerCase();
            if (lower === 'email' || lower === 'username' || lower === 'user') {
                suggestions.push(f.name);
            }
        }
        if (suggestions.length === 0) {
            for (const f of table.fields) {
                const lower = f.name.toLowerCase();
                if (lower.endsWith('id') || lower.endsWith('no')) {
                    suggestions.push(f.name);
                    break;
                }
            }
        }
        if (suggestions.length === 0 && table.fields.length > 0) {
            const first = table.fields.find(f => !f.pk);
            if (first) suggestions.push(first.name);
            else suggestions.push(table.fields[0].name);
        }
        return suggestions;
    }

    detectPasswordField(table) {
        if (!table || !table.fields) return null;
        const lowerNames = table.fields.map(f => f.name.toLowerCase());
        for (const f of table.fields) {
            const lower = f.name.toLowerCase();
            if (lower === 'password' || lower === 'pass' || lower === 'pwd') {
                return f.name;
            }
        }
        return null;
    }

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

    /**
     * Generate a complete client-side auth.js library.
     * Include this in EVERY HTML page via <script src="auth.js"></script>
     * before your page-specific scripts.
     */
    generateAuthClientJs(options = {}) {
        const useJwt = options.useJwt !== false;
        const useRefreshToken = options.useRefreshToken !== false;
        const hasRegister = !!options.generateRegister;
        const hasLogout = !!options.generateLogout;

        let code = '';
        code += '// ======================= auth.js =======================\n';
        code += '// SAVE THIS AS: public/auth.js (or js/auth.js)\n';
        code += '// INCLUDE IN EVERY PAGE:\n';
        code += '//   <script src="auth.js"></script>\n';
        code += '// =======================================================\n\n';

        code += '// --- Configuration ---\n';
        code += 'const AUTH_CONFIG = {\n';
        code += "  loginPath: '/login.html',\n";
        code += "  loginApi: '/api/auth/login',\n";
        if (hasRegister) {
            code += "  registerApi: '/api/auth/register',\n";
        }
        if (useRefreshToken) {
            code += "  refreshApi: '/api/auth/refresh',\n";
        }
        if (hasLogout) {
            code += "  logoutApi: '/api/auth/logout',\n";
        }
        code += "  dashboardPath: '/dashboard.html',\n";
        code += hasRegister
            ? "  publicPaths: ['/login.html', '/register.html']\n"
            : "  publicPaths: ['/login.html']\n";
        code += '};\n\n';

        code += `// --- Token Storage ---\n`;
        if (useRefreshToken) {
            code += "const TokenKeys = { access: 'token', refresh: 'refreshToken' };\n\n";
            code += 'function getRefreshToken() { return localStorage.getItem(TokenKeys.refresh); }\n';
        } else {
            code += "const TokenKeys = { access: 'token' };\n\n";
        }

        code += 'function getToken() { return localStorage.getItem(TokenKeys.access); }\n';
        code += 'function setTokens(access, refresh) {\n';
        code += '  localStorage.setItem(TokenKeys.access, access);\n';
        if (useRefreshToken) {
            code += '  if (refresh) localStorage.setItem(TokenKeys.refresh, refresh);\n';
        }
        code += '}\n';
        code += 'function clearTokens() {\n';
        code += '  localStorage.removeItem(TokenKeys.access);\n';
        if (useRefreshToken) {
            code += '  localStorage.removeItem(TokenKeys.refresh);\n';
        }
        code += '}\n\n';

        code += '// --- Decode JWT payload (client-side only — no signature verification) ---\n';
        code += 'function decodeToken(token) {\n';
        code += '  try { return JSON.parse(atob(token.split(\'.\')[1])); }\n';
        code += '  catch (e) { return null; }\n';
        code += '}\n\n';

        code += '// --- Check if a token exists in storage ---\n';
        code += 'function isAuthenticated() {\n';
        code += '  return !!getToken();\n';
        code += '}\n\n';

        code += '// --- Extract current user info from the stored token ---\n';
        code += 'function getUser() {\n';
        code += '  return decodeToken(getToken());\n';
        code += '}\n\n';

        if (useRefreshToken) {
            code += 'async function refreshAccessToken() {\n';
            code += '  const rt = getRefreshToken();\n';
            code += '  if (!rt) { clearTokens(); redirectToLogin(); return null; }\n';
            code += '  const res = await fetch(AUTH_CONFIG.refreshApi, {\n';
            code += "    method: 'POST',\n";
            code += "    headers: { 'Content-Type': 'application/json' },\n";
            code += '    body: JSON.stringify({ refreshToken: rt })\n';
            code += '  });\n';
            code += '  if (!res.ok) { clearTokens(); redirectToLogin(); return null; }\n';
            code += '  const data = await res.json();\n';
            code += '  setTokens(data.token, data.refreshToken);\n';
            code += '  return data.token;\n';
            code += '}\n\n';
            code += 'async function getValidToken() {\n';
            code += '  const token = getToken();\n';
            code += '  if (!token) return null;\n';
            code += '  const payload = decodeToken(token);\n';
            code += '  if (payload && payload.exp > Math.floor(Date.now() / 1000) + 60) return token;\n';
            code += '  return await refreshAccessToken();\n';
            code += '}\n\n';
        } else {
            code += '// --- Get stored token (no refresh mechanism) ---\n';
            code += 'function getValidToken() {\n';
            code += '  return getToken();\n';
            code += '}\n\n';
        }

        code += '// --- Authenticated fetch — auto-attaches Bearer, handles 401 ---\n';
        code += 'async function authFetch(url, options = {}) {\n';
        code += '  const token = await getValidToken();\n';
        code += '  if (!token) {\n';
        code += '    clearTokens();\n';
        code += '    redirectToLogin();\n';
        code += "    throw new Error('Not authenticated');\n";
        code += '  }\n';
        code += '  options.headers = options.headers || {};\n';
        code += "  options.headers['Authorization'] = 'Bearer ' + token;\n";
        code += '  const res = await fetch(url, options);\n';
        code += '  if (res.status === 401) {\n';
        code += '    clearTokens();\n';
        code += '    redirectToLogin();\n';
        code += "    throw new Error('Session expired');\n";
        code += '  }\n';
        code += '  return res;\n';
        code += '}\n\n';

        code += '// --- Login ---\n';
        code += 'async function login(credentials) {\n';
        code += '  const res = await fetch(AUTH_CONFIG.loginApi, {\n';
        code += "    method: 'POST',\n";
        code += "    headers: { 'Content-Type': 'application/json' },\n";
        code += '    body: JSON.stringify(credentials)\n';
        code += '  });\n';
        code += '  const data = await res.json();\n';
        code += '  if (!res.ok) throw new Error(data.error || \'Login failed\');\n';
        if (useRefreshToken) {
            code += '  setTokens(data.token, data.refreshToken);\n';
        } else {
            code += '  setTokens(data.token);\n';
        }
        code += '  return data;\n';
        code += '}\n\n';

        if (hasRegister) {
            code += '// --- Register ---\n';
            code += 'async function register(userData) {\n';
            code += '  const res = await fetch(AUTH_CONFIG.registerApi, {\n';
            code += "    method: 'POST',\n";
            code += "    headers: { 'Content-Type': 'application/json' },\n";
            code += '    body: JSON.stringify(userData)\n';
            code += '  });\n';
            code += '  const data = await res.json();\n';
            code += '  if (!res.ok) throw new Error(data.error || \'Registration failed\');\n';
            code += '  return data;\n';
            code += '}\n\n';
        }

        if (hasLogout) {
            code += '// --- Logout (notifies server + clears local state) ---\n';
            code += 'async function logout() {\n';
            code += '  try {\n';
            code += '    const token = getToken();\n';
            code += '    if (token) {\n';
            code += '      await fetch(AUTH_CONFIG.logoutApi, {\n';
            code += "        method: 'POST',\n";
            code += "        headers: { 'Authorization': 'Bearer ' + token }\n";
            code += '      });\n';
            code += '    }\n';
            code += '  } catch (e) { /* server notification is best-effort */ }\n';
            code += '  clearTokens();\n';
            code += '  redirectToLogin();\n';
            code += '}\n\n';
        }

        code += '// --- Navigation helpers ---\n';
        code += 'function redirectToLogin() {\n';
        code += "  if (!AUTH_CONFIG.publicPaths.includes(window.location.pathname)) {\n";
        code += '    window.location.href = AUTH_CONFIG.loginPath;\n';
        code += '  }\n';
        code += '}\n\n';

        code += 'function redirectToDashboard() {\n';
        code += '  window.location.href = AUTH_CONFIG.dashboardPath;\n';
        code += '}\n\n';

        code += '// --- Page guard: redirect to login if not authenticated ---\n';
        code += '// Call at the top of protected pages:\n';
        code += '//   <script src="auth.js"></script>\n';
        code += '//   <script>redirectIfNotAuthenticated();</script>\n';
        code += 'async function redirectIfNotAuthenticated() {\n';
        code += '  const token = await getValidToken();\n';
        code += '  if (!token) redirectToLogin();\n';
        code += '}\n\n';

        code += '// Call on login/register pages — redirects to dashboard if already logged in\n';
        code += 'function redirectIfAuthenticated() {\n';
        code += '  if (isAuthenticated()) redirectToDashboard();\n';
        code += '}\n\n';

        code += '// --- Usage examples ---\n';
        code += '/*\n';
        code += ' * === login.html ===\n';
        code += ' * <script src="auth.js"></script>\n';
        code += ' * <script>redirectIfAuthenticated();</script>\n';
        code += ' *\n';
        code += ' * === register.html ===\n';
        code += ' * <script src="auth.js"></script>\n';
        code += ' * <script>redirectIfAuthenticated();</script>\n';
        code += ' *\n';
        code += ' * === Protected page (dashboard.html, etc.) ===\n';
        code += ' * <script src="auth.js"></script>\n';
        code += ' * <script>redirectIfNotAuthenticated();</script>\n';
        code += ' *\n';
        code += ' * === Calling APIs ===\n';
        code += ' * const data = await authFetch("/api/items").then(r => r.json());\n';
        code += ' *\n';
        code += ' * === Logout button ===\n';
        code += ' * <button onclick="logout()">Logout</button>\n';
        code += ' *\n';
        code += ' * === Get current user ===\n';
        code += " * const user = getUser(); // { id: 1, type: 'access', exp: ... }\n";
        code += ' *\n';
        code += ' * === Login form handler ===\n';
        code += ' * await login({ email: "...", password: "..." });\n';
        code += ' * redirectToDashboard();\n';
        code += ' */\n';

        return code;
    }
}

module.exports = { AuthGenerator };
