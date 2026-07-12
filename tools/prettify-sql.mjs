#!/usr/bin/env node
// tools/prettify-sql.mjs — prettify/optimize Google Sheets SQL queries.
//
// Reads SQL from stdin (if piped) or the macOS clipboard, applies the chosen
// transforms, and writes the result to stdout AND the clipboard.
//
// Usage:
//   pbpaste | node tools/prettify-sql.mjs --pretty
//   node tools/prettify-sql.mjs --pretty          # reads clipboard, writes clipboard
//   echo "select *  from  t" | node tools/prettify-sql.mjs
//
// Options (defaults: single-line layout, everything else off):
//   --one-line / --per-keyword / --per-keyword-sub   layout style
//   --aligned                          pad clause keywords so columns align
//   --keywords                         uppercase SQL keywords (+ function names)
//   --as / --no-as                     enforce / strip column & table aliases
//   --variables repeated|all           hoist {{ref|fmt}} into SET @var = ...
//   --unwrap-dateformat                 DATE_FORMAT(col, '%Y-%m-%d') → col
//   --unwrap-variables                  strip quotes off a lone '@var' literal ('@x' → @x)
//   --pretty                           convenience: per-keyword-sub + aligned +
//                                      keywords + as + variables repeated +
//                                      unwrap-dateformat + unwrap-variables
//
// The pure transform logic lives in web/src/lib/prettify.js and is shared
// with the web app (formatsql.lvh.dev).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { prettify } from '../web/src/lib/prettify.js';

// ---------- flag parsing ----------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const opts = has('--pretty')
  ? {
      layout: 'perKeywordSub',
      alignment: 'aligned',
      capitalization: 'keywords',
      aliases: 'as',
      variables: 'repeated',
      unwrapDateFormat: true,
      unwrapVariables: true,
    }
  : {
      layout: has('--per-keyword-sub')
        ? 'perKeywordSub'
        : has('--per-keyword')
          ? 'perKeyword'
          : 'oneLine',
      alignment: has('--aligned') ? 'aligned' : 'off',
      capitalization: has('--keywords') ? 'keywords' : 'unchanged',
      aliases: has('--no-as') ? 'bare' : has('--as') ? 'as' : 'unchanged',
      variables: val('--variables') === 'all' ? 'all' : val('--variables') === 'repeated' ? 'repeated' : 'none',
      unwrapDateFormat: has('--unwrap-dateformat'),
      unwrapVariables: has('--unwrap-variables'),
    };

// ---------- I/O ----------
function readInput() {
  if (!process.stdin.isTTY) {
    return readFileSync(0, 'utf8');
  }
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' });
  } catch (e) {
    console.error('No stdin piped and pbpaste unavailable. Pipe SQL in or run on macOS.');
    process.exit(1);
  }
}

function writeOutput(text) {
  process.stdout.write(text + '\n');
  try {
    execFileSync('pbcopy', { input: text, encoding: 'utf8' });
  } catch (e) {
    /* clipboard unavailable — stdout only */
  }
}

// ---------- main ----------
const input = readInput();
if (!input.trim()) {
  console.error('No input.');
  process.exit(1);
}
writeOutput(prettify(input, opts));
