import {
	Plugin,
	TFile,
	Notice,
	EditorSuggest,
	Editor,
	EditorPosition,
	EditorSuggestTriggerInfo,
	EditorSuggestContext,
	Modal,
	ButtonComponent,
	debounce,
	parseFrontMatterAliases,
} from 'obsidian';
import { meetsMinimumTriggerCharacters } from './src/trigger';
import { normalizeSettings } from './src/settings-data';
import { LinksmithSettingTab } from './src/settings-tab';

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

export interface LinksmithSettings {
	// Suggest settings
	suggestEnabled: boolean;
	suggestHeadingsEnabled: boolean;
	minCharsToTrigger: number;
	maxSuggestions: number;
	fuzzyThreshold: number;
	startOfWordOnly: boolean; // ADD THIS LINE
	useTypedAsAlias: boolean; // NEW
	maxSpacesToTrigger: number; // NEW (if not already present)
	showSuggestionPath: boolean;

	// Scoring weights
	weightTitle: number;
	weightHeading: number;
	weightBacklinks: number;
	weightRecency: number;
	weightAlias: number;

	// Heading settings
	minHeadingDepth: number;
	maxHeadingDepth: number;
	preferHeadingsOverNotes: boolean;

	// Exclusions
	excludedFolders: string[];
	excludedFiles: string[];
	excludedTags: string[];
	excludedTitlePatterns: string[];
	excludedHeadingPatterns: string[];

	// Retro-link settings
	retroEnabled: boolean;
	retroReplaceFirst: boolean;
	retroReplaceAll: boolean;
	retroCreateAliases: boolean;
	retroMinConfidence: number;

	// Performance
	debounceDelay: number;
	enableCache: boolean;

	// Partial word matches
	partialWordMatches: boolean; // Add this line
}

const DEFAULT_SETTINGS: LinksmithSettings = {
	suggestEnabled: true,
	suggestHeadingsEnabled: true,
	minCharsToTrigger: 2,
	maxSuggestions: 10,
	fuzzyThreshold: 0.5,
	startOfWordOnly: true, // ADD THIS LINE (default: true)
	useTypedAsAlias: true,
	maxSpacesToTrigger: 1,
	showSuggestionPath: true,

	weightTitle: 1.0,
	weightHeading: 0.8,
	weightBacklinks: 0.6,
	weightRecency: 0.3,
	weightAlias: 0.9,

	minHeadingDepth: 1,
	maxHeadingDepth: 6,
	preferHeadingsOverNotes: false,

	excludedFolders: [],
	excludedFiles: [],
	excludedTags: [],
	excludedTitlePatterns: ['TODO', 'Draft'],
	excludedHeadingPatterns: ['^TODO', '^Draft'],

	retroEnabled: true,
	retroReplaceFirst: true,
	retroReplaceAll: false,
	retroCreateAliases: false,
	retroMinConfidence: 0.6,

	debounceDelay: 100,
	enableCache: true,

	partialWordMatches: true, // Add this line with default true
};

interface NoteEntry {
	path: string;
	title: string;
	aliases: string[];
	tags: string[];
	backlinkCount: number;
	lastModified: number;
}

interface HeadingEntry {
	notePath: string;
	noteTitle: string;
	heading: string;
	level: number;
	position: number;
}

interface Candidate {
	key: string;
	kind: 'note' | 'heading';
	score: number;
	path: string;
	title: string;
	heading?: string;
	headingLevel?: number;
	preview?: string;
	matchedAlias?: string;
}

interface RetroSuggestion {
	span: string;
	link: string;
	kind: 'note' | 'heading';
	confidence: number;
	context: string;
	lineNumber: number;
}

// ============================================================================
// INDEXER - Builds and maintains search indices
// ============================================================================

interface SearchTarget {
	searchText: string;
	path: string;
	kind: 'note' | 'heading';
	displayTitle: string;
	isAlias?: boolean;
	heading?: string;
}

class Indexer {
	plugin: LinksmithPlugin;
	noteIndex: Map<string, NoteEntry>;
	headingIndex: Map<string, HeadingEntry[]>;
	aliasIndex: Map<string, string[]>; // alias -> paths
	termIndex: Map<string, Set<string>>; // term -> paths
	buildDebounced: () => void;

	constructor(plugin: LinksmithPlugin) {
		this.plugin = plugin;
		this.noteIndex = new Map();
		this.headingIndex = new Map();
		this.aliasIndex = new Map();
		this.termIndex = new Map();

		// Debounced full build to run in background on frequent changes
		// Use plugin settings debounceDelay; fallback to 200ms if not set yet
		const delay = this.plugin?.settings?.debounceDelay ?? 200;
		this.buildDebounced = debounce(() => {
			this.build().catch((err) =>
				console.error('Linksmith: background build failed', err),
			);
		}, delay);
	}

	async build(): Promise<void> {
		this.noteIndex.clear();
		this.headingIndex.clear();
		this.aliasIndex.clear();
		this.termIndex.clear();

		const files = this.plugin.app.vault.getMarkdownFiles();

		for (const file of files) {
			await this.indexFile(file);
		}
	}

