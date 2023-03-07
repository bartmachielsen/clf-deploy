#!/usr/bin/env node
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const glob = require("glob")
const path = require("path");
const YAML = require('yaml')
const cfn = require('cfn');
const fs = require('fs')
const _ = require('lodash');
const S3 = require('@aws-sdk/client-s3');

const argv = yargs(hideBin(process.argv))
    .option('config', {
        alias: 'c',
        describe: 'Config file or multiple files when using a pattern',
    })
    .option('base', {
        alias: 'b',
        describe: 'Base config file to use',
    })
    .demandOption(['config'], 'Please provide a config file location to process')
    .help()
    .argv

glob(argv.config, {}, async function (er, files) {
    for (let file_location of files) {
        const baseConfig = argv['base'] ? YAML.parse(fs.readFileSync(argv['base'], 'utf8')): {};
        const config = _.merge(baseConfig, YAML.parse(fs.readFileSync(file_location, 'utf8')));
        const name = (config.prefix || '') + config.name || path.basename(file_location, path.extname(file_location))

        // Replace variables
        if (config.parameters) {
            for (let conf_key in config.parameters) {
                if (
                    config.parameters[conf_key].startsWith &&
                    config.parameters[conf_key].startsWith("!") &&
                    config.parameters[config.parameters[conf_key].replace("!", "")]
                ) {
                    console.log(
                        `Resolving reference ${conf_key} with value "${config.parameters[conf_key]}" to "${config.parameters[config.parameters[conf_key].replace("!", "")]}"`
                    )
                    config.parameters[conf_key] = config.parameters[config.parameters[conf_key].replace("!", "")]
                }
            }
        }
        const stage = config.parameters['Stage'] || process.env.DEPLOY_STAGE || argv['base'].split('/').pop().split('.').shift();

        if (config.deployment_stages && config.deployment_stages.length > 0) {
            if (!config.deployment_stages.includes(stage)) {
                console.log(`Skipping deployment of '${name}' as it is not in the deploy stages for this environment`)
                continue;
            }
        }

        console.log(`Deploying: '${name}' (${stage})`)

        const match = config.template.match(/s3:\/\/([^\/]+)\/(.+)/)
        if (match) {
            console.log(`Downloading from S3: ${config.template}`)
            const data = await new S3({region: config.region}).getObject({Bucket: match[1], Key: match[2] }).promise();
            config.template = data.Body.toString('utf-8');
        }

        await cfn(
            {
                name: name,
                template: config.template,
                cfParams: config.parameters,
                tags: {
                    ...config.tags,
                    Name: name
                },
                awsConfig: {
                    region: config.region
                },
                capabilities: config.capabilities,
                checkStackInterval: 1000,
            },
            config.template
        );

    }
})
