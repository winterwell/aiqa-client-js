#!/usr/bin/env node
/**
 * Syncs src/common as a STRAIGHT COPY of aiqa/server/src/common.
 *
 * aiqa/server/src/common is the CANONICAL SOURCE for these files. Never edit
 * anything under src/common in this repo - edits belong in the aiqa server
 * repo, after which you re-run this script. Local edits here are silently
 * overwritten by the next sync and reported as drift by `--check`.
 *
 *   npm run sync-types            copy from the server repo
 *   npm run sync-types -- --check exit 1 if src/common has drifted
 *
 * The copy is exact: files added, changed, or DELETED in the server repo are
 * mirrored here, so src/common never accumulates files the server has dropped.
 * .ts files get a generated-file banner prepended; every other file (.json
 * schemas, .md) is copied byte-for-byte, since JSON cannot carry a comment.
 *
 * --check is a no-op when the server repo is not checked out alongside this
 * one, which is the normal case on CI and for outside contributors.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = resolve(REPO_ROOT, '../aiqa/server/src/common');
const DEST_DIR = join(REPO_ROOT, 'src/common');

const BANNER = `// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run \`npm run sync-types\`.

`;

const check = process.argv.includes('--check');

if (!existsSync(SOURCE_DIR)) {
	if (check) {
		console.log(`sync-types: ${SOURCE_DIR} not found - skipping drift check.`);
		process.exit(0);
	}
	console.error(`sync-types: canonical source not found: ${SOURCE_DIR}`);
	console.error('Check out the aiqa repo alongside this one and retry.');
	process.exit(1);
}

/** Relative paths of every file under dir. */
function listFiles(dir, base = dir) {
	if (!existsSync(dir)) return [];
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listFiles(full, base));
		else if (entry.isFile()) out.push(relative(base, full));
	}
	return out;
}

/** What the vendored copy of a source file should contain, byte for byte. */
function expectedContent(relPath) {
	const raw = readFileSync(join(SOURCE_DIR, relPath));
	return relPath.endsWith('.ts') ? Buffer.from(BANNER + raw.toString('utf8')) : raw;
}

const sourceFiles = listFiles(SOURCE_DIR);
const destFiles = listFiles(DEST_DIR);
const stale = destFiles.filter((f) => !sourceFiles.includes(f));

const drifted = [];
let written = 0;

for (const relPath of sourceFiles) {
	const destPath = join(DEST_DIR, relPath);
	const expected = expectedContent(relPath);
	const actual = existsSync(destPath) ? readFileSync(destPath) : null;

	if (actual !== null && actual.equals(expected)) continue;

	if (check) {
		drifted.push(actual === null ? `${relPath} (missing)` : relPath);
		continue;
	}

	mkdirSync(dirname(destPath), { recursive: true });
	writeFileSync(destPath, expected);
	written++;
}

if (check) {
	if (drifted.length || stale.length) {
		console.error('sync-types: src/common has drifted from aiqa/server/src/common:');
		for (const f of drifted) console.error(`  changed: ${f}`);
		for (const f of stale) console.error(`  stale (deleted upstream): ${f}`);
		console.error('\nRun `npm run sync-types` to resync, then review and commit the result.');
		process.exit(1);
	}
	console.log(`sync-types: src/common is in sync (${sourceFiles.length} files).`);
} else {
	for (const relPath of stale) rmSync(join(DEST_DIR, relPath));
	const parts = [`${sourceFiles.length} files`];
	if (written) parts.push(`${written} written`);
	if (stale.length) parts.push(`${stale.length} removed`);
	console.log(
		written || stale.length
			? `sync-types: synced src/common (${parts.join(', ')}).`
			: `sync-types: src/common already up to date (${sourceFiles.length} files).`
	);
}
