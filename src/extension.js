const vscode = require('vscode');
const { ServerManager } = require('./serverManager');
const { AiClient } = require('./aiClient');
const { MagicSnippetHandler } = require('./magicSnippet');
const { SchemaRegistry } = require('./schemaRegistry');
const { DynamicSnippetProvider } = require('./dynamicProvider');
const { FkManager } = require('./fkManager');
const { CodeGenerator } = require('./generator');

let serverManager;
let aiClient;
let magicHandler = null;
let schemaRegistry;
let dynamicProvider = null;
let fkManager;

function activate(context) {
    serverManager = new ServerManager();
    aiClient = new AiClient();

    schemaRegistry = new SchemaRegistry();
    let codeGenerator = null;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (workspaceRoot) {
        schemaRegistry.init(workspaceRoot).then(() => {
            codeGenerator = new CodeGenerator(schemaRegistry);
            dynamicProvider = new DynamicSnippetProvider(schemaRegistry);
            context.subscriptions.push(
                vscode.languages.registerCompletionItemProvider(
                    ['javascript', 'html', 'json', 'jsonc', 'typescript', 'javascriptreact', 'typescriptreact'],
                    dynamicProvider,
                    '-'
                )
            );
        });
    }

    fkManager = new FkManager(schemaRegistry);

    // Always-on njs: register / remove / modify handler (AI-independent)
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (event) => {
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
                        await schemaRegistry.removeTable(tableName);
                        await schemaRegistry.addTable(tableName, fields);
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

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.enable', async () => {
            if (serverManager.isRunning()) {
                vscode.window.showInformationMessage('AI: Already running');
                return;
            }

            const port = vscode.workspace.getConfiguration('node-sqlite-ai').get('port');
            const modelPath = vscode.Uri.joinPath(context.extensionUri, 'models', 'qwen2.5-coder-1.5b-instruct.q3_k_m.gguf').fsPath;
            const serverPath = vscode.Uri.joinPath(context.extensionUri, 'bin', 'llama-server.exe').fsPath;

            try {
                await serverManager.start(port, modelPath, serverPath);
                aiClient.setPort(port);

                vscode.commands.executeCommand('setContext', 'njsAiEnabled', true);
                vscode.commands.executeCommand('setContext', 'njsAiTrained', false);

                magicHandler = new MagicSnippetHandler(aiClient, context, schemaRegistry, { trained: false });

                vscode.window.showInformationMessage('AI: Turned on and ready');
            } catch (err) {
                vscode.window.showErrorMessage(`AI: Failed to start — ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.trained-enable', async () => {
            if (serverManager.isRunning()) {
                vscode.window.showInformationMessage('AI: Already running. Turn off first to switch mode.');
                return;
            }

            const port = vscode.workspace.getConfiguration('node-sqlite-ai').get('port');
            const modelPath = vscode.Uri.joinPath(context.extensionUri, 'models', 'qwen2.5-coder-1.5b-instruct.q3_k_m.gguf').fsPath;
            const serverPath = vscode.Uri.joinPath(context.extensionUri, 'bin', 'llama-server.exe').fsPath;

            try {
                await serverManager.start(port, modelPath, serverPath);
                aiClient.setPort(port);

                vscode.commands.executeCommand('setContext', 'njsAiEnabled', true);
                vscode.commands.executeCommand('setContext', 'njsAiTrained', true);

                magicHandler = new MagicSnippetHandler(aiClient, context, schemaRegistry, { trained: true });

                vscode.window.showInformationMessage('AI: Trained mode — AI knows all snippet bodies');
            } catch (err) {
                vscode.window.showErrorMessage(`AI: Failed to start — ${err.message}`);
            }
        })
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
                `${f.name} ${f.type}${f.pk ? ' PRIMARY' : ''}${f.notNull ? ' NOT NULL' : ''}${f.default !== undefined ? ` DEFAULT ${f.default}` : ''}${f.fk ? ` FK->${f.fk.table}(${f.fk.field})` : ''}`
            ).join(', ');
            const fieldsStr = await vscode.window.showInputBox({
                prompt: `New fields for "${pick.label}" (comma-separated)`,
                placeHolder: currentFields,
                ignoreFocusOut: true
            });
            if (!fieldsStr) return;

            try {
                const { fields } = schemaRegistry.parseInlineSpec(`${pick.label}:${fieldsStr}`);
                await schemaRegistry.removeTable(pick.label);
                await schemaRegistry.addTable(pick.label, fields);
                vscode.window.showInformationMessage(`njs: Table "${pick.label}" modified (${fields.length} fields)`);
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
                    `${f.name} (${f.type})${f.pk ? ' PK' : ''}${f.fk ? ` FK->${f.fk.table}(${f.fk.field})` : ''}`
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

    context.subscriptions.push({ dispose: () => serverManager.stop() });
}

function deactivate() {
    if (serverManager) serverManager.stop();
}

module.exports = { activate, deactivate };
