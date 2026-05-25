const vscode = require('vscode');
const { ServerManager } = require('./serverManager');
const { AiClient } = require('./aiClient');
const { MagicSnippetProvider } = require('./magicSnippet');
const { InlineAutocompleteProvider } = require('./inlineProvider');

let serverManager;
let aiClient;
let activeProviders = [];

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

                const magicProvider = new MagicSnippetProvider(aiClient, context);
                const magicDisposable = vscode.languages.registerInlineCompletionItemProvider(
                    { language: 'javascript' }, magicProvider
                );
                activeProviders.push(magicDisposable);

                const enableAuto = vscode.workspace.getConfiguration('node-sqlite-ai').get('enableAutocomplete');
                if (enableAuto) {
                    const autoProvider = new InlineAutocompleteProvider(aiClient);
                    const autoDisposable = vscode.languages.registerInlineCompletionItemProvider(
                        { language: 'javascript' }, autoProvider
                    );
                    activeProviders.push(autoDisposable);
                }

                vscode.window.showInformationMessage('AI: Turned on and ready');
            } catch (err) {
                vscode.window.showErrorMessage(`AI: Failed to start — ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.disable', async () => {
            serverManager.stop();
            activeProviders.forEach(d => d.dispose());
            activeProviders = [];
            vscode.window.showInformationMessage('AI: Turned off');
        })
    );

    context.subscriptions.push({ dispose: () => serverManager.stop() });
}

function deactivate() {
    if (serverManager) serverManager.stop();
}

module.exports = { activate, deactivate };
