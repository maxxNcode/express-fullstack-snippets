const vscode = require('vscode');
const { CodeGenerator } = require('./generator');

class DynamicSnippetProvider {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
        this.generator = new CodeGenerator(schemaRegistry);
    }

    provideCompletionItems(document, position) {
        const tables = this.schemaRegistry.getTables();
        if (!tables.length) return;

        const linePrefix = document.lineAt(position.line).text.substring(0, position.character);
        const njsIdx = linePrefix.lastIndexOf('njs-');
        if (njsIdx < 0) return;

        const typed = linePrefix.substring(njsIdx).toLowerCase();
        const items = [];
        const snippetTypes = [
            { type: 'crud', detail: 'Prep statements + CRUD routes for server.js' },
            { type: 'list', detail: 'HTML table list with JS' },
            { type: 'list-js', detail: 'JS fetch + render + delete functions' },
            { type: 'form', detail: 'HTML add/edit form' },
            { type: 'form-js', detail: 'JS form submit + edit handlers' },
            { type: 'page', detail: 'Full HTML page (form + list)' },
            { type: 'page-js', detail: 'All JS functions' }
        ];

        for (const tableName of tables) {
            const lowerName = tableName.toLowerCase();
            for (const st of snippetTypes) {
                const label = `njs-${lowerName}-${st.type}`;
                // Only filter if user typed more than just 'njs-'
                if (typed.length > 4 && !label.startsWith(typed)) continue;

                let code;
                try {
                    code = this.generator.generate(st.type, tableName);
                } catch (e) {
                    continue;
                }
                if (!code) continue;

                const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
                item.detail = `[${tableName}] ${st.detail}`;
                item.documentation = new vscode.MarkdownString().appendCodeblock(code, 'javascript');
                item.insertText = new vscode.SnippetString(code);
                item.range = new vscode.Range(position.line, njsIdx, position.line, position.character);
                items.push(item);
            }
        }

        // Add query snippets for saved custom queries
        const queries = this.schemaRegistry.getQueries();
        for (const [queryName, query] of Object.entries(queries)) {
            if (!query.columns || !query.columns.length) continue;
            const lowerQName = queryName.toLowerCase();
            const queryTypes = [
                { type: 'sql', detail: 'SELECT SQL with JOINs' },
                { type: 'js', detail: 'JS fetch function' },
                { type: 'server', detail: 'Express server route' },
                { type: 'card', detail: 'HTML card view' },
                { type: 'table', detail: 'HTML table view' }
            ];
            for (const qt of queryTypes) {
                const label = `njs-${lowerQName}-${qt.type}`;
                if (typed.length > 4 && !label.startsWith(typed)) continue;

                let code;
                try {
                    code = this.generator.generate(`query-${qt.type}`, queryName);
                } catch (e) {
                    continue;
                }
                if (!code) continue;

                const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
                item.detail = `[Query: ${queryName}] ${qt.detail}`;
                item.documentation = new vscode.MarkdownString().appendCodeblock(code, 'javascript');
                item.insertText = new vscode.SnippetString(code);
                item.range = new vscode.Range(position.line, njsIdx, position.line, position.character);
                items.push(item);
            }
        }

        return items.length > 0 ? items : undefined;
    }
}

module.exports = { DynamicSnippetProvider };
