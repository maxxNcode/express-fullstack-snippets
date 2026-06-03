const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

class MagicSnippetHandler {
    constructor(aiClient, context, schemaRegistry, options = {}) {
        this.aiClient = aiClient;
        this.schemaRegistry = schemaRegistry;
        this.trained = options.trained || false;
        this.snippets = this.buildSnippetsContext(context);
        this.disposables = [];
        this.requestCounter = 0;
        this.MAX_TOKENS = 4096;
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
                if (this.trained) {
                    const body = Array.isArray(data.body) ? data.body.join('\n') : data.body;
                    const clean = body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\|([^}]+)\|}/g, '$1');
                    lines.push(`Snippet "${prefixes}" (${data.description}):\n\`\`\`javascript\n${clean}\n\`\`\``);
                } else {
                    lines.push(`- ${prefixes}: ${data.description}`);
                }
            }
            return lines.join('\n');
        } catch (e) {
            return '';
        }
    }

    setupEnterListener(context) {
        const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
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

                if (instruction.startsWith('register ')) {
                    const spec = instruction.substring(9).trim();
                    this.handleRegistration(event.document, njsLine, lineText, spec);
                    return;
                }

                this.triggerGeneration(event.document, njsLine, lineText, instruction);
            }
        });
        context.subscriptions.push(disposable);
        this.disposables.push(disposable);

        const cmdDisposable = vscode.commands.registerCommand('node-sqlite-ai.magicComplete', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const cursorLine = editor.selection.active.line;
            const lineText = editor.document.lineAt(cursorLine).text;
            const prefix = vscode.workspace.getConfiguration('node-sqlite-ai').get('magicPrefix');
            if (!lineText.startsWith(prefix)) return;
            const instruction = lineText.substring(prefix.length).trim();
            if (!instruction) return;

            if (instruction.startsWith('register ')) {
                const spec = instruction.substring(9).trim();
                this.handleRegistration(editor.document, cursorLine, lineText, spec);
                return;
            }

            this.triggerGeneration(editor.document, cursorLine, lineText, instruction);
        });
        context.subscriptions.push(cmdDisposable);
        this.disposables.push(cmdDisposable);
    }

    setupSelectionListener(context) {
        const disposable = vscode.window.onDidChangeTextEditorSelection((event) => {
            const editor = event.textEditor;
            if (!editor) {
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

    async handleRegistration(document, lineNumber, lineText, spec) {
        try {
            const { tableName, fields } = this.schemaRegistry.parseInlineSpec(spec);
            await this.schemaRegistry.addTable(tableName, fields);
            vscode.window.showInformationMessage(`njs: Table "${tableName}" registered with ${fields.length} fields`);
            const edit = new vscode.WorkspaceEdit();
            const range = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
            edit.replace(document.uri, range, `// Table "${tableName}" registered`);
            await vscode.workspace.applyEdit(edit);
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async fixSelection(selectedText, instruction) {
        const systemContext = `Available snippets:\n${this.snippets}\n\nFix the provided code based on the instruction. Output only the fixed code, no explanations.`;
        const prompt = `Code to fix:\n${selectedText}\n\nInstruction: ${instruction}`;
        return await this.callAI(prompt, systemContext);
    }

    async editFile(fileContent, instruction) {
        const systemContext = `Available snippets:\n${this.snippets}\n\nEdit the provided file based on the instruction. Output the complete edited file, no explanations.`;
        const prompt = `File content:\n${fileContent}\n\nInstruction: ${instruction}`;
        return await this.callAI(prompt, systemContext);
    }

    async callAI(prompt, systemContext) {
        try {
            const raw = await this.aiClient.complete(prompt, systemContext, this.MAX_TOKENS);
            return raw
                .replace(/<\|im_start\|>/g, '')
                .replace(/<\|im_end\|>/g, '')
                .replace(/<\|endoftext\|>/g, '')
                .replace(/^```.*$/gm, '')
                .trim();
        } catch (e) {
            console.error('AI call error:', e);
            return null;
        }
    }

    async triggerGeneration(document, lineNumber, lineText, instruction) {
        const requestId = ++this.requestCounter;

        const fileMatch = instruction.match(/^in\s+(\S+)\s+(.+)/);
        if (fileMatch) {
            await this.handleFileEdit(requestId, document, lineNumber, lineText, fileMatch[1], fileMatch[2]);
            return;
        }

        const lang = document.languageId;
        const isHtml = lang === 'html';
        const systemContext = `Available snippets:\n${this.snippets}\n\n${isHtml
            ? 'Write a single, complete HTML file with inline CSS and JS. One ```html block only.'
            : 'Write complete JavaScript code using the snippets above. One ```javascript block only. No explanations.'}

Output the full file, not a partial example. Never use external files or CDNs unless required.`;

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

            const lines = fileContent.split('\n');
            const targetLastLine = lines.length - 1;
            const targetLastLineLen = lines[targetLastLine].length;
            const targetRange = new vscode.Range(0, 0, targetLastLine, targetLastLineLen);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(targetUri, targetRange, response);
            const applied = await vscode.workspace.applyEdit(edit);

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
