/**
 * Config commands for CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadConfig,
  getConfigValue,
  setConfigValue,
  resetConfig,
  getConfigPath,
  configExists,
  type CliConfig,
} from '../lib/config.js';

export function registerConfigCommands(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage CLI configuration');

  // List all configuration
  configCmd
    .command('list')
    .description('Show current configuration')
    .action(() => {
      const config = loadConfig();
      const configPath = getConfigPath();
      const exists = configExists();

      console.log(`\n${chalk.bold('Gird CLI Configuration')}\n`);

      if (exists) {
        console.log(`  ${chalk.gray('Config File:')} ${chalk.cyan(configPath)}`);
      } else {
        console.log(`  ${chalk.gray('Config File:')} ${chalk.yellow('(not found, using defaults)')}`);
        console.log(`  ${chalk.gray('Expected at:')} ${chalk.cyan(configPath)}`);
      }

      console.log('');
      console.log(`  ${chalk.gray('API Endpoint:')}    ${chalk.cyan(config.apiEndpoint)}`);
      console.log(`  ${chalk.gray('Agent Endpoint:')}  ${chalk.cyan(config.agentEndpoint)}`);
      console.log(`  ${chalk.gray('Output Format:')}   ${chalk.cyan(config.outputFormat)}`);
      console.log('');
    });

  // Get a specific config value
  configCmd
    .command('get <key>')
    .description('Get a configuration value')
    .action((key: string) => {
      const validKeys = ['apiEndpoint', 'agentEndpoint', 'outputFormat'];

      if (!validKeys.includes(key)) {
        console.error(
          `${chalk.red('Error:')} Invalid key "${key}". Valid keys: ${validKeys.join(', ')}`
        );
        process.exit(1);
      }

      const value = getConfigValue(key as keyof CliConfig);
      console.log(value);
    });

  // Set a configuration value
  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => {
      const validKeys = ['apiEndpoint', 'agentEndpoint', 'outputFormat'];

      if (!validKeys.includes(key)) {
        console.error(
          `${chalk.red('Error:')} Invalid key "${key}". Valid keys: ${validKeys.join(', ')}`
        );
        process.exit(1);
      }

      // Validate outputFormat
      if (key === 'outputFormat') {
        const validFormats = ['json', 'table', 'plain'];
        if (!validFormats.includes(value)) {
          console.error(
            `${chalk.red('Error:')} Invalid output format "${value}". Valid formats: ${validFormats.join(', ')}`
          );
          process.exit(1);
        }
      }

      try {
        setConfigValue(key as keyof CliConfig, value as CliConfig[keyof CliConfig]);
        console.log(
          `${chalk.green('✓')} Set ${chalk.cyan(key)} = ${chalk.cyan(value)}`
        );
        console.log(`  Config saved to ${chalk.gray(getConfigPath())}`);
      } catch (error) {
        console.error(`${chalk.red('Error:')} Failed to save configuration`);
        console.error(error);
        process.exit(1);
      }
    });

  // Reset to defaults
  configCmd
    .command('reset')
    .description('Reset configuration to defaults')
    .option('-f, --force', 'Reset without confirmation')
    .action((options) => {
      if (!options.force) {
        console.log(
          `${chalk.yellow('This will reset your configuration to defaults.')}`
        );
        console.log(`${chalk.yellow('Use --force to confirm.')}`);
        return;
      }

      try {
        resetConfig();
        console.log(`${chalk.green('✓')} Configuration reset to defaults`);
        console.log(`  Config saved to ${chalk.gray(getConfigPath())}`);
      } catch (error) {
        console.error(`${chalk.red('Error:')} Failed to reset configuration`);
        console.error(error);
        process.exit(1);
      }
    });

  // Show config file path
  configCmd
    .command('path')
    .description('Show configuration file path')
    .action(() => {
      const configPath = getConfigPath();
      const exists = configExists();

      console.log(configPath);

      if (exists) {
        console.error(chalk.gray('(file exists)'));
      } else {
        console.error(chalk.yellow('(file does not exist)'));
      }
    });
}
