import {
  appOptions,
  commonOptions,
  stateOptions,
  stackOptions,
  contextOptions,
  parseContextOptions,
} from '../options.js';
import { getLogger } from '../../utils/logger.js';
import { withErrorHandling } from '../../utils/error-handler.js';
import { Synthesizer } from '../../synthesis/synthesizer.js';
import { S3StateBackend } from '../../state/s3-state-backend.js';
import { DiffCalculator } from '../../analyzer/diff-calculator.js';
import { IntrinsicFunctionResolver } from '../../deployment/intrinsic-function-resolver.js';
import { setAwsClients, AwsClients } from '../../utils/aws-clients.js';
import { resolveApp, resolveStateBucketWithDefault } from '../config-loader.js';
import type { CliCommand } from '../cli-parser.js';

async function diffCommand(_stacks: string[], options: any): Promise<void> {
  const logger = getLogger();
  if (options.verbose) logger.setLevel('debug');
  const app = resolveApp(options.app);
  if (!app) throw new Error('No app command specified.');
  const region = options.region || process.env['AWS_REGION'] || 'us-east-1';
  const stateBucket = await resolveStateBucketWithDefault(options['state-bucket'], region);
  const awsClients = new AwsClients({
    ...(options.region && { region: options.region }),
    ...(options.profile && { profile: options.profile }),
  });
  setAwsClients(awsClients);
  try {
    const synthesizer = new Synthesizer();
    const context = parseContextOptions(options.context);
    const result = await synthesizer.synthesize({
      app,
      output: options.output,
      ...(options.region && { region: options.region }),
      ...(options.profile && { profile: options.profile }),
      ...(Object.keys(context).length > 0 && { context }),
    });
    const { stacks: allStacks } = result;
    const stateConfig = { bucket: stateBucket, prefix: options['state-prefix'] };
    const stateBackend = new S3StateBackend(awsClients.s3, stateConfig);
    const diffCalculator = new DiffCalculator();
    const intrinsicResolver = new IntrinsicFunctionResolver(region);

    for (const stackInfo of allStacks) {
      logger.info(`Calculating diff for ${stackInfo.stackName}...`);
      const stateResult = await stateBackend.getState(stackInfo.stackName);
      const currentState = stateResult?.state || { resources: {} };
      const diffResolveFn = (value: any) =>
        intrinsicResolver.resolve(value, {
          template: stackInfo.template,
          resources: (currentState as any).resources,
          stateBackend,
          stackName: stackInfo.stackName,
        });
      const changes = await diffCalculator.calculateDiff(
        currentState as any,
        stackInfo.template,
        diffResolveFn
      );
      if (changes.size === 0) logger.info('No changes.');
      else logger.info(`Found ${changes.size} changes.`);
    }
  } finally {
    awsClients.destroy();
  }
}

export function createDiffCommand(): CliCommand {
  return {
    name: 'diff',
    description: 'Show stack difference',
    options: [...commonOptions, ...appOptions, ...stateOptions, ...stackOptions, ...contextOptions],
    action: withErrorHandling(diffCommand),
  };
}
