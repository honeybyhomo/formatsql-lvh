// Pure SQL transform functions shared by the CLI (tools/prettify-sql.mjs)
// and the web app (formatsql.lvh.dev). No Node-specific imports — safe for
// the browser.

// Quote characters we track so transforms don't touch string literals/identifiers.
const QUOTES = "'\"`";

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
    if (QUOTES.includes(c)) { quote = c; buf += c; continue; }
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

// Collapse runs of whitespace to a single space (quote-aware), one line.
export function compactStatement(stmt) {
  let out = '';
  let quote = null;
  let wantSpace = false;
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      continue;
    }
    if (QUOTES.includes(c)) {
      if (wantSpace) { out += ' '; wantSpace = false; }
      quote = c;
      out += c;
      continue;
    }
    if (/\s/.test(c)) {
      if (out.length > 0) wantSpace = true;
      continue;
    }
    if (wantSpace) { out += ' '; wantSpace = false; }
    out += c;
  }
  return out.trim();
}

// Split a function-argument string on top-level commas (quote/paren aware).
function splitTopLevelComma(s) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { buf += c; if (c === quote) quote = null; continue; }
    if (QUOTES.includes(c)) { quote = c; buf += c; continue; }
    if (c === '(') { depth++; buf += c; continue; }
    if (c === ')') { depth--; buf += c; continue; }
    if (c === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += c;
  }
  parts.push(buf);
  return parts;
}

// DATE_FORMAT(expr, '%Y-%m-%d') -> DATE(expr). Quote- and paren-aware; only
// matches the keyword at a word boundary so XDATE_FORMAT( is left alone.
export function simplifyDateFormat(stmt) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < stmt.length) {
    const c = stmt[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (QUOTES.includes(c)) { quote = c; out += c; i++; continue; }

    const prevChar = i > 0 ? stmt[i - 1] : '';
    const wordBoundary = !/[A-Za-z0-9_]/.test(prevChar);
    const m = wordBoundary ? /^DATE_FORMAT\s*\(/i.exec(stmt.slice(i)) : null;

    if (m) {
      const openParen = i + m[0].length - 1;
      let depth = 1;
      let k = openParen + 1;
      let q = null;
      while (k < stmt.length && depth > 0) {
        const cc = stmt[k];
        if (q) { if (cc === q) q = null; k++; continue; }
        if (QUOTES.includes(cc)) { q = cc; k++; continue; }
        if (cc === '(') { depth++; k++; continue; }
        if (cc === ')') { depth--; if (depth === 0) break; k++; continue; }
        k++;
      }
      if (depth === 0) {
        const args = stmt.slice(openParen + 1, k);
        const parts = splitTopLevelComma(args);
        if (parts.length === 2) {
          const expr = parts[0].trim();
          const fmt = parts[1].trim().replace(/^['"`]|['"`]$/g, '');
          if (fmt === '%Y-%m-%d') {
            out += 'DATE(' + expr + ')';
            i = k + 1;
            continue;
          }
        }
      }
    }
    out += c;
    i++;
  }
  return out;
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

// Orchestrator: apply the selected transforms to a SQL string.
// opts: { compact, variabilize, variabilizeAll, simplifyDateFormat }
export function prettify(sql, opts = {}) {
  // Locals are prefixed do* to avoid shadowing the transform functions of the
  // same name (variabilize, simplifyDateFormat).
  const doCompact = opts.compact !== false; // default true
  const doVariabilize = !!opts.variabilize;
  const variabilizeAll = !!opts.variabilizeAll;
  const doSimplify = !!opts.simplifyDateFormat;

  let stmts = splitStatements(sql);

  if (doSimplify) {
    stmts = stmts.map(simplifyDateFormat);
  }

  let setStmts = [];
  if (doVariabilize) {
    const threshold = variabilizeAll ? 1 : 2;
    const v = variabilize(stmts, threshold);
    stmts = v.statements;
    setStmts = v.setStmts;
  }

  if (doCompact) {
    stmts = stmts.map(compactStatement);
    setStmts = setStmts.map(compactStatement);
  }

  const all = [...setStmts, ...stmts].map((s) => s.replace(/;\s*$/, ''));
  return all.join(';\n');
}
