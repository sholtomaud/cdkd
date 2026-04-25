import { CliOption } from './cli-parser.js';
export function parseContextOptions(contextArgs?: string[]): Record<string, string> {
  const context: Record<string, string> = {};
  if (contextArgs) {
    for (const arg of contextArgs) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) context[arg.substring(0, eqIndex)] = arg.substring(eqIndex + 1);
    }
  }
  return context;
}
export const commonOptions: CliOption[] = [
  { name: 'verbose', description: 'Enable verbose logging', type: 'boolean', default: false },
  { name: 'region', description: 'AWS region', type: 'string' },
  { name: 'profile', description: 'AWS profile', type: 'string' },
];
export const appOptions: CliOption[] = [
  { name: 'app', description: 'CDK app command', type: 'string' },
  { name: 'output', description: 'Output directory', type: 'string', default: 'cdk.out' },
];
export const stateOptions: CliOption[] = [
  { name: 'state-bucket', description: 'S3 bucket for state', type: 'string' },
  { name: 'state-prefix', description: 'S3 key prefix', type: 'string', default: 'cdkd' },
];
export const stackOptions: CliOption[] = [
  { name: 'stack', description: 'Stack name', type: 'string' }
];
export const deployOptions: CliOption[] = [
  { name: 'concurrency', description: 'Concurrency', type: 'number', default: 10 },
  { name: 'dry-run', description: 'Dry run', type: 'boolean', default: false },
  { name: 'no-rollback', description: 'No rollback', type: 'boolean', default: false },
  { name: 'no-wait', description: 'No wait', type: 'boolean', default: false },
];
export const contextOptions: CliOption[] = [
  { name: 'context', short: 'c', description: 'Set context', type: 'array' },
];
export const destroyOptions: CliOption[] = [
  { name: 'force', description: 'Skip confirmation', type: 'boolean', default: false }
];
