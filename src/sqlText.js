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
        if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
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

module.exports = { splitSql };
