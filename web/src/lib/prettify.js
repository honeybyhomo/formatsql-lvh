// Pure SQL transform functions shared by the CLI (tools/prettify-sql.mjs)
// and the web app (formatsql.lvh.dev). No Node-specific imports — safe for
// the browser.
//
// Pipeline: splitStatements → variabilize → tokenize → capitalize → aliases
// → layout (one-line | keywords-per-line | keywords-per-line + subqueries),
// with optional alignment, all quote/paren/comment/placeholder aware.

// ---------------------------------------------------------------------------
// Keyword sets
// ---------------------------------------------------------------------------

// Words uppercased when capitalization === 'keywords'. Conservative — only
// clear SQL keywords. Column/function names written as reserved words without
// quoting would also be uppercased, but that's rare in the GS queries.
const KEYWORDS = new Set([
  'select', 'from', 'where', 'group', 'by', 'having', 'order', 'limit', 'offset',
  'join', 'inner', 'left', 'right', 'full', 'cross', 'outer', 'natural', 'straight_join',
  'on', 'using', 'union', 'intersect', 'except', 'all', 'distinct', 'with',
  'and', 'or', 'not', 'in', 'is', 'null', 'like', 'between', 'exists', 'any', 'some',
  'as', 'case', 'when', 'then', 'else', 'end', 'asc', 'desc', 'set', 'into', 'values', 'insert',
]);

function isKeyword(w) {
  return KEYWORDS.has(String(w).toLowerCase());
}

// Does a word token look like a bare alias? (pure identifier, not a keyword,
// or a backticked identifier)
function isAliasWord(t) {
  if (!t) return false;
  if (t.type === 'backtick') return true;
  if (t.type === 'word') {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.value) && !KEYWORDS.has(t.value.toLowerCase());
  }
  return false;
}

const INDENT = '  ';
const indentFn = (n) => INDENT.repeat(n);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

