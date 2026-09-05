// Split PostgreSQL schema text on top-level statement terminators.
// Semicolons inside quoted values, identifiers, dollar-quoted bodies, and comments
// are part of their enclosing statement.
export function splitSchemaStatements(source) {
  const statements = [];
  let start = 0;
  let index = 0;
  let state = 'normal';
  let blockCommentDepth = 0;
  let dollarQuoteDelimiter = '';

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'single-quote') {
      if (char === "'" && next === "'") {
        index += 2;
        continue;
      }
      if (char === "'") state = 'normal';
      index += 1;
      continue;
    }

    if (state === 'double-quote') {
      if (char === '"' && next === '"') {
        index += 2;
        continue;
      }
      if (char === '"') state = 'normal';
      index += 1;
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n' || char === '\r') state = 'normal';
      index += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (char === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 2;
        continue;
      }
      if (char === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 2;
        if (blockCommentDepth === 0) state = 'normal';
        continue;
      }
      index += 1;
      continue;
    }

    if (state === 'dollar-quote') {
      if (source.startsWith(dollarQuoteDelimiter, index)) {
        index += dollarQuoteDelimiter.length;
        state = 'normal';
        continue;
      }
      index += 1;
      continue;
    }

    if (char === "'") {
      state = 'single-quote';
      index += 1;
      continue;
    }
    if (char === '"') {
      state = 'double-quote';
      index += 1;
      continue;
    }
    if (char === '-' && next === '-') {
      state = 'line-comment';
      index += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block-comment';
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (char === '$') {
      const delimiterMatch = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (delimiterMatch) {
        dollarQuoteDelimiter = delimiterMatch[0];
        state = 'dollar-quote';
        index += dollarQuoteDelimiter.length;
        continue;
      }
    }
    if (char === ';') {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }

  const trailingStatement = source.slice(start).trim();
  if (trailingStatement) statements.push(trailingStatement);
  return statements;
}