	async indexFile(file: TFile): Promise<void> {
		if (!this.shouldIndexFile(file)) return;

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		if (!cache) return;

		// Index note
		const aliases = parseFrontMatterAliases(cache.frontmatter) ?? [];
		const tags = cache.tags?.map((t) => t.tag) || [];
		const backlinkCount = Object.keys(
			this.plugin.app.metadataCache.resolvedLinks[file.path] || {},
		).length;

		const noteEntry: NoteEntry = {
			path: file.path,
			title: file.basename,
			aliases,
			tags,
			backlinkCount,
			lastModified: file.stat.mtime,
		};

		this.noteIndex.set(file.path, noteEntry);

		// Index terms for note title
		this.indexTerms(file.basename.toLowerCase(), file.path);

		// Index aliases
		for (const alias of noteEntry.aliases) {
			const aliasLower = alias.toLowerCase();
			if (!this.aliasIndex.has(aliasLower)) {
				this.aliasIndex.set(aliasLower, []);
			}
			this.aliasIndex.get(aliasLower)!.push(file.path);
			this.indexTerms(aliasLower, file.path);
		}

		// Index headings
		if (cache.headings && this.plugin.settings.suggestHeadingsEnabled) {
			const headings: HeadingEntry[] = [];

			for (const h of cache.headings) {
				if (this.shouldIndexHeading(h.level, h.heading)) {
					const entry: HeadingEntry = {
						notePath: file.path,
						noteTitle: file.basename,
						heading: h.heading,
						level: h.level,
						position: h.position.start.line,
					};
					headings.push(entry);

					// FIX: Index heading as separate key with # prefix
					const headingKey = file.path + '#' + h.heading;
					this.indexTerms(h.heading.toLowerCase(), headingKey);
				}
			}

			if (headings.length > 0) {
				this.headingIndex.set(file.path, headings);
			}
		}
	}

	indexTerms(text: string, key: string): void {
		const terms = text.split(/\s+/).filter((t) => t.length > 1);
		for (const term of terms) {
			if (!this.termIndex.has(term)) {
				this.termIndex.set(term, new Set());
			}
			this.termIndex.get(term)!.add(key);
		}
	}

	// Schedule a debounced full rebuild (runs in background)
	scheduleBuild(): void {
		this.buildDebounced();
	}

	shouldIndexFile(file: TFile): boolean {
		const settings = this.plugin.settings;

		// Check excluded files
		if (settings.excludedFiles.includes(file.path)) return false;

		// Check excluded folders
		for (const folder of settings.excludedFolders) {
			if (file.path.startsWith(folder)) return false;
		}

		// Check excluded tags
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		if (cache?.tags) {
			const fileTags = cache.tags.map((t) => t.tag);
			for (const excludedTag of settings.excludedTags) {
				if (fileTags.includes(excludedTag)) return false;
			}
		}

		// Check title patterns
		for (const pattern of settings.excludedTitlePatterns) {
			if (new RegExp(pattern).test(file.basename)) return false;
		}

		return true;
	}

	shouldIndexHeading(level: number, heading: string): boolean {
		const settings = this.plugin.settings;

		if (
			level < settings.minHeadingDepth ||
			level > settings.maxHeadingDepth
		) {
			return false;
		}

		for (const pattern of settings.excludedHeadingPatterns) {
			if (new RegExp(pattern).test(heading)) return false;
		}

		return true;
	}

	updateFile(file: TFile): void {
		// Incremental index of this file (fire-and-forget)
		this.indexFile(file).catch((err) =>
			console.error('Linksmith: indexFile error', err),
		);

		// Also schedule a debounced background rebuild to keep indexes consistent
		this.scheduleBuild();
	}

	removeFile(file: TFile): void {
		this.noteIndex.delete(file.path);
		this.headingIndex.delete(file.path);
	}
}

// ============================================================================
// SCORER - Ranks candidates
// ============================================================================

class Scorer {
	plugin: LinksmithPlugin;

	constructor(plugin: LinksmithPlugin) {
		this.plugin = plugin;
	}

	score(query: string, candidate: Candidate, file: TFile): number {
		const settings = this.plugin.settings;
		let score = 0;

		query = query.toLowerCase();
		const targetText = (
			candidate.kind === 'note'
				? candidate.title
				: candidate.heading || ''
		).toLowerCase();

		// Simple fuzzy matching score
		const matchScore = this.fuzzyMatch(query, targetText);

		if (candidate.kind === 'note') {
			score += matchScore * settings.weightTitle;

			// Alias bonus
			if (candidate.matchedAlias) {
				score += matchScore * settings.weightAlias;
			}

			// Backlink prior
			const noteEntry = this.plugin.indexer.noteIndex.get(candidate.path);
			if (noteEntry) {
				score +=
					Math.log(noteEntry.backlinkCount + 1) *
					settings.weightBacklinks;

				// Recency bonus
				const ageInDays =
					(Date.now() - noteEntry.lastModified) /
					(1000 * 60 * 60 * 24);
				score += Math.exp(-ageInDays / 30) * settings.weightRecency;
			}
		} else {
			// Heading
			score += matchScore * settings.weightHeading;

			// Penalty for deep headings
			if (candidate.headingLevel && candidate.headingLevel > 3) {
				score *= 0.8;
			}
		}

		return score;
	}

	fuzzyMatch(query: string, target: string): number {
		if (target.includes(query)) {
			return 1.0; // Exact substring
		}

		// Simple fuzzy matching
		let matchCount = 0;
		let j = 0;

		for (let i = 0; i < query.length && j < target.length; i++) {
			while (j < target.length && target[j] !== query[i]) {
				j++;
			}
			if (j < target.length) {
				matchCount++;
				j++;
			}
		}

		return matchCount / query.length;
	}
}

// ============================================================================
// SUGGEST ENGINE - Live editor suggestions
// ============================================================================

class LinksmithSuggest extends EditorSuggest<Candidate> {
	plugin: LinksmithPlugin;

