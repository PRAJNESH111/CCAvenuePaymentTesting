const {
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const ccavenueAndroidSdkDependency =
  'com.ccavenue.indiasdk:sdk:2.0.0';

const localPropertiesLoader = `
def ccavenueLocalProperties = new Properties()
def ccavenueLocalPropertiesFile = rootProject.file('local.properties')
if (ccavenueLocalPropertiesFile.exists()) {
  ccavenueLocalPropertiesFile.withInputStream { stream ->
    ccavenueLocalProperties.load(stream)
  }
}
`;

const githubPackagesRepository = `
    maven {
      name = 'GitHubPackages'
      url = uri('https://maven.pkg.github.com/InfibeamAvenues/CCAvenue_SDK_2.0')
      credentials {
        username = ccavenueLocalProperties.getProperty('gpr.usr') ?: findProperty('gpr.usr') ?: System.getenv('GITHUB_ACTOR') ?: ''
        password = ccavenueLocalProperties.getProperty('gpr.key') ?: findProperty('gpr.key') ?: System.getenv('GITHUB_TOKEN') ?: ''
      }
    }
`;

module.exports = function withCCAvenue(config) {
  config = withProjectBuildGradle(config, (projectConfig) => {
    if (projectConfig.modResults.language !== "groovy") {
      return projectConfig;
    }

    const contents = projectConfig.modResults.contents;

    let updatedContents = contents;

    if (!updatedContents.includes("ccavenueLocalProperties")) {
      updatedContents = updatedContents.replace(
        "allprojects {",
        `${localPropertiesLoader}\nallprojects {`,
      );
    }

    if (!updatedContents.includes("maven.pkg.github.com/InfibeamAvenues")) {
      const jitpackRepository =
        /maven\s*\{\s*url ['"]https:\/\/(?:www\.)?jitpack\.io['"]\s*\}/;
      updatedContents = updatedContents.replace(
        jitpackRepository,
        `$&\n${githubPackagesRepository}`,
      );
    }

    projectConfig.modResults.contents = updatedContents;

    return projectConfig;
  });

  return withAppBuildGradle(config, (appConfig) => {
    if (appConfig.modResults.language !== "groovy") {
      return appConfig;
    }

    const contents = appConfig.modResults.contents;

    const sdkDependency = /implementation\(["']com\.ccavenue\.indiasdk:sdk:[^"']+["']\)/;

    if (sdkDependency.test(contents)) {
      appConfig.modResults.contents = contents.replace(
        sdkDependency,
        `implementation("${ccavenueAndroidSdkDependency}")`,
      );
    } else {
      appConfig.modResults.contents = contents.replace(
        'implementation("com.facebook.react:react-android")',
        `implementation("com.facebook.react:react-android")\n    implementation("${ccavenueAndroidSdkDependency}")`,
      );
    }

    return appConfig;
  });

  return withDangerousMod(config, ["android", async (androidConfig) => {
    const packageGradlePath = path.join(
      androidConfig.modRequest.projectRoot,
      "node_modules",
      "ccavenue-india-sdk-react-native",
      "android",
      "build.gradle",
    );

    if (fs.existsSync(packageGradlePath)) {
      const contents = fs.readFileSync(packageGradlePath, "utf8");
      const sdkDependency = /implementation\s+["']com\.ccavenue\.indiasdk:sdk:[^"']+["']/;
      const updatedContents = contents.replace(
        sdkDependency,
        `implementation "${ccavenueAndroidSdkDependency}"`,
      );

      if (updatedContents !== contents) {
        fs.writeFileSync(packageGradlePath, updatedContents);
      }
    }

    return androidConfig;
  }]);
};
