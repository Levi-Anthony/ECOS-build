import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      // This private server-rendered dashboard deliberately uses plain anchors
      // and small render-local display helpers; neither pattern carries client
      // state or navigation performance risk here.
      "@next/next/no-html-link-for-pages": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);