	constructor(plugin: LinksmithPlugin) {
		super(plugin.app);
		this.plugin = plugin;

		this.scope.register(['Alt'], 'Enter', (evt) => {
			return this.triggerAltEnterSelection(evt);
		});

		// Set custom instructions
		this.setInstructions([
			{ command: '↑↓', purpose: 'Navigate' },
			{ command: '↵', purpose: 'Insert link' },
			{ command: 'alt + click/↵', purpose: 'Insert without alias' },
			{ command: 'esc', purpose: 'Close' },
		]);
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile,
	): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.suggestEnabled) return null;

		const line = editor.getLine(cursor.line);
		const textBeforeCursor = line.slice(0, cursor.ch);

		// Check for [[ trigger
		const linkMatch = textBeforeCursor.match(/\[\[([^\]]*?)$/);
		if (linkMatch) {
			if (
				!meetsMinimumTriggerCharacters(
					linkMatch[1],
					this.plugin.settings.minCharsToTrigger,
				)
			) {
				return null;
			}
			return {
				start: {
					line: cursor.line,
					ch: cursor.ch - linkMatch[1].length,
				},
				end: cursor,
				query: linkMatch[1],
			};
		}
		//const MAX_SPACES = 1
		// Check for plain text trigger - allow up to 1 word
		const MAX_SPACES = this.plugin.settings.maxSpacesToTrigger ?? 1;
		// Unicode letters/digits, 1..(MAX_SPACES+1) words, separated by single spaces.
		// Stops at punctuation, brackets, or line start.
		const tokenRe = new RegExp(
			String.raw`(?:^|[^\p{L}\p{N}\]])(` +
				String.raw`[\p{L}\p{N}§][\p{L}\p{N}_\-.§/]*` + // first token may start with §
				String.raw`(?:\s+[\p{L}\p{N}§][\p{L}\p{N}_\-.§/]*){0,` +
				MAX_SPACES +
				`}` +
				String.raw`)$`,
			'u',
		);

		const tokenMatch = textBeforeCursor.match(tokenRe);
		if (
			tokenMatch &&
			meetsMinimumTriggerCharacters(
				tokenMatch[1],
				this.plugin.settings.minCharsToTrigger,
			)
		) {
			const phrase = tokenMatch[1];
			const spaceCount = (phrase.match(/\s+/g) || []).length;
			if (spaceCount <= this.plugin.settings.maxSpacesToTrigger) {
				return {
					start: { line: cursor.line, ch: cursor.ch - phrase.length },
					end: cursor,
					query: phrase,
				};
			}
		}

		return null;
	}

	getSuggestions(context: EditorSuggestContext): Candidate[] {
		const query = context.query;
		if (
			!meetsMinimumTriggerCharacters(
				query,
				this.plugin.settings.minCharsToTrigger,
			)
		)
			return [];

		const candidates: Candidate[] = [];
		const queryLower = query.toLowerCase();

		// Build query variants: full phrase + last word (if multi-word)
		const variants: string[] = [queryLower];
		const words = queryLower.trim().split(/\s+/).filter(Boolean);
		if (words.length > 1) {
			variants.push(words[words.length - 1]);
		}

		// Helper to find the first matching variant for an item
		const findMatchingVariant = (text: string): string | null => {
			for (const v of variants) {
				if (this.matchesQuery(text, v)) return v;
			}
			return null;
		};

		// Search notes
		for (const [path, note] of this.plugin.indexer.noteIndex.entries()) {
			const matchedVariant = findMatchingVariant(note.title);
			if (matchedVariant) {
				candidates.push({
					key: path,
					kind: 'note',
					score: 0,
					path: path,
					title: note.title,
				});
				continue; // avoid duplicate from aliases if title matched
			}

			// Search aliases
			for (const alias of note.aliases) {
				const aliasMatch = findMatchingVariant(alias);
				if (aliasMatch) {
					candidates.push({
						key: path + '|' + alias,
						kind: 'note',
						score: 0,
						path: path,
						title: note.title,
						matchedAlias: alias,
					});
					break;
				}
			}
		}

		// Search headings
		if (this.plugin.settings.suggestHeadingsEnabled) {
			for (const [
				path,
				headings,
			] of this.plugin.indexer.headingIndex.entries()) {
				for (const h of headings) {
					const match = findMatchingVariant(h.heading);
					if (match) {
						candidates.push({
							key: path + '#' + h.heading,
							kind: 'heading',
							score: 0,
							path: path,
							title: h.noteTitle,
							heading: h.heading,
							headingLevel: h.level,
						});
					}
				}
			}
		}

		// Score and sort. Prefer scoring with the matched variant when possible.
		const file = this.context?.file;
		if (file) {
			candidates.forEach((c) => {
				// choose a query to score with: prefer full phrase if it matches the candidate text
				let scoreQuery = queryLower;
				if (queryLower.includes(' ')) {
					// if candidate title/heading/alias contains full phrase, use it; else use last word
					const candidateText = (
						c.kind === 'note' ? c.title : c.heading || ''
					).toLowerCase();
					if (this.matchesQuery(candidateText, queryLower))
						scoreQuery = queryLower;
					else scoreQuery = words[words.length - 1];
				}
				c.score = this.plugin.scorer.score(scoreQuery, c, file);
			});
		}

		candidates.sort((a, b) => b.score - a.score);

		return candidates.slice(0, this.plugin.settings.maxSuggestions);
	}

	// ADD THIS NEW HELPER METHOD after getSuggestions
	matchesQuery(text: string, query: string): boolean {
		const textLower = text.toLowerCase();

		if (this.plugin.settings.startOfWordOnly) {
			// Match only at start of words
			// Split text into words and check if any word starts with query
			const words = textLower.split(/\s+/);
			return words.some((word) => word.startsWith(query));
		} else {
			// Match anywhere in text (substring match)
			return textLower.includes(query);
		}
	}

	renderSuggestion(candidate: Candidate, el: HTMLElement): void {
		el.addClass('linksmith-suggestion');

		const container = el.createDiv({ cls: 'linksmith-suggestion-content' });

		// Main line
		const mainLine = container.createDiv({
			cls: 'linksmith-suggestion-main',
		});

		// Icon
		const icon = mainLine.createSpan({ cls: 'linksmith-suggestion-icon' });
		icon.setText('🔗 ');

		// Title
		const titleSpan = mainLine.createSpan({
			cls: 'linksmith-suggestion-title',
		});

		// Badge
		const badge = mainLine.createSpan({
			cls: 'linksmith-suggestion-badge',
		});

		// Subtitle
		const subtitle = container.createDiv({
			cls: 'linksmith-suggestion-subtitle',
		});

		const pathEl = container.createDiv({
			cls: 'linksmith-suggestion-path',
		});

		let subtitleText = '';

		// Fill text logic
		if (candidate.kind === 'note') {
			titleSpan.setText(candidate.matchedAlias || candidate.title);
			badge.setText('Note');
			if (candidate.matchedAlias) subtitleText = `→ ${candidate.title}`;
		} else {
			titleSpan.setText(candidate.heading || '');
			badge.setText('Heading');
			subtitleText = `in ${candidate.title}`;
		}

		if (subtitleText) subtitle.setText(subtitleText);
		else subtitle.remove();

		if (this.plugin.settings.showSuggestionPath) {
			pathEl.setText(this.getFolderDisplayPath(candidate.path));
		} else {
			pathEl.remove();
		}
	}

	selectSuggestion(
		candidate: Candidate,
		evt: MouseEvent | KeyboardEvent,
	): void {
		if (!this.context) return;

		const editor = this.context.editor;
		const start = this.context.start;
		const end = this.context.end;

		// Raw text user typed inside trigger range
		const typedRaw = editor.getRange(start, end); // e.g., "die anf" or "§  123"

		// Canonical target
		let target = '';
		if (candidate.kind === 'note') {
			target = candidate.title;
		} else {
			const cleanHeading = this.cleanHeadingForLink(
				candidate.heading || '',
			);
			target = `${candidate.title}#${cleanHeading}`;
		}

		// Determine the longest suffix of typedRaw that is a prefix of target/heading/title
		const bases =
			candidate.kind === 'note'
				? [candidate.title]
				: [
						this.cleanHeadingForLink(candidate.heading || ''),
						candidate.title,
					];

		const best = this.longestSuffixPrefixMatch(typedRaw, bases); // returns normalized suffix
		// Find that suffix at the end of the RAW typed text, tolerant to whitespace runs and case
		const tail = this.findTailRange(typedRaw, best.suffix); // {offset,len} in RAW text; falls back safely

		// Build link text
		const fragmentRaw = typedRaw.slice(tail.offset, tail.offset + tail.len);
		const usePlainLink = this.shouldInsertWithoutAlias(evt);
		const headingAlias =
			candidate.kind === 'heading'
				? this.cleanHeadingForLink(candidate.heading || '')
				: '';
		const linkText =
			this.plugin.settings.useTypedAsAlias && !usePlainLink
				? `[[${target}|${fragmentRaw}]]`
				: usePlainLink && candidate.kind === 'heading'
					? `[[${target}|${headingAlias}]]`
					: `[[${target}]]`;

		// Replace only the tail fragment inside [start,end]
		const replaceStart = { line: start.line, ch: start.ch + tail.offset };
		const replaceEnd = {
			line: start.line,
			ch: start.ch + tail.offset + tail.len,
		};
		editor.replaceRange(linkText, replaceStart, replaceEnd);

		// Cursor after link
		editor.setCursor({
			line: replaceStart.line,
			ch: replaceStart.ch + linkText.length,
		});
	}

	shouldInsertWithoutAlias(evt: MouseEvent | KeyboardEvent): boolean {
		return evt.altKey;
	}

	triggerAltEnterSelection(evt: KeyboardEvent): false | true {
		const suggestApi = this as LinksmithSuggest & {
			selectActiveSuggestion?: (
				event: MouseEvent | KeyboardEvent,
			) => void;
		};

		if (typeof suggestApi.selectActiveSuggestion === 'function') {
			suggestApi.selectActiveSuggestion(evt);
			return false;
		}

		const activeItem = document.querySelector(
			'.suggestion-item.is-selected',
		);
		if (activeItem) {
			activeItem.dispatchEvent(
				new MouseEvent('click', {
					bubbles: true,
					cancelable: true,
					altKey: true,
				}),
			);
			return false;
		}

		return true;
	}

	getFolderDisplayPath(path: string): string {
		const lastSlash = path.lastIndexOf('/');
		if (lastSlash === -1) return 'Vault root';

		const folder = path.slice(0, lastSlash);
		return folder.length > 0 ? folder : 'Vault root';
	}

	// Longest normalized suffix of `typedRaw` that prefixes any base (case-insensitive, space-collapsed)
	longestSuffixPrefixMatch(
		typedRaw: string,
		bases: string[],
	): { suffix: string; base: string } {
		const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
		const t = norm(typedRaw);
		const tokens = t.split(' ').filter(Boolean);
		const suffixes: string[] = [];
		for (let i = 0; i < tokens.length; i++)
			suffixes.push(tokens.slice(i).join(' '));

		for (const sfx of suffixes) {
			for (const b of bases)
				if (norm(b).startsWith(sfx)) return { suffix: sfx, base: b };
		}
		const fallback = tokens.length ? tokens[tokens.length - 1] : t;
		return { suffix: fallback, base: bases[0] ?? '' };
	}

	// Map normalized suffix to RAW tail range at end of typedRaw.
	// Tolerates multi-spaces and case differences, handles symbols like § and .
	findTailRange(
		typedRaw: string,
		suffixNorm: string,
	): { offset: number; len: number } {
		const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = esc(suffixNorm).replace(/\s+/g, '\\s+'); // allow any space runs
		const re = new RegExp(`${pattern}$`, 'i'); // must be at end
		const m = typedRaw.match(re);
		if (m) {
			const len = m[0].length;
			return { offset: typedRaw.length - len, len };
		}
		// Fallback: last token at end
		const lastToken = typedRaw.match(/(\S+)\s*$/);
		if (lastToken) {
			const len = lastToken[1].length;
			return {
				offset:
					typedRaw.length - lastToken[0].replace(/\s+$/, '').length,
				len,
			};
		}
		return { offset: 0, len: typedRaw.length };
	}

	cleanHeadingForLink(heading: string): string {
		return heading.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1').trim();
	}
}

