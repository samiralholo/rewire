/**
 * WatermelonDB models use legacy decorators (@text, @field, ...) — the
 * decorators plugin MUST run in legacy mode and before class-properties
 * (babel-preset-expo brings class-properties itself, so order matters).
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [['@babel/plugin-proposal-decorators', { legacy: true }]],
  };
};
