/** @type {import('@lingui/conf').LinguiConfig} */
module.exports = {
  locales: ["hy", "ru", "en"],
  catalogs: [
    {
      path: "src/locales/{locale}/messages",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "src/locales/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
      ],
    },
  ],
  runtimeConfigModule: ["@lingui/core", "i18n"],
  sourceLocale: "hy",
  fallbackLocales: false,
  format: "po",
};
