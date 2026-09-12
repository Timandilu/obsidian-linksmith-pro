import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
	{ ignores: ['node_modules/**', 'main.js', 'tests/**', '*.mjs'] },
	...obsidianmd.configs.recommended,
	{
		files: ['**/*.ts'],
		languageOptions: {
			parserOptions: { projectService: true },
		},
		rules: {
			'obsidianmd/ui/sentence-case': [
				'warn',
				{ brands: ['Linksmith Pro'] },
			],
		},
	},
]);