// Split SQL into "significant" tokens. Whitespace is dropped (the renderers
// re-flow spacing), so clause analysis never has to skip spaces. Strings,
// backticks, {{placeholders}}, @params and comments are kept as opaque tokens
// so their contents are never mangled.
function tokenize(sql) {
  const tokens = [];
  let i = 0;
  const n = sql.length;
  const isWord = (c) => /[A-Za-z0-9_$]/.test(c) || c === '.';

  while (i < n) {
    const c = sql[i];

    // whitespace — dropped
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // {{ref|fmt}} placeholder (kept verbatim for the GS API)
    if (c === '{' && sql[i + 1] === '{') {
      const end = sql.indexOf('}}', i + 2);
      const stop = end === -1 ? n : end + 2;
      tokens.push({ type: 'placeholder', value: sql.slice(i, stop) });
      i = stop;
      continue;
    }

    // line comment -- ... or # ...
    if ((c === '-' && sql[i + 1] === '-') || c === '#') {
      let j = i + (c === '#' ? 1 : 2);
      while (j < n && sql[j] !== '\n') j++;
      tokens.push({ type: 'comment', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // block comment /* ... */
    if (c === '/' && sql[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      tokens.push({ type: 'comment', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // string literal '...' or "..." (escaped via doubling)
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; }
          j++; break;
        }
        j++;
      }
      tokens.push({ type: 'string', value: sql.slice(i, Math.min(j, n)) });
      i = Math.min(j, n);
      continue;
    }

    // backtick identifier `...`
    if (c === '`') {
      let j = i + 1;
      while (j < n && sql[j] !== '`') j++;
      j = Math.min(n, j + 1);
      tokens.push({ type: 'backtick', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // @param
    if (c === '@') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      if (j > i + 1) {
        tokens.push({ type: 'param', value: sql.slice(i, j) });
        i = j;
        continue;
      }
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }

    // word / number / qualified name (a.b.c)
    if (isWord(c)) {
      let j = i + 1;
      while (j < n && isWord(sql[j])) j++;
      tokens.push({ type: 'word', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // multi-char operators
    const two = sql.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>' || two === '!=' ||
        two === '||' || two === '&&' || two === '::' || two === ':=') {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }

    tokens.push({ type: 'op', value: c });
    i++;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Clause segmentation
// ---------------------------------------------------------------------------

// Given tokens and an index pointing at a 'word' token, return how many word
// tokens form the clause-leading phrase at that position (0 = not a clause
// start). Handles multi-word phrases: GROUP BY, ORDER BY, UNION [ALL],
// [NATURAL] [INNER|LEFT|RIGHT|FULL|CROSS] [OUTER] JOIN.
function matchClausePhrase(tokens, i) {
  const word = (idx) => idx < tokens.length && tokens[idx].type === 'word'
    ? tokens[idx].value.toLowerCase() : null;
  const w0 = word(i);
  if (!w0) return 0;

  if ((w0 === 'group' || w0 === 'order') && word(i + 1) === 'by') return 2;
  if (w0 === 'union') return word(i + 1) === 'all' ? 2 : 1;
  if (w0 === 'join' || w0 === 'straight_join') return 1;
  if (['select', 'from', 'where', 'having', 'limit', 'offset',
       'intersect', 'except'].includes(w0)) return 1;

  // joins with a leading modifier
  if (['inner', 'left', 'right', 'full', 'cross', 'natural'].includes(w0)) {
    let k = i + 1;
    if (word(k) === 'outer') k++;
    if (word(k) === 'join') return k - i + 1;
  }
  return 0;
}

// Split a statement's tokens into clause ranges (depth-0 keyword boundaries).
// Each range: { headStart, headLen, bodyStart, bodyEnd } in original indices.
function clauseRanges(tokens) {
  const ranges = [];
  const n = tokens.length;
  let i = 0;
  while (i < n) {
    const headLen = tokens[i] && tokens[i].type === 'word' ? matchClausePhrase(tokens, i) : 0;
    const bodyStart = i + headLen;
    let depth = 0;
    let j = bodyStart;
    while (j < n) {
      const v = tokens[j].value;
      if (v === '(') depth++;
      else if (v === ')') depth--;
      else if (depth === 0 && tokens[j].type === 'word' && matchClausePhrase(tokens, j) > 0) break;
      j++;
    }
    ranges.push({ headStart: i, headLen, bodyStart, bodyEnd: j });
    i = j;
  }
  return ranges;
}

// Find the index of the ')' matching the '(' at openIdx.
function matchingClose(tokens, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    const v = tokens[i].value;
    if (v === '(') depth++;
    else if (v === ')') { depth--; if (depth === 0) return i; }
  }
  return openIdx; // unmatched — fallback
}

// Is the '(' at i the start of a (SELECT ...) / (WITH ...) subquery?
function isOpenSubquery(tokens, i) {
  if (tokens[i].value !== '(') return false;
  const next = tokens[i + 1];
  return !!next && next.type === 'word' &&
    (next.value.toLowerCase() === 'select' || next.value.toLowerCase() === 'with');
}

// Split [s, e) by top-level commas (depth-aware). Returns [start, end) ranges.
function splitCommaRanges(tokens, s, e) {
  const ranges = [];
  let depth = 0;
  let start = s;
  for (let i = s; i < e; i++) {
    const v = tokens[i].value;
    if (v === '(') depth++;
    else if (v === ')') depth--;
    else if (v === ',' && depth === 0) { ranges.push([start, i]); start = i + 1; }
  }
  if (start < e || ranges.length === 0) ranges.push([start, e]);
  return ranges;
}

// ---------------------------------------------------------------------------
// Spacing
// ---------------------------------------------------------------------------

// Should there be a space between two adjacent significant tokens?
function needSpace(prev, next) {
  if (!prev) return false;
  const p = prev.value;
  const nx = next.value;
  if (p === '(') return false;
  if (nx === ')' || nx === ',' || nx === ';') return false;
  if (nx === '.' || p === '.') return false;
  if (p === '::' || nx === '::') return false;
  // table.* — no space before the star
  if (nx === '*' && p.endsWith('.')) return false;
  // function call: word immediately followed by '(' — no space, unless the
  // word is a keyword (WHERE (, IN (, ON (, …)
  if (nx === '(' && prev.type === 'word') return isKeyword(prev.value);
  return true;
}

// Is this a SQL line comment (-- … or # …)? These run to end-of-line, so they
// can't stay inline once we re-flow whitespace — left inline, a line comment
// would comment out the tokens that originally followed it on the next line.
// Block comments (/* … */) are self-terminating and need no special handling.
function isLineComment(t) {
  return !!t && t.type === 'comment' && /^(--|#)/.test(t.value);
}

// Separator to emit before `cur`, given the previously emitted token. Line
// comments always sit on their own line, so a newline is forced before and
// after one. `contPad` indents those comment-driven continuation lines.
function tokenSep(prev, cur, contPad) {
  if (!prev) return '';
  if (isLineComment(prev) || isLineComment(cur)) return '\n' + contPad;
  return needSpace(prev, cur) ? ' ' : '';
}

// ---------------------------------------------------------------------------
// Transforms (operate on token arrays)
// ---------------------------------------------------------------------------

// capitalization: 'unchanged' | 'keywords' (keywords + function-call names)
function applyCapitalization(tokens, mode) {
  if (mode !== 'keywords') return tokens;
  return tokens.map((t, i) => {
    if (t.type !== 'word') return t;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t.value)) return t; // skip qualified/numeric
    if (KEYWORDS.has(t.value.toLowerCase())) return { ...t, value: t.value.toUpperCase() };
    const next = tokens[i + 1];
    if (next && next.value === '(') return { ...t, value: t.value.toUpperCase() }; // function call
    return t;
  });
}

// Unwrap a quoted '@var' literal into a bare @param reference, but only when
// the ENTIRE quoted content is a single MySQL user variable. Genuine string
// literals ('Date', 'sent @ noon') and backticked identifiers (`col`) are left
// untouched. Operates on token arrays.
function applyUnwrapVariables(tokens, on) {
  if (!on) return tokens;
  return tokens.map((t) => {
    if (t.type !== 'string' && t.type !== 'backtick') return t;
    const v = t.value;
    const q = v[0];
    // Only when the literal is properly closed (same quote char at both ends).
    if (v.length < 3 || v[v.length - 1] !== q) return t;
    const inner = v.slice(1, -1);
    return /^@[A-Za-z0-9_.$]+$/.test(inner) ? { type: 'param', value: inner } : t;
  });
}

// Unwrap DATE_FORMAT(expr, '%Y-%m-%d') -> expr (just the column). Assumes the GS
// API already renders DATE columns as ISO dates, so the function is redundant.
// Only the exact %Y-%m-%d format; word-boundary guarded (XDATE_FORMAT untouched).
function applyDateFormat(tokens, on) {
  if (!on) return tokens;
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const isDF = t.type === 'word' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.value) &&
      t.value.toLowerCase() === 'date_format';
    if (isDF && tokens[i + 1] && tokens[i + 1].value === '(') {
      const openIdx = i + 1;
      const closeIdx = matchingClose(tokens, openIdx);
      const inner = tokens.slice(openIdx + 1, closeIdx);
      const argRanges = splitCommaRanges(inner, 0, inner.length);
      if (argRanges.length === 2) {
        const fmt = inner.slice(argRanges[1][0], argRanges[1][1]).map((x) => x.value).join('').trim();
        if (fmt.replace(/^['"`]|['"`]$/g, '') === '%Y-%m-%d') {
          out.push(...inner.slice(argRanges[0][0], argRanges[0][1]));
          i = closeIdx + 1;
          continue;
        }
      }
    }
    out.push(t);
    i++;
  }
  return out;
}

// Index of a trailing alias in a SELECT-list item spanning [s, e), or -1.
function aliasCandidateAt(tokens, s, e) {
  const last = e - 1;
  if (last < s) return -1;
  const lt = tokens[last];
  if (!isAliasWord(lt)) return -1;
  if (last - 1 < s) return -1; // single token — just a column, no alias
  const pt = tokens[last - 1];
  if (pt.type === 'word' && pt.value.toLowerCase() === 'as') return -1; // already AS
  const operandTerm = (pt.type === 'word' && !KEYWORDS.has(pt.value.toLowerCase())) ||
    pt.type === 'string' || pt.type === 'backtick' ||
    pt.type === 'placeholder' || pt.type === 'param' || pt.value === ')';
  return operandTerm ? last : -1;
}

// Index of a table alias inside a FROM/JOIN body [s, e), or -1.
function tableAliasIndex(tokens, s, e) {
  if (s >= e) return -1;
  if (tokens[s].value === '(') {
    const close = matchingClose(tokens, s);
    const k = close + 1;
    if (k < e && isAliasWord(tokens[k])) return k;
    return -1;
  }
  if (tokens[s].type === 'word') {
    const k = s + 1;
    if (k < e && tokens[k].type === 'word' && tokens[k].value.toLowerCase() === 'as') return -1;
    if (k < e && isAliasWord(tokens[k])) return k;
  }
  return -1;
}

// Recursively collect alias-insertion positions (original-array indices) across
// the whole statement, descending into (SELECT …) subqueries. `base` is the
// original-array index of tokens[0].
function collectAliasPositions(tokens, set, base) {
  for (const r of clauseRanges(tokens)) {
    const headWord = tokens[r.headStart] && tokens[r.headStart].value.toLowerCase();
    const headLastIdx = r.headStart + r.headLen - 1;
    const isJoin = r.headLen > 0 && tokens[headLastIdx] && tokens[headLastIdx].value.toLowerCase() === 'join';

    if (headWord === 'select') {
      for (const [s, e] of splitCommaRanges(tokens, r.bodyStart, r.bodyEnd)) {
        const idx = aliasCandidateAt(tokens, s, e);
        if (idx >= 0) set.add(base + idx);
      }
    } else if (headWord === 'from' || isJoin) {
      const items = headWord === 'from'
        ? splitCommaRanges(tokens, r.bodyStart, r.bodyEnd)
        : [[r.bodyStart, r.bodyEnd]];
      for (const [s, e] of items) {
        const idx = tableAliasIndex(tokens, s, e);
        if (idx >= 0) set.add(base + idx);
      }
    }
  }

  // descend into subqueries (handles nesting at any depth)
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value === '(' && isOpenSubquery(tokens, i)) {
      const close = matchingClose(tokens, i);
      collectAliasPositions(tokens.slice(i + 1, close), set, base + i + 1);
      i = close;
    }
  }
}

// aliases: 'unchanged' | 'as' (ensure AS) | 'bare' (strip AS). Best-effort.
function applyAliases(tokens, mode) {
  if (mode === 'bare') {
    return tokens.filter((t) => !(t.type === 'word' && t.value.toLowerCase() === 'as'));
  }
  if (mode !== 'as') return tokens;

  const insertAt = new Set();
  collectAliasPositions(tokens, insertAt, 0);

  if (!insertAt.size) return tokens;
  const out = tokens.slice();
  for (const p of [...insertAt].sort((a, b) => b - a)) {
    out.splice(p, 0, { type: 'word', value: 'AS' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

// Render a clause body. In perKeywordSub mode, (SELECT…) subqueries expand to
// indented, keyword-broken blocks; line comments (--, #) go on their own line.
function renderBody(tokens, mode, indentLevel, alignment) {
  const pad = indentFn(indentLevel);
  const contPad = indentFn(indentLevel + 1);
  let out = '';
  let prev = null;
  let i = 0;
  const n = tokens.length;
  while (i < n) {
    const t = tokens[i];
    if (mode === 'perKeywordSub' && t.value === '(' && isOpenSubquery(tokens, i)) {
      const close = matchingClose(tokens, i);
      const inner = tokens.slice(i + 1, close);
      out += tokenSep(prev, t, contPad);
      out += '(\n' + renderLayout(inner, mode, indentLevel + 1, alignment) + '\n' + pad + ')';
      prev = { type: 'op', value: ')' };
      i = close + 1;
      continue;
    }
    out += tokenSep(prev, t, contPad);
    out += t.value;
    prev = t;
    i++;
  }
  return out;
}

// Render a block (one statement, or a subquery body) broken by clause keyword.
function renderLayout(tokens, mode, indentLevel, alignment) {
  const ranges = clauseRanges(tokens);
  const lines = ranges.map((r) => {
    const headStr = r.headLen > 0
      ? tokens.slice(r.headStart, r.headStart + r.headLen).map((t) => t.value).join(' ')
      : '';
    const body = tokens.slice(r.bodyStart, r.bodyEnd);
    return { headStr, tailStr: renderBody(body, mode, indentLevel, alignment) };
  });

  const headLens = lines.filter((l) => l.headStr).map((l) => l.headStr.length);
  const maxHead = headLens.length ? Math.max(...headLens) : 0;
  const pad = indentFn(indentLevel);

  return lines.map((l) => {
    if (l.headStr) {
      const h = alignment === 'aligned' ? l.headStr.padEnd(maxHead) : l.headStr;
      const sep = l.tailStr ? ' ' : '';
      return pad + h + sep + l.tailStr;
    }
    return pad + l.tailStr;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Statement-level transforms
// ---------------------------------------------------------------------------

// Split a SQL string into statements on ';' (quote-aware). Empty pieces dropped.
export function splitStatements(sql) {
  const stmts = [];
  let buf = '';
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; buf += c; continue; }
    if (c === ';') {
      const s = buf.trim();
      if (s) stmts.push(s);
      buf = '';
      continue;
    }
    buf += c;
  }
  const last = buf.trim();
  if (last) stmts.push(last);
  return stmts;
}

// Derive a snake_case MySQL variable name from a placeholder ref.
function toVarName(ref) {
  let s = ref.replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  return s || 'p';
}

// Hoist {{ref|fmt}} placeholders used >= threshold times into SET @var = ...;
// returns { statements, setStmts }.
export function variabilize(statements, threshold) {
  const counts = {};
  const re = /\{\{([^}]+)\}\}/g;
  for (const s of statements) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const inner = m[1].trim();
      counts[inner] = (counts[inner] || 0) + 1;
    }
  }

  const map = {}; // inner -> varname
  const used = {};
  for (const inner of Object.keys(counts)) {
    if (counts[inner] >= threshold) {
      const ref = inner.split('|')[0].trim();
      const base = toVarName(ref);
      let name = base;
      let n = 2;
      while (used[name]) { name = base + '_' + n; n++; }
      used[name] = true;
      map[inner] = name;
    }
  }

  const out = statements.map((s) => {
    let res = s;
    for (const inner of Object.keys(map)) {
      const token = '{{' + inner + '}}';
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      res = res.replace(new RegExp(escaped, 'g'), '@' + map[inner]);
    }
    return res;
  });

  const setStmts = Object.keys(map).map((inner) => 'SET @' + map[inner] + ' = {{' + inner + '}}');
  return { statements: out, setStmts };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

// opts: {
//   layout:           'oneLine' | 'perKeyword' | 'perKeywordSub',  // default perKeyword
//   alignment:        'off' | 'aligned',                            // default off
//   capitalization:   'unchanged' | 'keywords',                     // default unchanged
//   aliases:          'unchanged' | 'as' | 'bare',                  // default unchanged
//   variables:        'none' | 'repeated' | 'all',                  // default none
//   unwrapDateFormat: boolean,                                       // default false
//   unwrapVariables:  boolean,                                       // default false
// }
export function prettify(sql, opts = {}) {
  const layout = opts.layout || 'perKeyword';
  const alignment = opts.alignment || 'off';
  const capitalization = opts.capitalization || 'unchanged';
  const aliases = opts.aliases || 'unchanged';
  const variables = opts.variables || 'none';
  const unwrapDateFormat = !!opts.unwrapDateFormat;
  const unwrapVariables = !!opts.unwrapVariables;

  let stmts = splitStatements(sql);

  let setStmts = [];
  if (variables === 'repeated' || variables === 'all') {
    const threshold = variables === 'all' ? 1 : 2;
    const v = variabilize(stmts, threshold);
    stmts = v.statements;
    setStmts = v.setStmts;
  }

  const render = (s) => {
    let tokens = tokenize(s);
    tokens = applyUnwrapVariables(tokens, unwrapVariables);
    tokens = applyDateFormat(tokens, unwrapDateFormat);
    tokens = applyCapitalization(tokens, capitalization);
    tokens = applyAliases(tokens, aliases);
    if (layout === 'oneLine') return renderBody(tokens, layout, 0, alignment);
    return renderLayout(tokens, layout, 0, alignment);
  };

  return [...setStmts, ...stmts].map(render).join(';\n');
}
