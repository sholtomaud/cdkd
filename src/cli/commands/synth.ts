import { appOptions, commonOptions, contextOptions, parseContextOptions } from '../options.js';
import { getLogger } from '../../utils/logger.js';
import { withErrorHandling } from '../../utils/error-handler.js';
import { Synthesizer } from '../../synthesis/synthesizer.js';
import { resolveApp } from '../config-loader.js';
import type { CliCommand } from '../cli-parser.js';

async function synthCommand(
  _args: string[],
  options: {
    app?: string;
    output: string;
    verbose: boolean;
    context?: string[];
  }
): Promise<void> {
  const logger = getLogger();
  if (options.verbose) logger.setLevel('debug');
  const app = resolveApp(options.app);
  if (!app) throw new Error('No app command specified.');
  const synthesizer = new Synthesizer();
  const context = parseContextOptions(options.context);
  const result = await synthesizer.synthesize({
    app,
    output: options.output,
    context,
  });
  if (result.stacks.length === 1) {
    process.stdout.write(JSON.stringify(result.stacks[0]!.template, null, 2));
  }
}

export function createSynthCommand(): CliCommand {
  return {
    name: 'synth',
    description: 'Synthesize app',
    options: [...commonOptions, ...appOptions, ...contextOptions],
    action: withErrorHandling(synthCommand),
  };
}
