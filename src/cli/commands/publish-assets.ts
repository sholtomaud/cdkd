import { commonOptions } from '../options.js';
import { getLogger } from '../../utils/logger.js';
import { withErrorHandling } from '../../utils/error-handler.js';
import { AssetPublisher } from '../../assets/asset-publisher.js';
import { CliCommand } from '../cli-parser.js';

async function publishAssetsCommand(
  _args: string[],
  options: any
): Promise<void> {
  const logger = getLogger();
  if (options.verbose) logger.setLevel('debug');
  const publisher = new AssetPublisher();
  await publisher.publishFromManifest(options.path, {
    ...(options.profile && { profile: options.profile }),
    ...(options.region && { region: options.region }),
    assetPublishConcurrency: options['asset-publish-concurrency'],
    imageBuildConcurrency: options['image-build-concurrency'],
  });
}

export function createPublishAssetsCommand(): CliCommand {
  return {
    name: 'publish-assets',
    description: 'Publish assets',
    options: [
      { name: 'path', description: 'Manifest path', type: 'string' },
      { name: 'asset-publish-concurrency', description: 'Concurrency', type: 'number', default: 8 },
      { name: 'image-build-concurrency', description: 'Concurrency', type: 'number', default: 4 },
      ...commonOptions,
    ],
    action: withErrorHandling(publishAssetsCommand),
  };
}
