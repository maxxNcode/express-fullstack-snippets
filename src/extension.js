const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// njs: line commands only fire in these editors (not in Markdown guides, JSON, etc.)
const NJS_LANGUAGES = new Set(['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'html', 'sql', 'plaintext']);
const { ServerManager } = require('./serverManager');
const { AiClient } = require('./aiClient');
const { MagicSnippetHandler } = require('./magicSnippet');
const { SchemaRegistry } = require('./schemaRegistry');
const { DynamicSnippetProvider } = require('./dynamicProvider');
const { FkManager } = require('./fkManager');
const { CodeGenerator } = require('./generator');
const { SchemaViewProvider } = require('./schemaView');
const { MysqlToSqliteConverter } = require('./mysqlToSqlite');
const { generateProjectFiles } = require('./projectGenerator');

let serverManager;
let aiClient;
let magicHandler = null;
let schemaRegistry;
let dynamicProvider = null;
let fkManager;
let schemaViewProvider;

function activate(context) {
    serverManager = new ServerManager();
    aiClient = new AiClient();

    schemaRegistry = new SchemaRegistry();
    schemaViewProvider = new SchemaViewProvider(context, schemaRegistry);
    let codeGenerator = null;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (workspaceRoot) {
        schemaRegistry.init(workspaceRoot).then(() => {
            codeGenerator = new CodeGenerator(schemaRegistry);
            schemaViewProvider.setGenerator(codeGenerator);
            dynamicProvider = new DynamicSnippetProvider(schemaRegistry);
            context.subscriptions.push(
                vscode.languages.registerCompletionItemProvider(
                    ['javascript', 'html', 'json', 'jsonc', 'typescript', 'javascriptreact', 'typescriptreact'],
                    dynamicProvider
                )
            );
        });
    }

    fkManager = new FkManager(schemaRegistry);

    // Always-on njs: register / remove / modify handler (AI-independent)
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (event) => {
            if (!NJS_LANGUAGES.has(event.document.languageId)) return;
            const prefix = vscode.workspace.getConfiguration('node-sqlite-ai').get('magicPrefix') || 'njs:';
            for (const change of event.contentChanges) {
                const text = change.text;
                const isEnter = text === '\n' || text === '\r\n';
                if (!isEnter) continue;
                const lineNum = change.range.start.line;
                if (lineNum < 0) continue;
                const lineText = event.document.lineAt(lineNum).text;
                if (!lineText.startsWith(prefix)) continue;
                const instruction = lineText.substring(prefix.length).trim();
                if (!instruction) continue;

                // njs:register TableName:fieldDef, fieldDef, ...
                const registerMatch = instruction.match(/^register\s+(.+)/);
                if (registerMatch) {
                    const spec = registerMatch[1].trim();
                    // Check if this is a backtick-wrapped CREATE TABLE: njs:register(`CREATE TABLE...`)
                    if (spec.startsWith('`') && /CREATE\s+TABLE/i.test(spec)) {
                        try {
                            const { tableName, fields, constraints } = schemaRegistry.parseCreateTable(spec);
                            await schemaRegistry.addTable(tableName, fields, constraints);
                            vscode.window.showInformationMessage(`njs: Table "${tableName}" registered from SQL`);
                            const edit = new vscode.WorkspaceEdit();
                            const range = new vscode.Range(lineNum, 0, lineNum, lineText.length);
                            edit.replace(event.document.uri, range, `// Table "${tableName}" registered from SQL`);
                            await vscode.workspace.applyEdit(edit);
                        } catch (err) {
                            vscode.window.showErrorMessage(`njs: ${err.message}`);
                        }
                        return;
                    }
                    try {
                        const { tableName, fields } = schemaRegistry.parseInlineSpec(spec);
                        await schemaRegistry.addTable(tableName, fields);
                        vscode.window.showInformationMessage(`njs: Table "${tableName}" registered`);
                        const edit = new vscode.WorkspaceEdit();
                        const range = new vscode.Range(lineNum, 0, lineNum, lineText.length);
                        const createTableSql = codeGenerator ? codeGenerator.generateCreateTable(tableName) : '';
                        edit.replace(event.document.uri, range, `// Table "${tableName}" registered\n\n${createTableSql}`);
                        await vscode.workspace.applyEdit(edit);
                    } catch (err) {
                        vscode.window.showErrorMessage(`njs: ${err.message}`);
                    }
                    return;
                }

                // njs:remove TableName  or  njs:unregister TableName
                const removeMatch = instruction.match(/^(?:remove|unregister)\s+(.+)/);
                if (removeMatch) {
                    const tableName = removeMatch[1].trim();
                    try {
                        await schemaRegistry.removeTable(tableName);
                        vscode.window.showInformationMessage(`njs: Table "${tableName}" removed from schema`);
                        const edit = new vscode.WorkspaceEdit();
                        const range = new vscode.Range(lineNum, 0, lineNum, lineText.length);
                        edit.replace(event.document.uri, range, `// Table "${tableName}" removed from schema`);
                        await vscode.workspace.applyEdit(edit);
                    } catch (err) {
                        vscode.window.showErrorMessage(`njs: ${err.message}`);
                    }
                    return;
                }

                // njs:modify TableName:fieldDef, fieldDef, ...
                const modifyMatch = instruction.match(/^modify\s+(.+)/);
                if (modifyMatch) {
                    const spec = modifyMatch[1].trim();
                    try {
                        const { tableName, fields } = schemaRegistry.parseInlineSpec(spec);
                        if (schemaRegistry.getTable(tableName)) await schemaRegistry.replaceTableFields(tableName, fields);
                        else await schemaRegistry.addTable(tableName, fields);
                        vscode.window.showInformationMessage(`njs: Table "${tableName}" modified (${fields.length} fields)`);
                        const edit = new vscode.WorkspaceEdit();
                        const range = new vscode.Range(lineNum, 0, lineNum, lineText.length);
                        const createTableSql = codeGenerator ? codeGenerator.generateCreateTable(tableName) : '';
                        edit.replace(event.document.uri, range, `// Table "${tableName}" modified\n\n${createTableSql}`);
                        await vscode.workspace.applyEdit(edit);
                    } catch (err) {
                        vscode.window.showErrorMessage(`njs: ${err.message}`);
                    }
                    return;
                }
            }
        })
    );

    async function startAi(trained) {
        if (serverManager.isRunning()) {
            vscode.window.showInformationMessage(trained ? 'AI: Already running. Turn off first to switch mode.' : 'AI: Already running');
            return;
        }

        const port = vscode.workspace.getConfiguration('node-sqlite-ai').get('port');
        const modelPath = vscode.Uri.joinPath(context.extensionUri, 'models', 'qwen2.5-coder-1.5b-instruct.q3_k_m.gguf').fsPath;
        const serverPath = vscode.Uri.joinPath(context.extensionUri, 'bin', 'llama-server.exe').fsPath;
        const missing = [serverPath, modelPath].filter(p => !fs.existsSync(p));
        if (missing.length) {
            vscode.window.showErrorMessage(`AI: Not available in this install, missing ${missing.map(p => path.basename(p)).join(' and ')}`);
            return;
        }

        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'AI: Loading model...' },
                () => serverManager.start(port, modelPath, serverPath)
            );
            aiClient.setPort(port);

            vscode.commands.executeCommand('setContext', 'njsAiEnabled', true);
            vscode.commands.executeCommand('setContext', 'njsAiTrained', trained);

            magicHandler = new MagicSnippetHandler(aiClient, context, schemaRegistry, { trained });

            vscode.window.showInformationMessage(trained ? 'AI: Trained mode — AI knows all snippet bodies' : 'AI: Turned on and ready');
        } catch (err) {
            vscode.window.showErrorMessage(`AI: Failed to start — ${err.message}`);
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.enable', () => startAi(false)),
        vscode.commands.registerCommand('node-sqlite-ai.trained-enable', () => startAi(true))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.disable', async () => {
            if (magicHandler) {
                magicHandler.dispose();
                magicHandler = null;
            }
            serverManager.stop();
            vscode.commands.executeCommand('setContext', 'njsAiEnabled', false);
            vscode.commands.executeCommand('setContext', 'njsAiTrained', false);
            vscode.window.showInformationMessage('AI: Turned off');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.fixSelection', async () => {
            if (!magicHandler) {
                vscode.window.showErrorMessage('AI: Turn on AI first (AI: Turn On or AI: Trained On)');
                return;
            }
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showErrorMessage('AI: Select some code first');
                return;
            }

            const selectedText = editor.document.getText(selection);

            const instruction = await vscode.window.showInputBox({
                prompt: 'Describe the fix...',
                placeHolder: 'e.g. fix the error handling, use async/await',
                ignoreFocusOut: true
            });

            if (!instruction) return;

            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'AI fixing code...' },
                async () => {
                    const response = await magicHandler.fixSelection(selectedText, instruction);
                    if (!response) return;

                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(editor.document.uri, selection, response);
                    await vscode.workspace.applyEdit(edit);
                }
            );
        })
    );

    // Schema commands
    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.registerTable', async () => {
            const tableName = await vscode.window.showInputBox({
                prompt: 'Table name',
                placeHolder: 'e.g. Items',
                ignoreFocusOut: true
            });
            if (!tableName) return;

            const fieldsStr = await vscode.window.showInputBox({
                prompt: 'Fields (comma-separated)',
                placeHolder: 'id PRIMARY, name TEXT NOT NULL, price REAL DEFAULT 0',
                ignoreFocusOut: true
            });
            if (!fieldsStr) return;

            try {
                const { fields } = schemaRegistry.parseInlineSpec(`${tableName}:${fieldsStr}`);
                await schemaRegistry.addTable(tableName, fields);
                vscode.window.showInformationMessage(`njs: Table "${tableName}" registered`);
            } catch (err) {
                vscode.window.showErrorMessage(`njs: ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.removeTable', async () => {
            const tables = schemaRegistry.getTables();
            if (!tables.length) {
                vscode.window.showInformationMessage('njs: No tables to remove');
                return;
            }
            const pick = await vscode.window.showQuickPick(tables.map(t => ({
                label: t,
                detail: `${schemaRegistry.getTable(t).fields.length} fields`
            })), { placeHolder: 'Select table to remove' });
            if (!pick) return;
            try {
                await schemaRegistry.removeTable(pick.label);
                vscode.window.showInformationMessage(`njs: Table "${pick.label}" removed`);
            } catch (err) {
                vscode.window.showErrorMessage(`njs: ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.modifyTable', async () => {
            const tables = schemaRegistry.getTables();
            if (!tables.length) {
                vscode.window.showInformationMessage('njs: No tables to modify');
                return;
            }
            const pick = await vscode.window.showQuickPick(tables.map(t => ({
                label: t,
                detail: `${schemaRegistry.getTable(t).fields.length} fields`
            })), { placeHolder: 'Select table to modify' });
            if (!pick) return;

            const table = schemaRegistry.getTable(pick.label);
            const currentFields = table.fields.map(f =>
                `${f.name} ${f.type}${f.pk ? ' PRIMARY' : ''}${f.notNull ? ' NOT NULL' : ''}${f.unique ? ' UNIQUE' : ''}${f.default !== undefined ? ` DEFAULT ${f.default}` : ''}${f.check ? ` CHECK(${f.check})` : ''}${f.fk ? ` FK->${f.fk.table}(${f.fk.field})` : ''}`
            ).join(', ');
            const fieldsStr = await vscode.window.showInputBox({
                prompt: `New fields for "${pick.label}" (comma-separated)`,
                placeHolder: currentFields,
                ignoreFocusOut: true
            });
            if (!fieldsStr) return;

            try {
                const { fields } = schemaRegistry.parseInlineSpec(`${pick.label}:${fieldsStr}`);
                await schemaRegistry.replaceTableFields(pick.label, fields);
                vscode.window.showInformationMessage(`njs: Table "${pick.label}" modified (${fields.length} fields)`);
            } catch (err) {
                vscode.window.showErrorMessage(`njs: ${err.message}`);
            }
        })
    );

    // New command: Register from selected CREATE TABLE SQL
    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.registerFromSql', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('njs: Open a file first');
                return;
            }

            let sqlText = '';
            if (!editor.selection.isEmpty) {
                sqlText = editor.document.getText(editor.selection).trim();
            }

            if (!sqlText) {
                // Search the ENTIRE document for a CREATE TABLE block (any cursor position)
                for (let line = 0; line < editor.document.lineCount; line++) {
                    const text = editor.document.lineAt(line).text;
                    if (/^\s*CREATE\s+TABLE\b/i.test(text)) {
                        const lines = [text];
                        for (let l = line + 1; l < editor.document.lineCount; l++) {
                            const nextLine = editor.document.lineAt(l).text;
                            lines.push(nextLine);
                            if (/\)\s*;?\s*$/.test(nextLine.trim())) {
                                break;
                            }
                        }
                        sqlText = lines.join('\n').trim();
                        break;
                    }
                }
            }

            if (!sqlText) {
                vscode.window.showErrorMessage('njs: Select a CREATE TABLE block or place cursor on one');
                return;
            }

            // Strip outer njs:register(`...`) wrapper if present
            const registerWrapMatch = sqlText.match(/register\s*\(\s*`([^`]*)`\s*\)/);
            if (registerWrapMatch) {
                sqlText = registerWrapMatch[1].trim();
            }

            try {
                const { tableName, fields, constraints } = schemaRegistry.parseCreateTable(sqlText);
                await schemaRegistry.addTable(tableName, fields, constraints);
                vscode.window.showInformationMessage(`njs: Table "${tableName}" registered from SQL`);
            } catch (err) {
                vscode.window.showErrorMessage(`njs: ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.showStatus', async () => {
            const tables = schemaRegistry.getTables();
            if (!tables.length) {
                vscode.window.showInformationMessage('njs: No tables registered');
                return;
            }
            const pick = await vscode.window.showQuickPick(tables.map(t => ({
                label: t,
                detail: `${schemaRegistry.getTable(t).fields.length} fields`
            })), { placeHolder: 'Registered tables' });
            if (pick) {
                const table = schemaRegistry.getTable(pick.label);
                const fields = table.fields.map(f =>
                    `${f.name} (${f.type})${f.pk ? ' PK' : ''}${f.notNull ? ' NOT NULL' : ''}${f.unique ? ' UNIQUE' : ''}${f.default !== undefined ? ` DEFAULT ${f.default}` : ''}${f.check ? ` CHECK(${f.check})` : ''}${f.fk ? ` FK->${f.fk.table}(${f.fk.field})` : ''}`
                ).join('\n');
                vscode.window.showInformationMessage(`njs: ${pick.label}\n${fields}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.manageFK', () => {
            fkManager.addForeignKey();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.removeFK', async () => {
            fkManager.removeForeignKey();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.openSchemaView', () => {
            schemaViewProvider.show();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.generateAll', async () => {
            const gen = codeGenerator || new CodeGenerator(schemaRegistry);
            const tables = schemaRegistry.getTables();
            if (!tables.length) {
                vscode.window.showInformationMessage('njs: No tables registered');
                return;
            }
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('njs: Open a file first');
                return;
            }
            const code = tables.map(t => gen.generateCreateTable(t) + '\n\n' + gen.generateCrud(t)).join('\n\n');
            const edit = new vscode.WorkspaceEdit();
            edit.insert(editor.document.uri, editor.selection.active, code);
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(`njs: Generated code for ${tables.length} tables`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.generateProject', async () => {
            await generateProjectFiles(schemaRegistry);
        })
    );

    // TailwindCSS CLI setup
    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.tailwindSetup', async () => {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
            if (!root) {
                vscode.window.showErrorMessage('njs: Open a folder first');
                return;
            }
            const terminal = vscode.window.createTerminal('TailwindCSS Setup');
            terminal.show();
            terminal.sendText(`cd "${root}"`);
            terminal.sendText('npm install -D tailwindcss @tailwindcss/cli');
            // Create src/input.css
            const srcDir = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'src');
            try {
                await vscode.workspace.fs.stat(srcDir);
            } catch {
                await vscode.workspace.fs.createDirectory(srcDir);
            }
            const inputCss = vscode.Uri.joinPath(srcDir, 'input.css');
            try {
                await vscode.workspace.fs.stat(inputCss);
                vscode.window.showInformationMessage('njs: src/input.css already exists');
            } catch {
                await vscode.workspace.fs.writeFile(inputCss, Buffer.from('@import "tailwindcss";', 'utf-8'));
            }
            // Read and update package.json scripts
            const pkgPath = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'package.json');
            try {
                const pkgBytes = await vscode.workspace.fs.readFile(pkgPath);
                const pkg = JSON.parse(Buffer.from(pkgBytes).toString('utf-8'));
                if (!pkg.scripts) pkg.scripts = {};
                if (!pkg.scripts.css) {
                    pkg.scripts.css = 'npx @tailwindcss/cli -i ./src/input.css -o ./public/output.css';
                }
                if (!pkg.scripts['css:watch']) {
                    pkg.scripts['css:watch'] = 'npx @tailwindcss/cli -i ./src/input.css -o ./public/output.css --watch';
                }
                await vscode.workspace.fs.writeFile(pkgPath, Buffer.from(JSON.stringify(pkg, null, 2), 'utf-8'));
                terminal.sendText('npm run css:watch');
                vscode.window.showInformationMessage('njs: TailwindCSS setup done! npm run css:watch is running.');
            } catch {
                vscode.window.showInformationMessage('njs: TailwindCSS installed. Add scripts manually if no package.json.');
            }
        })
    );

    // MySQL Schema to SQLite converter
    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.parseMysqlSchema', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('njs: Open a file first');
                return;
            }
            const selection = editor.selection;
            const text = editor.document.getText(selection.isEmpty ? undefined : selection);
            if (!text || !text.trim()) {
                vscode.window.showErrorMessage('njs: Select MySQL CREATE TABLE SQL first');
                return;
            }
            try {
                const converter = new MysqlToSqliteConverter();
                const result = converter.convertSchema(text);
                if (!result) {
                    vscode.window.showErrorMessage('njs: No CREATE TABLE statements found in selection');
                    return;
                }
                editor.edit(editBuilder => {
                    if (selection.isEmpty) {
                        editBuilder.insert(selection.active, result);
                    } else {
                        editBuilder.replace(selection, result);
                    }
                });
                vscode.window.showInformationMessage('njs: MySQL schema converted to SQLite');
            } catch (err) {
                vscode.window.showErrorMessage(`njs: Conversion error: ${err.message}`);
            }
        })
    );

    // MySQL INSERT to SQLite converter
    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.parseMysqlInsert', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('njs: Open a file first');
                return;
            }
            const selection = editor.selection;
            const text = editor.document.getText(selection.isEmpty ? undefined : selection);
            if (!text || !text.trim()) {
                vscode.window.showErrorMessage('njs: Select MySQL INSERT SQL first');
                return;
            }
            try {
                const converter = new MysqlToSqliteConverter();
                const result = converter.convertInsert(text);
                if (!result) {
                    vscode.window.showErrorMessage('njs: No INSERT statements found in selection');
                    return;
                }
                editor.edit(editBuilder => {
                    if (selection.isEmpty) {
                        editBuilder.insert(selection.active, result);
                    } else {
                        editBuilder.replace(selection, result);
                    }
                });
                vscode.window.showInformationMessage('njs: MySQL INSERT converted to SQLite');
            } catch (err) {
                vscode.window.showErrorMessage(`njs: Conversion error: ${err.message}`);
            }
        })
    );

    context.subscriptions.push({ dispose: () => {
        if (schemaViewProvider) schemaViewProvider.dispose();
        serverManager.stop();
    } });
}

function deactivate() {
    if (serverManager) serverManager.stop();
}

module.exports = { activate, deactivate };
