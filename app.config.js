// Lets the web build be served from a sub-path (GitHub Pages: EXPO_BASE_URL=/relay-wallet).
module.exports = ({ config }) => ({
  ...config,
  experiments: { ...(config.experiments ?? {}), baseUrl: process.env.EXPO_BASE_URL || '' },
});
