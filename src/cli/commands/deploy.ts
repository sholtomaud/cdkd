import {
  appOptions,
  commonOptions,
  stateOptions,
  stackOptions,
  deployOptions,
  contextOptions,
  parseContextOptions,
} from '../options.js';
import { getLogger } from '../../utils/logger.js';
import { withErrorHandling } from '../../utils/error-handler.js';
import { Synthesizer } from '../../synthesis/synthesizer.js';
import { S3StateBackend } from '../../state/s3-state-backend.js';
import { LockManager } from '../../state/lock-manager.js';
import { DagBuilder } from '../../analyzer/dag-builder.js';
import { DiffCalculator } from '../../analyzer/diff-calculator.js';
import { ProviderRegistry } from '../../provisioning/provider-registry.js';
import { registerAllProviders } from '../../provisioning/register-providers.js';
import { DeployEngine } from '../../deployment/deploy-engine.js';
import { WorkGraph } from '../../deployment/work-graph.js';
import { setAwsClients, AwsClients } from '../../utils/aws-clients.js';
import { resolveApp, resolveStateBucketWithDefault } from '../config-loader.js';
import type { CliCommand } from '../cli-parser.js';

async function deployCommand(
  _stacks: string[],
  options: any
): Promise<void> {
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
    const dagBuilder = new DagBuilder();
    const diffCalculator = new DiffCalculator();
    const workGraph = new WorkGraph();

    for (const stack of allStacks) {
      workGraph.addNode({
        id: `stack:${stack.stackName}`,
        type: 'stack',
        dependencies: new Set(),
        state: 'pending',
        data: { stack },
      });
    }

    await workGraph.execute(
      { 'asset-build': 4, 'asset-publish': 8, stack: 4 },
      async (node) => {
        const { stack: stackInfo } = node.data as { stack: any };
        const stackAwsClients = new AwsClients({ region });
        setAwsClients(stackAwsClients);
        const providerRegistry = new ProviderRegistry();
        registerAllProviders(providerRegistry);
        const stackDeployEngine = new DeployEngine(
          new S3StateBackend(stackAwsClients.s3, stateConfig),
          new LockManager(stackAwsClients.s3, stateConfig),
          dagBuilder, diffCalculator, providerRegistry,
          { concurrency: options.concurrency }, region
        );
        await stackDeployEngine.deploy(stackInfo.stackName, stackInfo.template);
      }
    );
  } finally {
    awsClients.destroy();
  }
}

export function createDeployCommand(): CliCommand {
  return {
    name: 'deploy',
    description: 'Deploy app',
    options: [...commonOptions, ...appOptions, ...stateOptions, ...stackOptions, ...deployOptions, ...contextOptions],
    action: withErrorHandling(deployCommand),
  };
}
