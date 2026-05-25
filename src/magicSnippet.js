const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

class MagicSnippetHandler {
    constructor(aiClient, context) {
        this.aiClient = aiClient;
        this.snippets = this.buildSnippetsContext(context);
        this.disposables = [];
        this.requestCounter = 0;
        this.MAX_TOKENS = 2048;
        this.setupEnterListener(context);
        this.setupSelectionListener(context);
    }

    buildSnippetsContext(context) {
        try {
            const snippetsPath = vscode.Uri.joinPath(context.extensionUri, 'snippets', 'javascript.json').fsPath;
            const raw = fs.readFileSync(snippetsPath, 'utf8');
            const parsed = JSON.parse(raw);
            const lines = [];
            for (const [name, data] of Object.entries(parsed)) {
                const prefixes = Array.isArray(data.prefix) ? data.prefix.join(', ') : data.prefix;
                lines.push(`- ${prefixes}: ${data.description}`);
            }
            return lines.join('\n');
        } catch (e) {
            return '';
        }
    }

    setupEnterListener(context) {
        const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId !== 'javascript') return;
            const prefix = vscode.workspace.getConfiguration('node-sqlite-ai').get('magicPrefix');

            for (const change of event.contentChanges) {
                const text = change.text;
                const isEnter = text === '\n' || text === '\r\n';
                if (!isEnter) continue;

                const njsLine = change.range.start.line;
                if (njsLine < 0) continue;

                const lineText = event.document.lineAt(njsLine).text;
                if (!lineText.startsWith(prefix)) continue;

                const instruction = lineText.substring(prefix.length).trim();
                if (!instruction) continue;

                this.triggerGeneration(event.document, njsLine, lineText, instruction);
            }
        });
        context.subscriptions.push(disposable);
        this.disposables.push(disposable);

        const cmdDisposable = vscode.commands.registerCommand('node-sqlite-ai.magicComplete', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'javascript') return;
            const cursorLine = editor.selection.active.line;
            const lineText = editor.document.lineAt(cursorLine).text;
            const prefix = vscode.workspace.getConfiguration('node-sqlite-ai').get('magicPrefix');
            if (!lineText.startsWith(prefix)) return;
            const instruction = lineText.substring(prefix.length).trim();
            if (!instruction) return;
            this.triggerGeneration(editor.document, cursorLine, lineText, instruction);
        });
        context.subscriptions.push(cmdDisposable);
        this.disposables.push(cmdDisposable);
    }

    setupSelectionListener(context) {
        const disposable = vscode.window.onDidChangeTextEditorSelection((event) => {
            const editor = event.textEditor;
            if (!editor || editor.document.languageId !== 'javascript') {
                vscode.commands.executeCommand('setContext', 'njsMagicLine', false);
                return;
            }
            const cursorLine = editor.selection.active.line;
            const lineText = editor.document.lineAt(cursorLine).text;
            const prefix = vscode.workspace.getConfiguration('node-sqlite-ai').get('magicPrefix');
            vscode.commands.executeCommand('setContext', 'njsMagicLine', lineText.startsWith(prefix));
        });
        context.subscriptions.push(disposable);
        this.disposables.push(disposable);
    }

    async fixSelection(selectedText, instruction) {
        const systemContext = `You are a code assistant for Express + SQLite backends.\nAvailable snippets:\n${this.snippets}\n\nFix the provided code based on the instruction. Output ONLY the fixed code. No explanations, no markdown.`;
        const prompt = `Code to fix:\n${selectedText}\n\nInstruction: ${instruction}`;
        return await this.callAI(prompt, systemContext);
    }

    async editFile(fileContent, instruction) {
        const systemContext = `You are a code assistant for Express + SQLite backends.\nAvailable snippets:\n${this.snippets}\n\nEdit the provided file based on the instruction. Output ONLY the complete edited file content. No explanations, no markdown.`;
        const prompt = `File content:\n${fileContent}\n\nInstruction: ${instruction}`;
        return await this.callAI(prompt, systemContext);
    }

    async callAI(prompt, systemContext) {
        try {
            const code = await this.aiClient.complete(prompt, systemContext, this.MAX_TOKENS);
            return code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```\s*$/, '').trim();
        } catch (e) {
            console.error('AI call error:', e);
            return null;
        }
    }

    async triggerGeneration(document, lineNumber, lineText, instruction) {
        const requestId = ++this.requestCounter;

        // Check for "in FILEPATH instruction" mode (file editing)
        const fileMatch = instruction.match(/^in\s+(\S+)\s+(.+)/);
        if (fileMatch) {
            await this.handleFileEdit(requestId, document, lineNumber, lineText, fileMatch[1], fileMatch[2]);
            return;
        }

        // Default: generate new code
        const systemContext = `You are a code assistant for Express + SQLite backends.\nAvailable snippets:\n${this.snippets}\n\nUse snippets when they match the request. Combine if needed. Write from scratch if nothing fits. Output ONLY valid JavaScript code. No explanations, no markdown.`;

        try {
            const response = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'AI generating...' },
                async () => await this.callAI(instruction, systemContext)
            );

            if (!response || requestId !== this.requestCounter) return;

            const edit = new vscode.WorkspaceEdit();
            const range = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
            edit.replace(document.uri, range, response);
            await vscode.workspace.applyEdit(edit);
        } catch (e) {
            console.error('AI generation error:', e);
        }
    }

    async handleFileEdit(requestId, document, lineNumber, lineText, filePath, instruction) {
        try {
            // Find target file in workspace
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('AI: No workspace folder open');
                return;
            }

            const targetUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
            let fileContent;
            try {
                const fileData = await vscode.workspace.fs.readFile(targetUri);
                fileContent = Buffer.from(fileData).toString('utf8');
            } catch {
                vscode.window.showErrorMessage(`AI: File "${filePath}" not found in workspace`);
                return;
            }

            const response = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'AI editing file...' },
                async () => await this.editFile(fileContent, instruction)
            );

            if (!response || requestId !== this.requestCounter) return;

            // Write edited content back
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(0, 0, document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length);
            edit.replace(targetUri, fullRange, response);
            const applied = await vscode.workspace.applyEdit(edit);

            // Remove the njs: line from original document
            const cleanEdit = new vscode.WorkspaceEdit();
            const cleanRange = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
            cleanEdit.replace(document.uri, cleanRange, '');
            await vscode.workspace.applyEdit(cleanEdit);

            if (applied) {
                vscode.window.showInformationMessage(`AI: Edited ${filePath}`);
            }
        } catch (e) {
            console.error('AI file edit error:', e);
        }
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

module.exports = { MagicSnippetHandler };
