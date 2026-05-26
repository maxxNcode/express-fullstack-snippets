const vscode = require('vscode');
const { ServerManager } = require('./serverManager');
const { AiClient } = require('./aiClient');
const { MagicSnippetHandler } = require('./magicSnippet');

let serverManager;
let aiClient;
let magicHandler = null;

function activate(context) {
    serverManager = new ServerManager();
    aiClient = new AiClient();

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

                magicHandler = new MagicSnippetHandler(aiClient, context, { trained: false });

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

                magicHandler = new MagicSnippetHandler(aiClient, context, { trained: true });

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

    context.subscriptions.push({ dispose: () => serverManager.stop() });
}

function deactivate() {
    if (serverManager) serverManager.stop();
}

module.exports = { activate, deactivate };
