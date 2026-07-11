#!/usr/bin/env node
// tools/prettify-sql.mjs — prettify/optimize Google Sheets SQL queries.
//
// Reads SQL from stdin (if piped) or the macOS clipboard, applies the chosen
// transforms, and writes the result to stdout AND the clipboard.
//
// Usage:
//   pbpaste | node tools/prettify-sql.mjs --all
//   node tools/prettify-sql.mjs --all            # reads clipboard, writes clipboard
//   echo "SELECT *  FROM  t" | node tools/prettify-sql.mjs --compact
//
// Transforms (all off by default except --compact):
//   --compact              collapse whitespace; one statement per line (default on)
//   --keep-newlines        don't compact (preserve your line breaks)
//   --variabilize          hoist {{ref|fmt}} used >=2x into SET @var = ...;
//   --variabilize-all      hoist every {{ref|fmt}} (even single-use)
//   --simplify-dateformat  DATE_FORMAT(x,'%Y-%m-%d') -> DATE(x)
//                          (safe once the API formats DATE columns cleanly)
//   --all                  compact + variabilize + simplify-dateformat
//
// The pure transform logic lives in web/src/lib/prettify.js and is shared
// with the web app (formatsql.lvh.dev).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { prettify } from '../web/src/lib/prettify.js';

// ---------- flag parsing ----------
const argv = process.argv.slice(2);
const opts = {
  compact: !argv.includes('--keep-newlines'),
  variabilize: argv.includes('--variabilize') || argv.includes('--variabilize-all') || argv.includes('--all'),
  variabilizeAll: argv.includes('--variabilize-all'),
  simplifyDateFormat: argv.includes('--simplify-dateformat') || argv.includes('--all'),
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