// ============================================================================
// RETRO ENGINE - Batch link suggestions (COMPLETE REWRITE)
// ============================================================================

class RetroEngine {
	plugin: LinksmithPlugin;

	constructor(plugin: LinksmithPlugin) {
		this.plugin = plugin;
	}

	async scanFile(file: TFile): Promise<RetroSuggestion[]> {
		const content = await this.plugin.app.vault.read(file);
		const lines = content.split('\n');
		const suggestions: RetroSuggestion[] = [];

		// Step 1: Build list of all searchable terms
		const searchTargets = this.buildSearchTargets(file);

		// Step 2: Scan each line for matches
		for (let lineNum = 0; lineNum < lines.length; lineNum++) {
			const line = lines[lineNum];

			// Skip lines we shouldn't modify
			if (this.shouldSkipLine(line, lineNum, lines)) {
				continue;
			}

			// Step 3: Find all matches in this line
			const lineMatches = this.findMatchesInLine(
				line,
				lineNum,
				searchTargets,
			);
			suggestions.push(...lineMatches);
		}

		// Step 4: Sort by confidence (highest first)
		suggestions.sort((a, b) => b.confidence - a.confidence);

		return suggestions;
	}

	buildSearchTargets(currentFile: TFile): SearchTarget[] {
		const targets: SearchTarget[] = [];

		// Add all note titles
		for (const [path, note] of this.plugin.indexer.noteIndex.entries()) {
			// Don't link to self
			if (path === currentFile.path) continue;

			targets.push({
				searchText: note.title,
				path: path,
				kind: 'note',
				displayTitle: note.title,
			});

			// Add all aliases for this note
			for (const alias of note.aliases) {
				if (alias && alias.length >= 3) {
					targets.push({
						searchText: alias,
						path: path,
						kind: 'note',
						displayTitle: note.title,
						isAlias: true,
					});
				}
			}
		}

		// Add all headings
		for (const [
			path,
			headings,
		] of this.plugin.indexer.headingIndex.entries()) {
			for (const h of headings) {
				if (h.heading && h.heading.length >= 3) {
					targets.push({
						searchText: h.heading,
						path: path,
						kind: 'heading',
						displayTitle: h.noteTitle,
						heading: h.heading,
					});
				}
			}
		}

		// Sort by length (longest first) to match longer phrases before shorter ones
		targets.sort((a, b) => b.searchText.length - a.searchText.length);

		return targets;
	}

