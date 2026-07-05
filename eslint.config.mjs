import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
	{
		ignores: [
			"main.js",
			"node_modules/**",
		],
	},
	js.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: "latest",
			sourceType: "module",
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
		},
		rules: {
			...tsPlugin.configs["recommended-type-checked"].rules,
			"no-console": "warn",
			"no-undef": "off",
		},
	},
	{
		// node:test's test() calls and the fake vault/editor mocks legitimately
		// trip these type-checked rules; they add no value in the test harness.
		files: ["tests/**/*.ts"],
		rules: {
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/require-await": "off",
		},
	},
];
