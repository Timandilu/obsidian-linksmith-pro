# Linksmith Pro

Suggest links to notes and headings as you type, then find missing links with a review-first batch tool.

Linksmith Pro is a powerful Obsidian plugin that enhances your knowledge management workflow by intelligently suggesting links to notes and headings as you type, and by scanning existing notes to suggest missing connections.

## 🎯 Features

### Live Link Suggestions

- **Real-time autocomplete** for note titles, aliases, and headings while typing
- **Fuzzy matching** finds relevant links even with partial matches
- **Smart scoring** prioritizes frequently linked, recent, and contextually relevant suggestions
- **Heading support** suggests links to specific sections within notes
- **Customizable triggers** for `[[` syntax or plain text typing

### Batch Retro-Linking

- **Scan existing notes** to find opportunities for new links
- **Review interface** with confidence scores and context previews
- **Selective application** - choose which suggestions to apply
- **Safe modifications** with clear previews before changes

### Fine-Grained Control

- **Exclusion rules** for folders, files, tags, and regex patterns
- **Heading depth filters** to control which heading levels are indexed
- **Confidence thresholds** to reduce false positives
- **Per-file overrides** via frontmatter flags

### Smart Scoring

- Multi-signal ranking based on:
    - Title/alias/heading match quality
    - Backlink frequency (popular notes rank higher)
    - Recency (recently modified notes get a boost)
    - Heading depth (shallower headings preferred)
    - Context awareness

## 📦 Installation

### From Obsidian Community Plugins

1. Open **Settings → Community plugins → Browse**.
2. Search for **Linksmith Pro**.
3. Select **Install**, then **Enable**.

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your vault's `.obsidian/plugins/linksmith-pro/` directory
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

## 🚀 Quick Start

### Live Suggestions

1. Start typing in any note
2. Type `[[` or just start typing a note name
3. See suggestions appear automatically
4. Use arrow keys to navigate, Enter to insert
5. Heading suggestions show as "Note › Heading"

### Retro-Linking

1. Open the note you want to enhance
2. Open Command Palette (Ctrl/Cmd + P)
3. Run **Linksmith Pro: Retro-link current file**
4. Review suggestions in the modal
5. Select links to apply and click "Apply Selected"

## ⚙️ Configuration

Settings appear in Obsidian's global settings search on version 1.13.0 and later. The same controls remain available on Obsidian 1.5.0 and later.

### Suggest Settings

- **Enable suggestions**: Toggle live link suggestions
- **Enable heading suggestions**: Include headings in autocomplete
- **Minimum characters to trigger**: How many characters before showing suggestions (1-5)
- **Maximum suggestions**: Limit the number of suggestions shown (5-20)

### Heading Options

- **Minimum heading depth**: Lowest heading level to index (H1-H6)
- **Maximum heading depth**: Highest heading level to index (H1-H6)
- **Prefer headings over notes**: Boost heading scores in suggestions

### Scoring Weights

Fine-tune the importance of different factors:

- **Title weight**: How much to value title matches
- **Heading weight**: How much to value heading matches
- **Backlinks weight**: Importance of link popularity
- **Recency weight**: How much to favor recently modified notes

### Exclusions

Configure what to ignore:

