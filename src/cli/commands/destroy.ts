import {
  appOptions,
  commonOptions,
  stateOptions,
  stackOptions,
  destroyOptions,
  contextOptions,
} from '../options.js';
import { getLogger } from '../../utils/logger.js';
import { withErrorHandling } from '../../utils/error-handler.js';
import { S3StateBackend } from '../../state/s3-state-backend.js';
import { LockManager } from '../../state/lock-manager.js';
import { ProviderRegistry } from '../../provisioning/provider-registry.js';
import { registerAllProviders } from '../../provisioning/register-providers.js';
import { setAwsClients, AwsClients } from '../../utils/aws-clients.js';
import * as readline from 'node:readline/promises';
import { resolveStateBucketWithDefault } from '../config-loader.js';
import { CliCommand } from '../cli-parser.js';

async function destroyCommand(
  _stackArgs: string[],
  options: any
): Promise<void> {
  const logger = getLogger();
  if (options.verbose) logger.setLevel('debug');
  const region = process.env['AWS_REGION'] || 'us-east-1';
  const stateBucket = await resolveStateBucketWithDefault(options['state-bucket'], region);
  const awsClients = new AwsClients({ region });
  setAwsClients(awsClients);
  try {
    const stateBackend = new S3StateBackend(awsClients.s3, { bucket: stateBucket, prefix: options['state-prefix'] });
    const lockManager = new LockManager(awsClients.s3, { bucket: stateBucket, prefix: options['state-prefix'] });
    const providerRegistry = new ProviderRegistry();
    registerAllProviders(providerRegistry);
    const stacks = await stateBackend.listStacks();
    for (const stackName of stacks) {
      if (!options.force) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(`Destroy ${stackName}? (y/N): `);
        rl.close();
        if (answer.toLowerCase() !== 'y') continue;
      }
      await lockManager.acquireLock(stackName, 'destroy');
      const stateResult = await stateBackend.getState(stackName);
      if (stateResult) {
        for (const [logicalId, resource] of Object.entries(stateResult.state.resources)) {
          const provider = providerRegistry.getProvider(resource.resourceType);
          await provider.delete(logicalId, resource.physicalId, resource.resourceType, resource.properties);
        }
        await stateBackend.deleteState(stackName);
      }
      await lockManager.releaseLock(stackName);
    }
  } finally {
    awsClients.destroy();
  }
}

export function createDestroyCommand(): CliCommand {
  return {
    name: 'destroy',
    description: 'Destroy stacks',
    options: [...commonOptions, ...appOptions, ...stateOptions, ...stackOptions, ...destroyOptions, ...contextOptions],
    action: withErrorHandling(destroyCommand),
  };
}
