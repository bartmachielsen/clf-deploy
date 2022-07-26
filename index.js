#!/usr/bin/env node
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const glob = require("glob")
const path = require("path");
const YAML = require('yaml')
const cfn = require('cfn');
const fs = require('fs')
const _ = require('lodash');
const S3 = require('aws-sdk/clients/s3');
const {isString} = require("lodash");

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
        for (let conf_key in config) {
            if (
                isString(config[conf_key]) &&
                config[conf_key].startsWith("!") &&
                config[config[conf_key].replace("!", "")]
            ) {
                config[conf_key] = config[config[conf_key].replace("!", "")]
            }
        }

        console.log(`Deploying: '${name}'`)

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