	findMatchesInLine(
		line: string,
		lineNum: number,
		targets: SearchTarget[],
	): RetroSuggestion[] {
		const matches: RetroSuggestion[] = [];
		const usedRanges: Array<{ start: number; end: number }> = [];

		// Skip empty lines or code blocks
		if (!line.trim() || line.trim().startsWith('```')) {
			return matches;
		}

		// 1. Check for existing links
		const existingLinks = new Set<string>();
		const linkPattern = /\[\[([^\]]+)\]\]/g;
		let linkMatch;
		while ((linkMatch = linkPattern.exec(line)) !== null) {
			existingLinks.add(linkMatch[1].split('|')[0]);
			usedRanges.push({
				start: linkMatch.index,
				end: linkMatch.index + linkMatch[0].length,
			});
		}

		// 2. Search for each target
		for (const target of targets) {
			// Skip if already linked
			if (
				existingLinks.has(target.path) ||
				existingLinks.has(`${target.path}#${target.heading}`)
			) {
				continue;
			}

			const searchVariants = this.getSearchVariants(target.searchText);

			for (const searchText of searchVariants) {
				const searchLower = searchText.toLowerCase();
				const lineLower = line.toLowerCase();

				// Find all potential matches in the line
				let startIndex = 0;
				while (true) {
					let foundIndex = -1;

					if (this.plugin.settings.partialWordMatches) {
						// Find any word that contains our search text
						const words = lineLower.slice(startIndex).split(/\b/);
						const wordIndex = words.findIndex((word) =>
							word.includes(searchLower),
						);
						if (wordIndex !== -1) {
							// Calculate the actual index in the line
							foundIndex =
								startIndex +
								words.slice(0, wordIndex).join('').length;
						}
					} else {
						// Only match whole words
						foundIndex = lineLower.indexOf(searchLower, startIndex);
					}

					if (foundIndex === -1) break;

					const endIndex = foundIndex + searchText.length;

					// Skip if overlaps with existing
					if (
						!this.overlapsWithUsed(foundIndex, endIndex, usedRanges)
					) {
						if (this.isValidMatch(line, foundIndex, endIndex)) {
							const matchedText = line.slice(
								foundIndex,
								endIndex,
							);
							const confidence = this.calculateEnhancedConfidence(
								target,
								matchedText,
								line,
								foundIndex,
								existingLinks,
							);

							if (
								confidence >=
								this.plugin.settings.retroMinConfidence
							) {
								const link = this.createEnhancedLink(
									target,
									matchedText,
								);
								matches.push({
									span: matchedText,
									link: link,
									kind: target.kind,
									confidence: confidence,
									context: this.getContext(
										line,
										foundIndex,
										matchedText.length,
									),
									lineNumber: lineNum,
								});

								usedRanges.push({
									start: foundIndex,
									end: endIndex,
								});

								if (this.plugin.settings.retroReplaceFirst) {
									break;
								}
							}
						}
					}
					startIndex = foundIndex + 1;
				}
			}
		}

