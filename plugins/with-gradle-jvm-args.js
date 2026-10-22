const { withGradleProperties } = require('expo/config-plugins');

/**
 * Raises the Gradle daemon's memory caps so a release build survives lint.
 *
 * `expo prebuild` writes `org.gradle.jvmargs=-Xmx2048m
 * -XX:MaxMetaspaceSize=512m`, and 512 MB of metaspace is not enough for
 * `lintVitalAnalyzeRelease` across this dependency tree. The build fails with
 * a one-word explanation:
 *
 *     Execution failed for task ':react-native-safe-area-context:lintVitalAnalyzeRelease'.
 *     > A failure occurred while executing AndroidLintWorkAction
 *        > Metaspace
 *
 * "Metaspace" is the entire message. Nothing says out-of-memory, nothing
 * names a limit, and the task it lands on is whichever module lint happened
 * to reach first — so it reads like a problem with that library. It showed up
 * here only when an iOS build was running alongside it, which is exactly the
 * kind of intermittency that sends you looking in the wrong place.
 *
 * Both numbers are **caps, not reservations**: the JVM commits what it uses,
 * so raising them costs nothing on a machine that does not need the headroom
 * and does not make the build slower.
 *
 * This is a plugin rather than an edit to `android/gradle.properties` because
 * `android/` is gitignored and regenerated — a hand edit survives until the
 * next prebuild, which is to say until the next release build.
 */

const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=2048m';

module.exports = function withGradleJvmArgs(config) {
  return withGradleProperties(config, (cfg) => {
    const existing = cfg.modResults.find(
      (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs',
    );
    if (existing) {
      existing.value = JVM_ARGS;
    } else {
      cfg.modResults.push({
        type: 'property',
        key: 'org.gradle.jvmargs',
        value: JVM_ARGS,
      });
    }
    return cfg;
  });
};
