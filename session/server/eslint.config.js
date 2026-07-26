import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'data'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // D3 — the server never runtime-imports @dnd/core (core depends on pixi.js).
      // `import type` is fine: it is erased before Node ever sees it.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@dnd/core', '@dnd/core/*'],
              allowTypeImports: true,
              message:
                'D3: the game server must not runtime-import @dnd/core (it pulls in pixi.js). Use `import type` only.',
            },
          ],
        },
      ],
    },
  },
)