		return matches;
	}

	isWordBoundary(text: string, start: number, end: number): boolean {
		// Check character before match
		const charBefore = start > 0 ? text[start - 1] : ' ';
		const charAfter = end < text.length ? text[end] : ' ';

		// Word boundary means: not alphanumeric before/after
		const beforeOk = !/[a-zA-Z0-9]/.test(charBefore);
		const afterOk = !/[a-zA-Z0-9]/.test(charAfter);

		return beforeOk && afterOk;
	}

	overlapsWithUsed(
		start: number,
		end: number,
		usedRanges: Array<{ start: number; end: number }>,
	): boolean {
		for (const range of usedRanges) {
			// Check if ranges overlap
			if (start < range.end && end > range.start) {
				return true;
			}
		}
		return false;
	}

	isInsideLink(line: string, position: number): boolean {
		// Count [[ and ]] before this position
		const before = line.slice(0, position);

		let openCount = 0;
		let closeCount = 0;

		for (let i = 0; i < before.length - 1; i++) {
			if (before[i] === '[' && before[i + 1] === '[') {
				openCount++;
			}
			if (before[i] === ']' && before[i + 1] === ']') {
				closeCount++;
			}
		}

		// If more opens than closes, we're inside a link
		return openCount > closeCount;
	}

	shouldSkipLine(line: string, lineNum: number, lines: string[]): boolean {
		const trimmed = line.trim();

		// Skip empty lines
		if (trimmed.length === 0) return true;

		// Skip frontmatter
		if (trimmed === '---' || trimmed === '...') return true;

		// Skip code blocks
		if (trimmed.startsWith('```')) return true;

		// Skip headers (we don't want to link inside headers)
		if (trimmed.match(/^#{1,6}\s/)) return true;

		// Skip lines that are mostly links already
		const linkCount = (line.match(/\[\[/g) || []).length;
		const wordCount = line.split(/\s+/).length;
		if (linkCount > wordCount / 2) return true;

		return false;
	}

	createLink(target: SearchTarget): string {
		const notePath = target.path.replace(/\.md$/, '');

		if (target.kind === 'note') {
			return `[[${notePath}]]`;
		} else {
			// Heading link
			const cleanHeading = this.cleanHeadingText(target.heading || '');

			// If heading contains links, use pipe syntax
			return `[[${notePath}#${cleanHeading}|${cleanHeading}]]`;
		}
	}

	cleanHeadingText(heading: string): string {
		// Remove any [[...]] or [[...|...]] from heading text
		return heading.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1').trim();
	}

	getContext(line: string, position: number, length: number): string {
		const radius = 40;
		const start = Math.max(0, position - radius);
		const end = Math.min(line.length, position + length + radius);

		let context = line.slice(start, end);

		if (start > 0) context = '...' + context;
		if (end < line.length) context = context + '...';

		return context;
	}

	calculateConfidence(
		target: SearchTarget,
		matchedText: string,
		line: string,
		position: number,
	): number {
		let confidence = 0.6; // Base confidence

		// Longer matches are more confident
		if (target.searchText.length > 15) confidence += 0.15;
		else if (target.searchText.length > 10) confidence += 0.1;
		else if (target.searchText.length > 5) confidence += 0.05;

		// Multi-word matches are more confident
		const wordCount = target.searchText.split(/\s+/).length;
		if (wordCount >= 3) confidence += 0.15;
		else if (wordCount === 2) confidence += 0.1;

		// Exact case match is more confident
		if (matchedText === target.searchText) {
			confidence += 0.1;
		}

		// Headings are slightly less confident than notes
		if (target.kind === 'heading') {
			confidence -= 0.05;
		}

		return Math.min(confidence, 1.0);
	}

	// Add these helper methods

	private getSearchVariants(text: string): string[] {
		const variants = new Set<string>();

		// Original text
		variants.add(text);

		// Common variations
		variants.add(text.toLowerCase());
		variants.add(text.charAt(0).toUpperCase() + text.slice(1));
		variants.add(text.toUpperCase());

		// Remove special characters
		const cleanText = text.replace(/[.,/#!$%^&*;:{}=_`~()-]/g, '');
		if (cleanText !== text) variants.add(cleanText);

		// Handle plural/singular
		if (text.endsWith('s')) variants.add(text.slice(0, -1));
		else variants.add(text + 's');

		// Handle common word separators
		const withoutSpaces = text.replace(/\s+/g, '');
		if (withoutSpaces !== text) variants.add(withoutSpaces);

		const withDashes = text.replace(/\s+/g, '-');
		if (withDashes !== text) variants.add(withDashes);

		return Array.from(variants);
	}

	private isValidMatch(line: string, start: number, end: number): boolean {
		// More comprehensive word boundary checking
		const before = start > 0 ? line[start - 1] : ' ';
		const after = end < line.length ? line[end] : ' ';

		// Define valid word boundaries
		const validBoundaries = /[\s.,;!?()[\]{}"'\-_]/;

		// Check if boundaries are valid
		const validBefore = validBoundaries.test(before);
		const validAfter = validBoundaries.test(after);

		// Check if we're inside code blocks or other special syntax
		const isInCode = /`[^`]*$/.test(line.slice(0, start));
		const isInMath = /\$[^$]*$/.test(line.slice(0, start));
		const isInHTML = /<[^>]*$/.test(line.slice(0, start));

		return validBefore && validAfter && !isInCode && !isInMath && !isInHTML;
	}

	private calculateEnhancedConfidence(
		target: SearchTarget,
		matchedText: string,
		line: string,
		position: number,
		existingLinks: Set<string>,
	): number {
		let confidence = 0.6; // Base confidence

		// Length-based confidence
		confidence += Math.min(0.2, matchedText.length / 40);

		// Word count confidence
		const wordCount = matchedText.split(/\s+/).length;
		confidence += Math.min(0.15, wordCount * 0.05);

		// Case matching
		if (matchedText === target.searchText) confidence += 0.1;

		// Context relevance
		const surroundingWords = line
			.slice(
				Math.max(0, position - 30),
				Math.min(line.length, position + matchedText.length + 30),
			)
			.toLowerCase();

		if (target.kind === 'heading') {
			confidence -= 0.05; // Slight penalty for headings

			// Boost if surrounding content is related
			if (surroundingWords.includes(target.displayTitle.toLowerCase())) {
				confidence += 0.1;
			}
		}

		// Position bonus (matches at start of sentence are more likely to be intentional)
		if (
			/[.!?]\s+[A-Z]/.test(
				line.slice(Math.max(0, position - 2), position),
			)
		) {
			confidence += 0.05;
		}

		// Semantic context penalty
		const commonWords = new Set([
			'the',
			'a',
			'an',
			'and',
			'or',
			'but',
			'in',
			'on',
			'at',
			'to',
		]);
		if (commonWords.has(matchedText.toLowerCase())) {
			confidence -= 0.3;
		}

		return Math.min(Math.max(confidence, 0), 1); // Clamp between 0 and 1
	}

	private createEnhancedLink(
		target: SearchTarget,
		matchedText: string,
	): string {
		if (target.kind === 'note') {
			// Extract just the filename without path and extension
			const fileName =
				target.path.split('/').pop()?.replace(/\.md$/, '') ||
				target.path;

			// If matched text differs significantly from title, use alias
			if (
				matchedText.toLowerCase() !== target.displayTitle.toLowerCase()
			) {
				return `[[${fileName}|${matchedText}]]`;
			}

			return `[[${fileName}]]`;
		} else {
			// For headings, extract filename and clean heading
			const fileName =
				target.path.split('/').pop()?.replace(/\.md$/, '') ||
				target.path;
			const cleanHeading = this.cleanHeadingText(target.heading || '');

			// If matched text is different from heading, use alias
			if (matchedText !== cleanHeading) {
				return `[[${fileName}#${cleanHeading}|${matchedText}]]`;
			}

			return `[[${fileName}#${cleanHeading}]]`;
		}
	}
}

// ============================================================================
// RETRO REVIEW MODAL
// ============================================================================

class RetroReviewModal extends Modal {
	plugin: LinksmithPlugin;
	file: TFile;
	suggestions: RetroSuggestion[];
	selectedSuggestions: Set<number>;
	currentPage: number;
	itemsPerPage: number;

	constructor(
		plugin: LinksmithPlugin,
		file: TFile,
		suggestions: RetroSuggestion[],
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.suggestions = suggestions;
		this.selectedSuggestions = new Set();
		this.currentPage = 0;
		this.itemsPerPage = 50; // Show 50 items per page
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', {
			text: `Review Link Suggestions for ${this.file.basename}`,
		});
		contentEl.createEl('p', {
			text: `Found ${this.suggestions.length} potential links`,
		});

		// Controls
		const controls = contentEl.createDiv({
			cls: 'linksmith-retro-controls',
		});

		new ButtonComponent(controls)
			.setButtonText('Select all on page')
			.onClick(() => {
				const start = this.currentPage * this.itemsPerPage;
				const end = Math.min(
					start + this.itemsPerPage,
					this.suggestions.length,
				);
				for (let i = start; i < end; i++) {
					this.selectedSuggestions.add(i);
				}
				this.renderSuggestions();
			});

		new ButtonComponent(controls)
			.setButtonText('Deselect all')
			.onClick(() => {
				this.selectedSuggestions.clear();
				this.renderSuggestions();
			});

		new ButtonComponent(controls)
			.setButtonText(`Apply selected (${this.selectedSuggestions.size})`)
			.setCta()
			.onClick(() => this.applySelected());

		// Suggestions list
		this.renderSuggestions();
	}

	renderSuggestions(): void {
		const { contentEl } = this;
		const existing = contentEl.querySelector(
			'.linksmith-suggestions-container',
		);
		if (existing) existing.remove();

		const container = contentEl.createDiv({
			cls: 'linksmith-suggestions-container',
		});

		// Pagination info
		const totalPages = Math.ceil(
			this.suggestions.length / this.itemsPerPage,
		);
		if (totalPages > 1) {
			const paginationTop = container.createDiv({
				cls: 'linksmith-pagination',
			});
			this.renderPagination(paginationTop, totalPages);
		}

		// Suggestions list
		const list = container.createDiv({ cls: 'linksmith-suggestions-list' });

		// Calculate which items to show
		const start = this.currentPage * this.itemsPerPage;
		const end = Math.min(
			start + this.itemsPerPage,
			this.suggestions.length,
		);
		const pageItems = this.suggestions.slice(start, end);

		// Render items for current page
		pageItems.forEach((suggestion, pageIndex) => {
			const actualIndex = start + pageIndex;
			const item = list.createDiv({ cls: 'linksmith-suggestion-item' });

			const checkbox = item.createEl('input', { type: 'checkbox' });
			checkbox.checked = this.selectedSuggestions.has(actualIndex);
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selectedSuggestions.add(actualIndex);
				} else {
					this.selectedSuggestions.delete(actualIndex);
				}
				// Update button text
				const button = contentEl.querySelector(
					'.mod-cta',
				) as HTMLButtonElement;
				if (button) {
					button.textContent = `Apply selected (${this.selectedSuggestions.size})`;
				}
			});

			const content = item.createDiv({
				cls: 'linksmith-suggestion-content',
			});

			const mainText = content.createDiv();
			mainText.createEl('strong', { text: suggestion.span });
			mainText.createSpan({ text: ' → ' });
			mainText.createEl('code', { text: suggestion.link });

			const meta = content.createDiv({
				cls: 'linksmith-suggestion-meta',
			});
			meta.createSpan({
				text: `Line ${suggestion.lineNumber + 1}`,
			});
			meta.createSpan({
				text: ` | Confidence: ${(suggestion.confidence * 100).toFixed(0)}%`,
			});
			meta.createSpan({ text: ` | Type: ${suggestion.kind}` });

			const context = content.createDiv({
				cls: 'linksmith-suggestion-context',
			});
			context.setText(`"${suggestion.context}"`);
		});

		// Pagination bottom
		if (totalPages > 1) {
			const paginationBottom = container.createDiv({
				cls: 'linksmith-pagination',
			});
			this.renderPagination(paginationBottom, totalPages);
		}
	}

	renderPagination(container: HTMLElement, totalPages: number): void {
		container.empty();

		const info = container.createSpan({ cls: 'linksmith-pagination-info' });
		info.setText(`Page ${this.currentPage + 1} of ${totalPages}`);

		const buttons = container.createDiv({
			cls: 'linksmith-pagination-buttons',
		});

		// Previous button
		new ButtonComponent(buttons)
			.setButtonText('Previous')
			.setDisabled(this.currentPage === 0)
			.onClick(() => {
				if (this.currentPage > 0) {
					this.currentPage--;
					this.renderSuggestions();
				}
			});

		// Next button
		new ButtonComponent(buttons)
			.setButtonText('Next →')
			.setDisabled(this.currentPage >= totalPages - 1)
			.onClick(() => {
				if (this.currentPage < totalPages - 1) {
					this.currentPage++;
					this.renderSuggestions();
				}
			});
	}

	async applySelected(): Promise<void> {
		if (this.selectedSuggestions.size === 0) {
			new Notice('No suggestions selected');
			return;
		}

		const content = await this.plugin.app.vault.read(this.file);
		const lines = content.split('\n');

		// Sort by line number descending to avoid position shifts
		const selected = Array.from(this.selectedSuggestions)
			.map((i) => this.suggestions[i])
			.sort((a, b) => b.lineNumber - a.lineNumber);

		// Apply changes
		for (const suggestion of selected) {
			const line = lines[suggestion.lineNumber];
			const regex = new RegExp(
				`\\b${this.escapeRegex(suggestion.span)}\\b`,
				'i',
			);
			const replacement = line.replace(regex, suggestion.link);
			lines[suggestion.lineNumber] = replacement;
		}

		await this.plugin.app.vault.modify(this.file, lines.join('\n'));

		new Notice(`Applied ${this.selectedSuggestions.size} links`);
		this.close();
	}

	escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// MAIN PLUGIN
// ============================================================================

export default class LinksmithPlugin extends Plugin {
	settings!: LinksmithSettings;
	indexer!: Indexer;
	scorer!: Scorer;
	suggestEngine!: LinksmithSuggest;
	retroEngine!: RetroEngine;
	statusBarItem!: HTMLElement;

	async onload() {
		await this.loadSettings();

		// Initialize components
		this.indexer = new Indexer(this);
		this.scorer = new Scorer(this);
		this.suggestEngine = new LinksmithSuggest(this);
		this.retroEngine = new RetroEngine(this);

		// Register suggest
		this.registerEditorSuggest(this.suggestEngine);

		// Add status bar
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		// Build index
		this.app.workspace.onLayoutReady(async () => {
			await this.indexer.build();
		});

		// Register vault events
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.indexer.updateFile(file);
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.indexer.updateFile(file);
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) {
					this.indexer.removeFile(file);
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on('rename', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.indexer.updateFile(file);
				}
			}),
		);

		// Add commands
		this.addCommand({
			id: 'toggle-suggestions',
			name: 'Toggle live suggestions',
			callback: async () => {
				this.settings.suggestEnabled = !this.settings.suggestEnabled;
				await this.saveSettings();
				this.updateStatusBar();
				new Notice(
					`Live suggestions ${this.settings.suggestEnabled ? 'enabled' : 'disabled'}`,
				);
			},
		});

		this.addCommand({
			id: 'toggle-heading-suggestions',
			name: 'Toggle heading suggestions',
			callback: async () => {
				this.settings.suggestHeadingsEnabled =
					!this.settings.suggestHeadingsEnabled;
				await this.saveSettings();
				this.updateStatusBar();
				new Notice(
					`Heading suggestions ${this.settings.suggestHeadingsEnabled ? 'enabled' : 'disabled'}`,
				);
			},
		});

		this.addCommand({
			id: 'retro-link-current-file',
			name: 'Retro-link current file',
			editorCallback: async (editor, view) => {
				if (!this.settings.retroEnabled) {
					new Notice('Retro-linking is disabled in settings');
					return;
				}

				const file = view.file;
				if (!file) return;

				new Notice('Scanning for link opportunities...');
				const suggestions = await this.retroEngine.scanFile(file);

				if (suggestions.length === 0) {
					new Notice('No link suggestions found');
					return;
				}

				new RetroReviewModal(this, file, suggestions).open();
			},
		});

		this.addCommand({
			id: 'retro-link-current-folder',
			name: 'Retro-link current folder',
			callback: async () => {
				if (!this.settings.retroEnabled) {
					new Notice('Retro-linking is disabled in settings');
					return;
				}

				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice('No active file');
					return;
				}

				const folder = activeFile.parent;
				if (!folder) return;

				const files = folder.children.filter(
					(f): f is TFile =>
						f instanceof TFile && f.extension === 'md',
				);

				new Notice(`Scanning ${files.length} files...`);

				let totalSuggestions = 0;
				for (const file of files) {
					const suggestions = await this.retroEngine.scanFile(file);
					totalSuggestions += suggestions.length;
				}

				new Notice(
					`Found ${totalSuggestions} total suggestions across ${files.length} files`,
				);
			},
		});

		this.addCommand({
			id: 'rebuild-index',
			name: 'Rebuild index',
			callback: async () => {
				new Notice('Rebuilding index...');
				await this.indexer.build();
				new Notice('Index rebuilt successfully');
			},
		});

		// Add ribbon icon
		this.addRibbonIcon('link', 'Linksmith Pro', () => {
			new Notice('Linksmith Pro is active');
		});

		// Add settings tab
		this.addSettingTab(new LinksmithSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = normalizeSettings(
			await this.loadData(),
			DEFAULT_SETTINGS,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	updateStatusBar() {
		const parts = [];
		if (this.settings.suggestEnabled) parts.push('✓ Suggest');
		if (this.settings.suggestHeadingsEnabled) parts.push('✓ Headings');
		if (this.settings.retroEnabled) parts.push('✓ Retro');

		this.statusBarItem.setText(
			`Linksmith: ${parts.join(' | ') || 'Disabled'}`,
		);
	}
}
