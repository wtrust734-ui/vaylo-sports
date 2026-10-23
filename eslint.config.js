import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output only, never hand-written source. `android/app/build` and
    // `android/app/src/main/assets` are Capacitor/Gradle output regenerated on
    // every build, and the generated `native-bridge.js` carries an eslint-disable
    // for a rule this flat config does not register — which ESLint reports as the
    // error "Definition for rule ... was not found", failing `npm run lint` on a
    // file nobody wrote.
    ignores: [
      "dist",
      // Stale copies and scratch trees (see .gitignore). They are not linted:
      // the `.tools/*.mjs` scratch scripts and the stale `vaylo ad web app/`
      // copy produce parse errors and rule noise on files nobody maintains.
      ".tools",
      ".ui-backup",
      "vaylo ad web app",
      ".bundles",
      "apk",
      // scripts/vercel-redeploy.cjs is a shell script whose name ends .cjs;
      // Espree parses it as JavaScript and fails on line 2. The name stays for
      // historical reasons, so the linter is told to step over it.
      "scripts/vercel-redeploy.cjs",
      "android/app/build",
      "android/build",
      "android/.gradle",
      "android/app/src/main/assets",
      "ios/App/Pods",
      "ios/App/build",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
