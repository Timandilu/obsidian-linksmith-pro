import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import * as esbuild from 'esbuild';

async function importTriggerHelpers() {
	const result = await esbuild.build({
		entryPoints: ['src/trigger.ts'],
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
	});
	const encoded = Buffer.from(result.outputFiles[0].text, 'utf8').toString(
		'base64',
	);
	return import(`data:text/javascript;base64,${encoded}`);
}

test('minimum trigger counts letters and digits, not spaces or punctuation', async () => {
	const { countTriggerCharacters, meetsMinimumTriggerCharacters } =
		await importTriggerHelpers();

	assert.equal(countTriggerCharacters('ab - c'), 3);
	assert.equal(meetsMinimumTriggerCharacters('ab - c', 4), false);
	assert.equal(meetsMinimumTriggerCharacters('abcd', 4), true);
	assert.equal(meetsMinimumTriggerCharacters('Äöü1', 4), true);
});
