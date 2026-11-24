import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      'node_modules/**/*',
      'backend/**/*',
      'android/**/*',
      'website/**/*',
      'e2e-playwright/**/*',
      'storage.rules',
    ],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
