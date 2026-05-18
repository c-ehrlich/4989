import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".output/**", ".tanstack/**", ".vercel/**", "dist/**", "**/routeTree.gen.ts"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ["eslint.config.js", "vite.config.ts"],
    languageOptions: {
      globals: {
        console: "readonly"
      }
    }
  }
);
