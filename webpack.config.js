const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const ReplaceInFileWebpackPlugin = require("replace-in-file-webpack-plugin");
const WebpackCommon = require("./webpack.common.config");

const Target = WebpackCommon.GetTargetPath();

const Settings = {
    "production": {
        Tag: "",
        TaskGuid: "{{guid_production}}",
    },
    "development": {
        Tag: "Dev",
        TaskGuid: "{{guid_development}}",
    }
    // Can add more flavors here as needed. For example, a flavor for pre-production
};

module.exports = env => {

    const validEnvs = Object.keys(Settings);
    if (!validEnvs.includes(env)) {
        console.error(`BUILD_ENV not set correctly. Allowed values are: ${validEnvs.join(", ")}`);
        process.exit(1);
    }

    const config = {

        entry: {
            "main": "./src/run-aqa/main.ts",
        },

        plugins: [
            new CopyWebpackPlugin([
                // These files are needed by azure-pipelines-task-lib library.
                {
                    from: path.resolve("./node_modules/azure-pipelines-task-lib/lib.json"),
                    to: path.join(Target, "run-aqa")
                },
                {
                    from: path.resolve("./node_modules/azure-pipelines-task-lib/Strings"),
                    to: path.join(Target, "run-aqa")
                },

                {
                    from: path.join(__dirname, "./src/run-aqa/task.json"),
                    to: path.join(Target, "run-aqa")
                },
                {
                    from: path.join(__dirname, "./images/icon.png"),
                    to: path.join(Target, "run-aqa", "icon.png")
                },
                {
                    from: path.join(__dirname, "./manifests/base.json"),
                    to: Target
                },
                {
                    from: path.join(__dirname, "./manifests", `${env}.json`),
                    to: Target
                },
                {
                    from: path.join(__dirname, "./images/icon.png"),
                    to: Target
                },
                {
                    from: path.join(__dirname, "./src/README.md"),
                    to: Target
                }
            ]),

            WebpackCommon.PackageJsonLoadFixer(Target, [
                "run-aqa/main.js",
            ]),

            WebpackCommon.VersionStringReplacer(Target, [
                "run-aqa/task.json",
                "base.json"
            ]),

            new ReplaceInFileWebpackPlugin([
                {
                    dir: Target,
                    files: [
                        "run-aqa/main.js",
                        "run-aqa/task.json",
                        "base.json"
                    ],
                    rules: [
                        // This replacement is required to allow azure-pipelines-task-lib to load the 
                        // json resource file correctly
                        {
                            search: /__webpack_require__\(.*\)\(resourceFile\)/,
                            replace: 'require(resourceFile)'
                        },
                        {
                            search: /{{taskid}}/ig,
                            replace: Settings[env].TaskGuid
                        },
                        {
                            search: /{{tag}}/ig,
                            replace: Settings[env].Tag
                        }
                    ]
                }
            ])
        ],
    };

    return WebpackCommon.FillDefaultNodeSettings(config, env, "run-aqa");
};
