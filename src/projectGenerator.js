const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { Scaffer } = require('./scaffolder');
const { AuthGenerator } = require('./authGenerator');

/**
 * "njs: Generate Project Files" — writes a runnable Express + SQLite project
 * (server.js, package.json, .env, public/*.html) into the workspace from the
 * registered schema, saved queries, rules and screens.
 */
async function generateProjectFiles(schemaRegistry) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (!root) {
        vscode.window.showErrorMessage('njs: Open a folder first');
        return;
    }
    const tables = schemaRegistry.getTables();
    if (!tables.length) {
        vscode.window.showErrorMessage('njs: Register at least one table first (njs: Register Table from SQL)');
        return;
    }

    const authConfig = await pickAuthConfig(schemaRegistry, tables);
    if (authConfig === undefined) return; // cancelled

    const reports = await pickReports(schemaRegistry);
    if (reports === undefined) return;

    const projectName = path.basename(root);
    let files;
    try {
        files = new Scaffer(schemaRegistry).generateAll(projectName, tables, authConfig, schemaRegistry.getRules(), reports, { port: 3000 });
    } catch (err) {
        vscode.window.showErrorMessage(`njs: Generation failed: ${err.message}`);
        return;
    }

    const existing = Object.keys(files).filter(f => fs.existsSync(path.join(root, f)));
    let overwrite = false;
    if (existing.length) {
        const shown = existing.slice(0, 8).join(', ') + (existing.length > 8 ? `, +${existing.length - 8} more` : '');
        const choice = await vscode.window.showWarningMessage(
            `njs: ${existing.length} file(s) already exist: ${shown}`,
            { modal: true },
            'Overwrite All', 'Only Write New Files'
        );
        if (!choice) return;
        overwrite = choice === 'Overwrite All';
    }

    const written = [];
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel);
        if (!overwrite && fs.existsSync(abs)) continue;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        written.push(rel);
    }

    if (written.includes('server.js')) {
        const doc = await vscode.workspace.openTextDocument(path.join(root, 'server.js'));
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    const next = await vscode.window.showInformationMessage(
        `njs: Wrote ${written.length} file(s)${authConfig ? ` with login on ${authConfig.tableName}` : ''}.`,
        'npm install && npm start', 'npm start'
    );
    if (next) {
        const term = vscode.window.createTerminal({ name: 'njs: server', cwd: root });
        term.show();
        // `;` works in both PowerShell 5 and POSIX shells, `&&` does not
        term.sendText(next === 'npm start' ? 'npm start' : 'npm install; npm start');
    }
}

async function pickAuthConfig(schemaRegistry, tables) {
    const saved = schemaRegistry.getAuthConfig();
    const items = [];
    if (saved && tables.includes(saved.tableName)) {
        items.push({ label: `$(lock) Keep login on ${saved.tableName}`, description: `${saved.identityFields.join(', ')} + ${saved.passwordField}`, value: 'keep' });
    }
    items.push({ label: '$(unlock) No login', description: 'All pages and APIs are public', value: 'none' });
    for (const t of tables) {
        items.push({ label: `$(person) Login with ${t}`, value: t });
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Authentication for the generated project', ignoreFocusOut: true });
    if (!pick) return undefined;
    if (pick.value === 'keep') return saved;
    if (pick.value === 'none') {
        await schemaRegistry.setAuthConfig(null);
        return null;
    }

    const table = schemaRegistry.getTable(pick.value);
    const authGen = new AuthGenerator(schemaRegistry);
    const fieldItems = table.fields.map(f => ({ label: f.name, description: f.type }));

    const pwGuess = authGen.detectPasswordField(table);
    const pwPick = await vscode.window.showQuickPick(
        fieldItems.map(i => ({ ...i, picked: i.label === pwGuess })).sort((a, b) => (b.picked ? 1 : 0) - (a.picked ? 1 : 0)),
        { placeHolder: `Password field in ${pick.value}`, ignoreFocusOut: true }
    );
    if (!pwPick) return undefined;

    const idGuess = authGen.detectIdentityFields(table);
    const idPick = await vscode.window.showQuickPick(
        fieldItems.filter(i => i.label !== pwPick.label).map(i => ({ ...i, picked: idGuess.includes(i.label) })),
        { placeHolder: 'Login identity field(s), e.g. the ID or username students type', canPickMany: true, ignoreFocusOut: true }
    );
    if (!idPick || !idPick.length) return undefined;

    const statusGuess = authGen.detectStatusField(table);
    const statusItems = [{ label: '(none)', value: null }].concat(
        fieldItems.filter(i => i.label !== pwPick.label).map(i => ({ ...i, value: i.label }))
    );
    if (statusGuess) statusItems.sort((a, b) => (b.label === statusGuess ? 1 : 0) - (a.label === statusGuess ? 1 : 0));
    const statusPick = await vscode.window.showQuickPick(statusItems, {
        placeHolder: 'Status field (only rows with an active value can log in)', ignoreFocusOut: true
    });
    if (!statusPick) return undefined;

    const config = {
        tableName: pick.value,
        identityFields: idPick.map(i => i.label),
        passwordField: pwPick.label,
        statusField: statusPick.value,
        useRateLimiter: false
    };
    await schemaRegistry.setAuthConfig(config);
    return config;
}

async function pickReports(schemaRegistry) {
    const queries = schemaRegistry.getQueries();
    // Queries already shown through a report screen get their page from the screen
    const usedByScreens = new Set(schemaRegistry.getScreens().filter(s => s.type === 'report').map(s => s.query));
    const names = Object.keys(queries).filter(n => !usedByScreens.has(n));
    if (!names.length) return [];
    const picks = await vscode.window.showQuickPick(
        names.map(n => ({ label: n, description: `${(queries[n].columns || []).length} column(s)`, picked: true })),
        { placeHolder: 'Saved queries to publish as report pages', canPickMany: true, ignoreFocusOut: true }
    );
    if (!picks) return undefined;
    return picks.map(p => ({ name: p.label, title: p.label, ...queries[p.label] }));
}

module.exports = { generateProjectFiles };
