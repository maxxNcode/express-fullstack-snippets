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
            const modelPath = vscode.Uri.joinPath(context.extensionUri, 'models', 'qwen2.5-coder-0.5b-q4_k_m.gguf').fsPath;
            const serverPath = vscode.Uri.joinPath(context.extensionUri, 'bin', 'llama-server.exe').fsPath;

            try {
                await serverManager.start(port, modelPath, serverPath);
                aiClient.setPort(port);

                vscode.commands.executeCommand('setContext', 'njsAiEnabled', true);

                magicHandler = new MagicSnippetHandler(aiClient, context);

                vscode.window.showInformationMessage('AI: Turned on and ready');
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
            vscode.window.showInformationMessage('AI: Turned off');
        })
    );

    context.subscriptions.push({ dispose: () => serverManager.stop() });
}

function deactivate() {
    if (serverManager) serverManager.stop();
}

module.exports = { activate, deactivate };