- **Excluded folders**: Comma-separated folder paths
- **Excluded files**: Comma-separated file paths
- **Excluded tags**: Tags to ignore (include #)
- **Excluded title patterns**: Regex patterns for note titles
- **Excluded heading patterns**: Regex patterns for headings

### Retro-Link Settings

- **Enable retro-linking**: Toggle batch link suggestions
- **Minimum confidence**: Threshold for showing suggestions (0-1)

## 🎮 Commands

Access these via Command Palette (Ctrl/Cmd + P):

- **Toggle live suggestions**: Turn autocomplete on/off
- **Toggle heading suggestions**: Enable/disable heading links
- **Retro-link current file**: Scan current note for link opportunities
- **Retro-link current folder**: Scan all notes in current folder
- **Rebuild index**: Force rebuild of the search index

## 📝 Usage Tips

### Frontmatter Overrides

Add these to a note's frontmatter for per-file control:

```yaml
---
linksmith: ignore # Don't index this file at all
linksmith: ignore-headings # Index file but not headings
linksmith_exclude_terms: # Never link these terms in this file
    - 'term1'
    - 'term2'
---
```

### Best Practices

1. **Start with defaults**: The plugin works well out of the box
2. **Adjust weights gradually**: Small changes have big impacts
3. **Use exclusions sparingly**: Over-excluding reduces suggestions
4. **Review retro-links carefully**: Not all suggestions may be relevant
5. **Rebuild index after major changes**: Settings → Rebuild index

### Performance Tips

- Exclude template folders and archives to speed up indexing
- Lower maximum suggestions if you find the list overwhelming
- Use higher confidence thresholds for retro-linking in large vaults

## 🏗️ Technical Details

### Architecture

- **Indexer**: Builds and maintains search indices for notes and headings
- **Scorer**: Multi-signal ranking algorithm for suggestions
- **SuggestEngine**: Powers live editor autocomplete
- **RetroEngine**: Scans documents for batch link opportunities
- **Exclusions**: Centralized filtering system

### Index Sources

- MetadataCache for titles, aliases, headings, frontmatter
- Real-time updates via vault events
- Efficient in-memory caching

## Privacy

Linksmith Pro works entirely inside Obsidian. It makes no network requests, collects no telemetry, requires no account, and does not access files outside your vault.

To suggest links across notes, it enumerates Markdown file paths and indexes their cached titles, aliases, and headings. Exclusion rules filter the notes it indexes. Retro-linking reads the notes you choose to scan and writes changes when you apply reviewed suggestions.

### Data Structures

- Inverted indices for fast term lookup
- Separate indices for notes and headings
- Alias mapping for alternate names
- Backlink statistics from Obsidian's graph

## 🐛 Troubleshooting

### Suggestions not appearing

- Check that "Enable suggestions" is on in settings
- Verify you've typed enough characters (check minimum trigger setting)
- Try rebuilding the index: Command Palette → "Rebuild index"
- Check if the current file/folder is in your exclusion list

### Headings not showing

- Enable "Enable heading suggestions" in settings
- Check min/max heading depth settings
- Verify heading patterns aren't too restrictive
- Some headings may be filtered by exclusion rules

### Retro-linking not working

- Ensure "Enable retro-linking" is on
- Lower the confidence threshold if no suggestions appear
- Check that target notes aren't excluded
- Code blocks and existing links are intentionally skipped

### Performance issues

- Reduce maximum suggestions count
- Exclude large folders (archives, templates)
- Disable heading suggestions temporarily
- Rebuild index if it seems stale

### Index seems outdated

- Run "Rebuild index" command
- Check console for indexing errors (Ctrl/Cmd + Shift + I)
- Ensure files aren't being excluded unexpectedly

## 🛣️ Roadmap

### v1.0 (Current)

- ✅ Live note and heading suggestions
- ✅ Batch retro-linking with review UI
- ✅ Comprehensive exclusion system
- ✅ Multi-signal scoring
- ✅ Real-time index updates

### v1.1 (Planned)

- 🔄 Anchor resolver for heading renames
- 🔄 Disambiguation cards for ambiguous terms
- 🔄 Link density guard
- 🔄 Glossary mode for definition files

### v1.2 (Future)

- 📋 Embedding-based semantic search (optional)
- 📋 Language packs for non-English vaults
- 📋 Plugin API hooks
- 📋 Confidence heatmap visualization

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/Timandilu/obsidian-linksmith-pro.git
cd obsidian-linksmith-pro

# Install dependencies
npm install

# Build for development (watch mode)
npm run dev

# Check formatting, Obsidian lint rules, tests, and the production build
npm run check
```

### Releases

Keep `package.json`, `manifest.json`, and `versions.json` in sync, then push a plain version tag such as `1.0.1`. GitHub Actions checks the source, builds the plugin, and creates the release with attestations for `main.js`, `manifest.json`, and `styles.css`.

After downloading an asset, verify its build provenance with:

```bash
gh attestation verify main.js --repo Timandilu/obsidian-linksmith-pro
```

### Project Structure

```
linksmith-pro/
├── main.ts           # Plugin lifecycle and link engines
├── src/              # Trigger helpers, settings validation, and settings tab
├── tests/            # Regression tests
├── manifest.json     # Plugin metadata
├── styles.css        # UI styling
├── package.json      # Dependencies
├── tsconfig.json     # TypeScript config
├── esbuild.config.mjs # Build configuration
└── README.md         # Documentation
```

## 📄 License

MIT License - feel free to use, modify, and distribute.

## 🙏 Acknowledgments

Inspired by:

- **Various Complements** - for autocomplete patterns
- **Note Link System** - for retro-linking concepts
- **Obsidian community** - for feedback and ideas

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Timandilu/obsidian-linksmith-pro/issues)

## 🔗 Links

- [GitHub Repository](https://github.com/Timandilu/obsidian-linksmith-pro)
- [Obsidian Plugin Directory](https://obsidian.md/plugins?id=linksmith-pro)

---

**Made with ❤️ for the Obsidian community**

_Enhance your second brain with intelligent linking_
