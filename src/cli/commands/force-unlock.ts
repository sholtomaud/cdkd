import { commonOptions, stateOptions, stackOptions } from '../options.js';
import { getLogger } from '../../utils/logger.js';
import { withErrorHandling } from '../../utils/error-handler.js';
import { LockManager } from '../../state/lock-manager.js';
import { setAwsClients, AwsClients } from '../../utils/aws-clients.js';
import { resolveStateBucketWithDefault } from '../config-loader.js';
import type { CliCommand } from '../cli-parser.js';

async function forceUnlockCommand(
  stackArgs: string[],
  options: any
): Promise<void> {
  const logger = getLogger();
  if (options.verbose) logger.setLevel('debug');
  const stackPatterns = stackArgs.length > 0 ? stackArgs : options.stack ? [options.stack] : [];
  if (stackPatterns.length === 0) throw new Error('Stack name is required.');
  const region = options.region || process.env['AWS_REGION'] || 'us-east-1';
  const stateBucket = await resolveStateBucketWithDefault(options['state-bucket'], region);
  const awsClients = new AwsClients({ ...(options.region && { region }), ...(options.profile && { profile: options.profile }) });
  setAwsClients(awsClients);
  try {
    const lockManager = new LockManager(awsClients.s3, { bucket: stateBucket, prefix: options['state-prefix'] });
    for (const stackName of stackPatterns) {
      logger.info(`Force-unlocking stack: ${stackName}`);
      await lockManager.forceReleaseLock(stackName);
    }
  } finally {
    awsClients.destroy();
  }
}

export function createForceUnlockCommand(): CliCommand {
  return {
    name: 'force-unlock',
    description: 'Force-release lock',
    options: [...commonOptions, ...stateOptions, ...stackOptions],
    action: withErrorHandling(forceUnlockCommand),
  };
}
