/**
 * AppGenerator — one-click orchestrator that combines
 * CRUD routes, HTML pages, and Auth generation into a single workflow.
 *
 * The user picks tables, picks what to generate per table, optionally
 * configures auth, and clicks one button to get everything.
 */
const { CodeGenerator } = require('./generator');
const { AuthGenerator } = require('./authGenerator');

class AppGenerator {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
        this.codeGen = new CodeGenerator(schemaRegistry);
        this.authGen = new AuthGenerator(schemaRegistry);
    }

    /**
     * Generate complete application code for selected tables.
     * @param {object[]} tableConfigs - Array of { tableName, crud, list, form, page, listJs, formJs }
     * @param {object|null} authConfig - Optional auth config { tableName, identityFields, passwordField, statusField, useJwt }
     * @param {object} options - { serverFile: 'server' | 'all', htmlFile: 'html' | 'all' }
     * @returns {{ server: string, html: string, js: string }}
     */
    generateApp(tableConfigs, authConfig, options = {}) {
        let serverCode = '';
        let htmlCode = '';
        let jsCode = '';

        if (!tableConfigs || tableConfigs.length === 0) {
            return { server: '// No tables selected', html: '', js: '' };
        }

        // 1. Generate code for each table
        for (const config of tableConfigs) {
            const table = this.schemaRegistry.getTable(config.tableName);
            if (!table) continue;

            // CRUD (prep statements + routes) — goes in server.js
            if (config.crud !== false) {
                serverCode += this.codeGen.generatePrepStatements(config.tableName) + '\n\n';
                serverCode += this.codeGen.generateCrudRoutes(config.tableName) + '\n\n';
            }

            // CREATE TABLE SQL
            if (config.createTable) {
                serverCode += this.codeGen.generateCreateTable(config.tableName) + '\n\n';
            }

            // HTML list — goes in index.html
            if (config.list) {
                htmlCode += this.codeGen.generateListHtml(config.tableName) + '\n\n';
            }

            // HTML form
            if (config.form) {
                htmlCode += this.codeGen.generateFormHtml(config.tableName) + '\n\n';
            }

            // Full page (form + list)
            if (config.page) {
                htmlCode += this.codeGen.generatePageHtml(config.tableName) + '\n\n';
            }

            // JS fetch + render
            if (config.listJs) {
                jsCode += this.codeGen.generateListJs(config.tableName) + '\n\n';
            }

            // JS form handlers
            if (config.formJs) {
                jsCode += this.codeGen.generateFormJs(config.tableName) + '\n\n';
            }
        }

        // 2. Generate Auth if configured
        if (authConfig && authConfig.tableName && authConfig.identityFields && authConfig.identityFields.length > 0 && authConfig.passwordField) {
            // Auth server route
            if (authConfig.generateRoute !== false) {
                serverCode += this.authGen.generateLogin(
                    authConfig.tableName,
                    authConfig.identityFields,
                    authConfig.passwordField,
                    authConfig.statusField || null,
                    { useJwt: authConfig.useJwt !== false }
                );
                serverCode += '\n\n';
            }

            // Auth register route
            if (authConfig.generateRegister) {
                const table = this.schemaRegistry.getTable(authConfig.tableName);
                const allFields = table ? table.fields.map(f => f.name) : [];
                serverCode += this.authGen.generateRegister(
                    authConfig.tableName, allFields, authConfig.passwordField
                );
                serverCode += '\n\n';
            }

            // Auth HTML form
            if (authConfig.generateHtml !== false) {
                htmlCode += this.authGen.generateLoginFormHtml(
                    authConfig.tableName,
                    authConfig.identityFields,
                    authConfig.passwordField,
                    { useJwt: authConfig.useJwt !== false }
                );
                htmlCode += '\n\n';
            }
        }

        // 3. Wrap with Express boilerplate if needed
        if (options.includeServerBoilerplate) {
            serverCode = this._wrapServer(serverCode);
        }
        if (options.includeHtmlBoilerplate) {
            htmlCode = this._wrapHtml(htmlCode);
        }

        return {
            server: serverCode,
            html: htmlCode,
            js: jsCode
        };
    }

    /**
     * Generate all code for a specific scenario (common test patterns).
     * @param {string} scenario - 'election', 'students', 'inventory', or 'custom'
     * @param {object} customConfig - Only used if scenario is 'custom'
     */
    generateScenario(scenario, customConfig) {
        const scenarios = {
            'election': {
                name: 'Election System',
                tables: ['Positions', 'Candidates', 'Voters', 'Votes'],
                descriptions: {
                    'Positions': 'Stores position names and slot counts',
                    'Candidates': 'Candidates linked to positions via FK',
                    'Voters': 'Voter info with password and status',
                    'Votes': 'Records which voter voted for which candidate'
                },
                authTable: 'Voters',
                authIdentity: ['voterID'],
                authPassword: 'password',
                authStatus: 'voterStat'
            },
            'students': {
                name: 'Student Records',
                tables: ['Sections', 'Students', 'Enrollments'],
                descriptions: {
                    'Sections': 'Class sections with capacity limits',
                    'Students': 'Student personal info',
                    'Enrollments': 'Links students to sections'
                }
            },
            'inventory': {
                name: 'Inventory System',
                tables: ['Categories', 'Products', 'Suppliers'],
                descriptions: {
                    'Categories': 'Product categories with display limits',
                    'Products': 'Items in stock with prices',
                    'Suppliers': 'Vendor/supplier information'
                }
            }
        };

        if (scenario === 'custom') {
            return customConfig || { server: '', html: '', js: '' };
        }

        const scenarioData = scenarios[scenario];
        if (!scenarioData) {
            return { server: `// Unknown scenario: ${scenario}`, html: '', js: '' };
        }

        // Build table configs based on scenario
        const tableConfigs = scenarioData.tables.map(name => ({
            tableName: name,
            crud: true,
            createTable: true,
            list: true,
            form: true,
            page: false
        }));

        // Build auth config if available
        let authConfig = null;
        if (scenarioData.authTable) {
            authConfig = {
                tableName: scenarioData.authTable,
                identityFields: scenarioData.authIdentity || [scenarioData.authTable.toLowerCase().replace(/s$/, '') + 'ID'],
                passwordField: scenarioData.authPassword || 'password',
                statusField: scenarioData.authStatus || null,
                useJwt: true,
                generateRoute: true,
                generateHtml: true
            };
        }

        return this.generateApp(tableConfigs, authConfig);
    }

    _wrapServer(code) {
        if (!code.trim()) return code;
        return `// --- Auto-generated by Express Full-Stack Snippets ---\n` +
            `const express = require('express');\n` +
            `const cors = require('cors');\n` +
            `const app = express();\n\n` +
            `app.use(cors());\n` +
            `app.use(express.json());\n\n` +
            `${code.trim()}\n\n` +
            `const PORT = process.env.PORT || 3000;\n` +
            `app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));\n`;
    }

    _wrapHtml(code) {
        if (!code.trim()) return code;
        return `<!DOCTYPE html>\n<html lang="en">\n<head>\n` +
            `  <meta charset="UTF-8">\n` +
            `  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n` +
            `  <title>My App</title>\n` +
            `  <style>\n` +
            `    * { margin: 0; padding: 0; box-sizing: border-box; }\n` +
            `    body { font-family: -apple-system, sans-serif; background: #f5f5f5; padding: 20px; }\n` +
            `    .container { max-width: 960px; margin: 0 auto; }\n` +
            `    table { width: 100%; border-collapse: collapse; background: #fff; }\n` +
            `    th, td { padding: 8px 12px; text-align: left; border: 1px solid #ddd; }\n` +
            `    th { background: #0078d4; color: #fff; }\n` +
            `    input, select, textarea { width: 100%; padding: 8px; margin: 4px 0; border: 1px solid #ccc; border-radius: 4px; }\n` +
            `    button { padding: 8px 16px; background: #0078d4; color: #fff; border: none; border-radius: 4px; cursor: pointer; }\n` +
            `    button:hover { background: #005a9e; }\n` +
            `    .card { background: #fff; border-radius: 8px; padding: 16px; margin: 8px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }\n` +
            `  </style>\n</head>\n<body>\n` +
            `  <div class="container">\n` +
            `    <h1>My App</h1>\n` +
            `${code.trim().split('\n').map(l => '    ' + l).join('\n')}\n` +
            `  </div>\n</body>\n</html>\n`;
    }
}

module.exports = { AppGenerator };
