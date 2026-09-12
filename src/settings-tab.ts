import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionGroup, SettingDefinitionRender } from 'obsidian';
import type LinksmithPlugin from '../main';

type SettingsRow = Omit<SettingDefinitionRender, 'render'> & {
	render(setting: Setting): void;
};
type SettingsSection = Omit<SettingDefinitionGroup, 'type' | 'items'> & {
	type: 'group';
	items: SettingsRow[];
};

export class LinksmithSettingTab extends PluginSettingTab {
	plugin: LinksmithPlugin;

	constructor(app: App, plugin: LinksmithPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingsSection[] {
		return [
			{
				type: 'group',
				heading: 'Live suggestions',
				items: [
					{
						name: 'Enable suggestions',
						desc: 'Show link suggestions while typing',
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle
									.setValue(
										this.plugin.settings.suggestEnabled,
									)
									.onChange(async (value) => {
										this.plugin.settings.suggestEnabled =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Enable heading suggestions',
						desc: 'Include headings in suggestions',
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle
									.setValue(
										this.plugin.settings
											.suggestHeadingsEnabled,
									)
									.onChange(async (value) => {
										this.plugin.settings.suggestHeadingsEnabled =
											value;
										await this.plugin.saveSettings();
										await this.plugin.indexer.build();
									}),
							);
						},
					},
					{
						name: 'Minimum characters to trigger',
						desc: 'Letters or digits required before suggestions appear, including after [[',
						render: (setting) => {
							setting.addSlider((slider) =>
								slider
									.setLimits(1, 5, 1)
									.setValue(
										this.plugin.settings.minCharsToTrigger,
									)
									.onChange(async (value) => {
										this.plugin.settings.minCharsToTrigger =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Maximum suggestions',
						desc: 'Maximum number of suggestions to show',
						render: (setting) => {
							setting.addSlider((slider) =>
								slider
									.setLimits(5, 20, 1)
									.setValue(
										this.plugin.settings.maxSuggestions,
									)
									.onChange(async (value) => {
										this.plugin.settings.maxSuggestions =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Start of word matching only',
						desc: 'When enabled, only matches at the start of words. Example: "wan" matches "wants" but not "swan". When disabled, matches anywhere.',
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle
									.setValue(
										this.plugin.settings.startOfWordOnly,
									)
									.onChange(async (value) => {
										this.plugin.settings.startOfWordOnly =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Enable partial word matches',
						desc: 'When enabled, finds matches within words. Example: "schaden" matches "Schadensersatz"',
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle
									.setValue(
										this.plugin.settings.partialWordMatches,
									)
									.onChange(async (value) => {
										this.plugin.settings.partialWordMatches =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Use typed text as alias',
						desc: 'If enabled, creates links as [[Target|typed]] so the original text is preserved inside the link.',
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle
									.setValue(
										this.plugin.settings.useTypedAsAlias,
									)
									.onChange(async (value) => {
										this.plugin.settings.useTypedAsAlias =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Maximum spaces to trigger',
						desc: 'How many spaces may appear in a typed phrase before suggestions stop appearing.',
						render: (setting) => {
							setting.addSlider((slider) =>
								slider
									.setLimits(0, 5, 1)
									.setValue(
										this.plugin.settings.maxSpacesToTrigger,
									)
									.onChange(async (value) => {
										this.plugin.settings.maxSpacesToTrigger =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Show folder path in suggestions',
						desc: 'Display the parent folder in small grey text under each suggestion.',
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle
									.setValue(
										this.plugin.settings.showSuggestionPath,
									)
									.onChange(async (value) => {
										this.plugin.settings.showSuggestionPath =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Heading options',
				items: [
					{
						name: 'Minimum heading depth',
						desc: 'Minimum heading level to index (1 = H1)',
						render: (setting) => {
							setting.addSlider((slider) =>
								slider
									.setLimits(1, 6, 1)
									.setValue(
										this.plugin.settings.minHeadingDepth,
									)
									.onChange(async (value) => {
										this.plugin.settings.minHeadingDepth =
											value;
										await this.plugin.saveSettings();
										await this.plugin.indexer.build();
									}),
							);
						},
					},
					{
						name: 'Maximum heading depth',
						desc: 'Maximum heading level to index (6 = H6)',
						render: (setting) => {
							setting.addSlider((slider) =>
								slider
									.setLimits(1, 6, 1)
									.setValue(
										this.plugin.settings.maxHeadingDepth,
									)
									.onChange(async (value) => {
										this.plugin.settings.maxHeadingDepth =
											value;
										await this.plugin.saveSettings();
										await this.plugin.indexer.build();
									}),
							);
						},
					},
					{
						name: 'Prefer headings over notes',
						desc: 'When enabled, heading matches will be scored higher',
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle
									.setValue(
										this.plugin.settings
											.preferHeadingsOverNotes,
									)
									.onChange(async (value) => {
										this.plugin.settings.preferHeadingsOverNotes =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Scoring weights',
				items: [
					{
						name: 'Title weight',
						desc: 'Weight for title matches',
						render: (setting) => {
							setting.addSlider((slider) =>
								slider
									.setLimits(0, 2, 0.1)
									.setValue(this.plugin.settings.weightTitle)
									.onChange(async (value) => {
										this.plugin.settings.weightTitle =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Heading weight',
						desc: 'Weight for heading matches',
						render: (setting) => {
							setting.addSlider((slider) =>
								slider
									.setLimits(0, 2, 0.1)
									.setValue(
										this.plugin.settings.weightHeading,
									)
									.onChange(async (value) => {
										this.plugin.settings.weightHeading =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Backlinks weight',
						desc: 'Weight for number of backlinks',
						render: (setting) => {
							setting.addSlider((slider) =>
								slider
									.setLimits(0, 2, 0.1)
									.setValue(
										this.plugin.settings.weightBacklinks,
									)
									.onChange(async (value) => {
										this.plugin.settings.weightBacklinks =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Recency weight',
						desc: 'Weight for recently modified notes',
						render: (setting) => {
							setting.addSlider((slider) =>
								slider
									.setLimits(0, 2, 0.1)
									.setValue(
										this.plugin.settings.weightRecency,
									)
									.onChange(async (value) => {
										this.plugin.settings.weightRecency =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Exclusions',
				items: [
					{
						name: 'Excluded folders',
						desc: 'Comma-separated list of folder paths to exclude',
						render: (setting) => {
							setting.addTextArea((text) =>
								text
									.setValue(
										this.plugin.settings.excludedFolders.join(
											', ',
										),
									)
									.onChange(async (value) => {
										this.plugin.settings.excludedFolders =
											value
												.split(',')
												.map((s) => s.trim())
												.filter((s) => s.length > 0);
										await this.plugin.saveSettings();
										await this.plugin.indexer.build();
									}),
							);
						},
					},
					{
						name: 'Excluded files',
						desc: 'Comma-separated list of file paths to exclude',
						render: (setting) => {
							setting.addTextArea((text) =>
								text
									.setValue(
										this.plugin.settings.excludedFiles.join(
											', ',
										),
									)
									.onChange(async (value) => {
										this.plugin.settings.excludedFiles =
											value
												.split(',')
												.map((s) => s.trim())
												.filter((s) => s.length > 0);
										await this.plugin.saveSettings();
										await this.plugin.indexer.build();
									}),
							);
						},
					},
					{
						name: 'Excluded tags',
						desc: 'Comma-separated list of tags to exclude (include #)',
						render: (setting) => {
							setting.addTextArea((text) =>
								text
									.setValue(
										this.plugin.settings.excludedTags.join(
											', ',
										),
									)
									.onChange(async (value) => {
										this.plugin.settings.excludedTags =
											value
												.split(',')
												.map((s) => s.trim())
												.filter((s) => s.length > 0);
										await this.plugin.saveSettings();
										await this.plugin.indexer.build();
									}),
							);
						},
					},
					{
						name: 'Excluded title patterns',
						desc: 'Comma-separated regex patterns for titles to exclude',
						render: (setting) => {
							setting.addTextArea((text) =>
								text
									.setValue(
										this.plugin.settings.excludedTitlePatterns.join(
											', ',
										),
									)
									.onChange(async (value) => {
										this.plugin.settings.excludedTitlePatterns =
											value
												.split(',')
												.map((s) => s.trim())
												.filter((s) => s.length > 0);
										await this.plugin.saveSettings();
										await this.plugin.indexer.build();
									}),
							);
						},
					},
					{
						name: 'Excluded heading patterns',
						desc: 'Comma-separated regex patterns for headings to exclude',
						render: (setting) => {
							setting.addTextArea((text) =>
								text
									.setValue(
										this.plugin.settings.excludedHeadingPatterns.join(
											', ',
										),
									)
									.onChange(async (value) => {
										this.plugin.settings.excludedHeadingPatterns =
											value
												.split(',')
												.map((s) => s.trim())
												.filter((s) => s.length > 0);
										await this.plugin.saveSettings();
										await this.plugin.indexer.build();
									}),
							);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Retro-linking',
				items: [
					{
						name: 'Enable retro-linking',
						desc: 'Allow batch link suggestions',
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle
									.setValue(this.plugin.settings.retroEnabled)
									.onChange(async (value) => {
										this.plugin.settings.retroEnabled =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: 'Minimum confidence',
						desc: 'Minimum confidence score for suggestions (0-1)',
						render: (setting) => {
							setting.addSlider((slider) =>
								slider
									.setLimits(0, 1, 0.05)
									.setValue(
										this.plugin.settings.retroMinConfidence,
									)
									.onChange(async (value) => {
										this.plugin.settings.retroMinConfidence =
											value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Performance',
				items: [
					{
						name: 'Rebuild index',
						desc: 'Rebuild the entire search index',
						render: (setting) => {
							setting.addButton((button) =>
								button
									.setButtonText('Rebuild')
									.onClick(async () => {
										new Notice('Rebuilding index...');
										await this.plugin.indexer.build();
										new Notice(
											'Index rebuilt successfully',
										);
									}),
							);
						},
					},
				],
			},
		];
	}

	// Obsidian before 1.13 renders the same definitions through this fallback.
	display(): void {
		this.containerEl.empty();
		for (const section of this.getSettingDefinitions()) {
			new Setting(this.containerEl)
				.setName(section.heading ?? '')
				.setHeading();
			for (const definition of section.items) {
				const setting = new Setting(this.containerEl)
					.setName(definition.name)
					.setDesc(definition.desc ?? '');
				definition.render(setting);
			}
		}
	}
}
