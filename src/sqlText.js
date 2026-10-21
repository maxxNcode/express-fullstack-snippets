// Split SQL outside quoted literals, comments and nested parentheses.
function splitSql(text, delimiter = ';') {
    const parts = [];
    let start = 0, depth = 0, quote = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === '\\') { i++; continue; }
            if (c === quote) {
                if (text[i + 1] === quote) i++;
                else quote = null;
            }
            continue;
        }
        if (c === "'" || c === '"' || c === '`' || c === '[') { quote = c === '[' ? ']' : c; continue; }
        if (c === '-' && text[i + 1] === '-') {
            while (i < text.length && text[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i++;
            continue;
        }
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (c === delimiter && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    if (text.slice(start).trim()) parts.push(text.slice(start));
    return parts;
}

function stripSqlComments(text) {
    let result = '', quote = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            result += c;
            if (c === quote) {
                if (text[i + 1] === quote) result += text[++i];
                else quote = null;
            } else if (c === '\\' && i + 1 < text.length) result += text[++i];
        } else if (c === "'" || c === '"' || c === '`' || c === '[') { quote = c === '[' ? ']' : c; result += c; }
        else if (c === '-' && text[i + 1] === '-') {
            while (i < text.length && text[i] !== '\n') { result += ' '; i++; }
            if (i < text.length) result += '\n';
        } else if (c === '/' && text[i + 1] === '*') {
            result += '  '; i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) result += text[i++] === '\n' ? '\n' : ' ';
            if (i < text.length) { result += '  '; i++; }
        } else result += c;
    }
    return result;
}

function createTableStatements(text) {
    const clean = stripSqlComments(text);
    const statements = [];
    let offset = 0;
    for (const part of splitSql(clean)) {
        const index = clean.indexOf(part, offset);
        const leading = part.search(/\S/);
        if (/^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\b/i.test(part)) statements.push({ sql: part.trim(), start: index + leading, end: index + part.length + (clean[index + part.length] === ';' ? 1 : 0) });
        offset = index + part.length + 1;
    }
    return statements;
}

module.exports = { splitSql, stripSqlComments, createTableStatements };
