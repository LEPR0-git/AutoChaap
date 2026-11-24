module.exports = ({config}) => ({
  ...config,
  plugins: (config.plugins || []).map(p =>
    Array.isArray(p) && p[0] === 'expo-build-properties'
      ? ['expo-build-properties', { ...p[1], android: { ...p[1].android, usesCleartextTraffic: process.env.AUTOCHAPP_ALLOW_HTTP === '1' } }]
      : p
  ),
});
