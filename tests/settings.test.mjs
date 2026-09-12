import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import * as esbuild from 'esbuild';

async function importBundled(entryPoint, plugins = []) {
	const result = await esbuild.build({
		entryPoints: [entryPoint],
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		plugins,
	});
	const encoded = Buffer.from(result.outputFiles[0].text, 'utf8').toString(
		'base64',
	);
	return import(`data:text/javascript;base64,${encoded}`);
}

function obsidianStubPlugin() {
	return {
		name: 'obsidian-test-stub',
		setup(build) {
			build.onResolve({ filter: /^obsidian$/ }, () => ({
				path: 'obsidian',
				namespace: 'obsidian-test-stub',
			}));
			build.onLoad(
				{ filter: /.*/, namespace: 'obsidian-test-stub' },
				() => ({
					loader: 'js',
					contents: `
						const state = globalThis.__linksmithSettingsTest;

						class Control {
							constructor(type, setting) {
								this.type = type;
								this.setting = setting;
							}
							setValue(value) { this.value = value; return this; }
							setLimits(min, max, step) { this.limits = [min, max, step]; return this; }
							setButtonText(value) { this.buttonText = value; return this; }
							onChange(callback) { this.change = callback; return this; }
							onClick(callback) { this.click = callback; return this; }
						}

						export class Setting {
							constructor() { state.settings.push(this); }
							setName(value) { this.name = value; return this; }
							setDesc(value) { this.desc = value; return this; }
							setHeading() { this.heading = true; return this; }
							addToggle(callback) { return this.addControl('toggle', callback); }
							addSlider(callback) { return this.addControl('slider', callback); }
							addTextArea(callback) { return this.addControl('textarea', callback); }
							addButton(callback) { return this.addControl('button', callback); }
							addControl(type, callback) {
								this.control = new Control(type, this);
								callback(this.control);
								return this;
							}
						}

						export class PluginSettingTab {
							constructor(app, plugin) {
								this.app = app;
								this.plugin = plugin;
								this.containerEl = state.containerEl;
							}
						}

						export class Notice {
							constructor(message) { state.notices.push(message); }
						}
					`,
				}),
			);
		},
	};
}

test('normalizeSettings preserves defaults and accepts only compatible saved values', async () => {
	const { normalizeSettings } = await importBundled('src/settings-data.ts');
	const defaults = {
		enabled: true,
		threshold: 2,
		label: 'Linksmith',
		folders: ['Inbox'],
		patterns: ['TODO'],
	};

	const normalized = normalizeSettings(
		{
			enabled: 'yes',
			threshold: Number.POSITIVE_INFINITY,
			label: 7,
			folders: ['Projects', 42, null, ''],
			patterns: 'Draft',
			unknown: true,
		},
		defaults,
	);

	assert.deepEqual(normalized, {
		enabled: true,
		threshold: 2,
		label: 'Linksmith',
		folders: ['Projects', ''],
		patterns: ['TODO'],
	});
	assert.notStrictEqual(normalized.folders, defaults.folders);
	assert.notStrictEqual(normalized.patterns, defaults.patterns);
	normalized.folders.push('Archive');
	normalized.patterns.push('Draft');
	assert.deepEqual(defaults.folders, ['Inbox']);
	assert.deepEqual(defaults.patterns, ['TODO']);

	assert.deepEqual(
		normalizeSettings({ enabled: false, threshold: 0 }, defaults),
		{
			...defaults,
			enabled: false,
			threshold: 0,
			folders: ['Inbox'],
			patterns: ['TODO'],
		},
	);
	assert.deepEqual(normalizeSettings(null, defaults), defaults);
});

test('settings definitions and legacy display expose all controls without a DOM', async () => {
	const state = {
		settings: [],
		notices: [],
		containerEl: {
			emptyCalls: 0,
			empty() {
				this.emptyCalls += 1;
			},
		},
	};
	globalThis.__linksmithSettingsTest = state;
	const { LinksmithSettingTab } = await importBundled('src/settings-tab.ts', [
		obsidianStubPlugin(),
	]);
	const calls = { save: 0, build: 0 };
	const plugin = {
		settings: {
			suggestEnabled: true,
			suggestHeadingsEnabled: true,
			minCharsToTrigger: 2,
			maxSuggestions: 10,
			startOfWordOnly: true,
			partialWordMatches: true,
			useTypedAsAlias: true,
			maxSpacesToTrigger: 1,
			showSuggestionPath: true,
			minHeadingDepth: 1,
			maxHeadingDepth: 6,
			preferHeadingsOverNotes: false,
			weightTitle: 1,
			weightHeading: 0.8,
			weightBacklinks: 0.6,
			weightRecency: 0.3,
			excludedFolders: [],
			excludedFiles: [],
			excludedTags: [],
			excludedTitlePatterns: ['TODO'],
			excludedHeadingPatterns: ['^TODO'],
			retroEnabled: true,
			retroMinConfidence: 0.6,
		},
		async saveSettings() {
			calls.save += 1;
		},
		indexer: {
			async build() {
				calls.build += 1;
			},
		},
	};
	const tab = new LinksmithSettingTab({}, plugin);
	const definitions = tab.getSettingDefinitions();
	const definitionNames = definitions.flatMap((section) =>
		section.items.map((item) => item.name),
	);

	assert.equal(definitions.length, 6);
	assert.equal(definitionNames.length, 24);
	assert.equal(
		state.settings.length,
		0,
		'registration must not require Setting or DOM',
	);

	tab.display();
	const renderedControls = state.settings.filter(
		(setting) => setting.control,
	);
	assert.equal(state.containerEl.emptyCalls, 1);
	assert.deepEqual(
		renderedControls.map((setting) => setting.name),
		definitionNames,
	);
	assert.equal(renderedControls.length, 24);

	const control = (name) => {
		const setting = renderedControls.find(
			(candidate) => candidate.name === name,
		);
		assert.ok(setting, `Missing rendered setting: ${name}`);
		return setting.control;
	};

	await control('Enable suggestions').change(false);
	assert.equal(plugin.settings.suggestEnabled, false);
	assert.deepEqual(calls, { save: 1, build: 0 });

	await control('Minimum characters to trigger').change(4);
	assert.equal(plugin.settings.minCharsToTrigger, 4);
	assert.deepEqual(
		control('Minimum characters to trigger').limits,
		[1, 5, 1],
	);
	assert.deepEqual(calls, { save: 2, build: 0 });

	await control('Enable heading suggestions').change(false);
	assert.equal(plugin.settings.suggestHeadingsEnabled, false);
	assert.deepEqual(calls, { save: 3, build: 1 });

	await control('Excluded folders').change(' Projects, , Archive/Subfolder ');
	assert.deepEqual(plugin.settings.excludedFolders, [
		'Projects',
		'Archive/Subfolder',
	]);
	assert.deepEqual(calls, { save: 4, build: 2 });

	await control('Rebuild index').click();
	assert.deepEqual(calls, { save: 4, build: 3 });
	assert.deepEqual(state.notices, [
		'Rebuilding index...',
		'Index rebuilt successfully',
	]);

	delete globalThis.__linksmithSettingsTest;
});
