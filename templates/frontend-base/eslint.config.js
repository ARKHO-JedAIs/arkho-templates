import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import pluginJsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['dist', 'node_modules', 'build', 'coverage'],
  },
  { files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  pluginJsxA11y.flatConfigs.recommended,
  // Last among the rule sets: it turns off every stylistic rule that would
  // otherwise fight Prettier. Anything re-enabled after this point is a
  // deliberate override, and formatting rules must not be.
  prettier,
  {
    plugins: {
      prettier: prettierPlugin,
      'react-hooks': pluginReactHooks,
    },
    rules: {
      // The whole point of installing this plugin: without it, exhaustive-deps
      // never runs and a stale-closure bug ships silently.
      ...pluginReactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      // No inline options: Prettier reads .prettierrc, which stays the single
      // source of formatting truth. Duplicating them here is how the two drift.
      'prettier/prettier': 'error',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    // shadcn/ui components are vendored as-is from the upstream generator.
    // Formatting is still enforced; their internal API shapes are not ours to
    // relitigate on every `shadcn add`.
    files: ['src/components/ui/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'jsx-a11y/heading-has-content': 'off',
      'jsx-a11y/anchor-has-content': 'off',
    },
  },
];
