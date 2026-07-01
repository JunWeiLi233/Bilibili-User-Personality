module.exports = {
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
  rules: {},
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'python_backend/',
    'server/data/',
    '.claude/',
  ],
};
