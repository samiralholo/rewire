const { withMainApplication } = require('@expo/config-plugins');

/**
 * Fixes @morrowdigital/watermelondb-expo-plugin for React Native 0.76+ / Expo SDK 52.
 *
 * The upstream plugin (v2.3.3) registers WatermelonDB's JSI package through the
 *   override fun getJSIModulePackage(): JSIModulePackage { return WatermelonDBJSIPackage() }
 * hook. React Native 0.76 removed that API entirely — `com.facebook.react.bridge.JSIModulePackage`
 * no longer exists and `ReactNativeHost` no longer has `getJSIModulePackage()` — so the generated
 * MainApplication.kt fails to compile (`:app:compileReleaseKotlin`).
 *
 * In current WatermelonDB, `WatermelonDBJSIPackage` is a plain `ReactPackage` whose
 * `WatermelonDBJSIModule` exposes a synchronous `install()` that the JS SQLiteAdapter({ jsi: true })
 * calls at runtime. The supported registration on RN 0.76 is therefore to add the package to
 * `getPackages()`. This plugin runs after the upstream one and rewrites its output accordingly.
 */
module.exports = function withWatermelonJSIFix(config) {
  return withMainApplication(config, (mod) => {
    let contents = mod.modResults.contents;

    // 1. Drop the removed JSIModulePackage import.
    contents = contents.replace(
      /^[ \t]*import com\.facebook\.react\.bridge\.JSIModulePackage;?[ \t]*\r?\n/m,
      ''
    );

    // 2. Remove the broken getJSIModulePackage() override block (keep the isHermesEnabled line).
    contents = contents.replace(
      /\n[ \t]*override fun getJSIModulePackage\(\): JSIModulePackage \{[\s\S]*?return WatermelonDBJSIPackage\(\)[\s\S]*?\}[ \t]*\r?\n/m,
      '\n'
    );

    // 3. Ensure the JSI package import is present.
    if (!contents.includes('import com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage')) {
      contents = contents.replace(
        /^import android\.app\.Application/m,
        'import android.app.Application\nimport com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage'
      );
    }

    // 4. Register WatermelonDBJSIPackage via getPackages() (the RN 0.76 way).
    if (!contents.includes('packages.add(WatermelonDBJSIPackage())')) {
      contents = contents.replace(
        /val packages = PackageList\(this\)\.packages/,
        'val packages = PackageList(this).packages\n            packages.add(WatermelonDBJSIPackage())'
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
};
