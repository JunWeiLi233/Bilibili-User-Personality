module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  // House style (measured): single quotes, semicolons, 2-space indent, no tabs,
  // let/const, no trailing whitespace, final newline. Enforced so consistency
  // stops depending on agent memory — see autoresearch/debug-260701-codestyle.
  rules: {
    semi: ['error', 'always'],
    quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    'no-var': 'error',
    'no-tabs': 'error',
    'no-trailing-spaces': 'error',
    'eol-last': ['error', 'always'],
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'python_backend/',
    'server/data/',
    '.claude/',
  ],
};
