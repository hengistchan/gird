/**
 * CLI utilities
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import type { ApiKeyInfo } from '@gird-mcp/core';

export function formatTable(headers: string[], rows: string[][]): void {
  const table = new Table({
    head: headers.map((h) => chalk.cyan(h)),
    style: {
      head: [],
      border: ['grey'],
    },
  });

  for (const row of rows) {
    table.push(row);
  }

  console.log(table.toString());
}

export function formatApiKey(key: ApiKeyInfo & { key?: string }): void {
  console.log(chalk.bold(`\n${key.name}`));
  console.log(`  ID:          ${chalk.dim(key.id)}`);
  if (key.key) {
    console.log(`  Key:         ${chalk.green(key.key)}`);
  }
  console.log(`  Permissions: ${chalk.yellow(JSON.stringify(key.permissions))}`);
  console.log(`  Created:     ${chalk.dim(key.createdAt.toISOString())}`);
}

export function success(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

export function error(message: string): void {
  console.error(chalk.red(`✗ ${message}`));
}

export function info(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

export function warn(message: string): void {
  console.warn(chalk.yellow(`⚠ ${message}`));
}
