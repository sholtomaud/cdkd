import {
  commonOptions,
} from '../options.js';
import { getLogger } from '../../utils/logger.js';
import { withErrorHandling } from '../../utils/error-handler.js';
import { setAwsClients, AwsClients } from '../../utils/aws-clients.js';
import { getDefaultStateBucketName } from '../config-loader.js';
import { CliCommand } from '../cli-parser.js';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutBucketVersioningCommand,
  PutBucketEncryptionCommand,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';

async function bootstrapCommand(
  _args: string[],
  options: {
    'state-bucket'?: string;
    region?: string;
    profile?: string;
    force: boolean;
    verbose: boolean;
  }
): Promise<void> {
  const logger = getLogger();
  if (options.verbose) logger.setLevel('debug');
  logger.info('Starting cdkd bootstrap...');
  const awsClients = new AwsClients({
    ...(options.region && { region: options.region }),
    ...(options.profile && { profile: options.profile }),
  });
  setAwsClients(awsClients);
  const s3Client = awsClients.s3;
  const region = options.region || process.env['AWS_REGION'] || 'us-east-1';
  let bucketName: string;
  let accountId: string;
  if (options['state-bucket']) {
    bucketName = options['state-bucket'];
    const identity = await awsClients.sts.send(new GetCallerIdentityCommand({}));
    accountId = identity.Account!;
  } else {
    logger.info('No --state-bucket specified, resolving default bucket name...');
    const identity = await awsClients.sts.send(new GetCallerIdentityCommand({}));
    accountId = identity.Account!;
    bucketName = getDefaultStateBucketName(accountId, region);
    logger.info(`Using default state bucket: ${bucketName}`);
  }
  try {
    let bucketExists = false;
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
      bucketExists = true;
      logger.info(`Bucket ${bucketName} already exists`);
    } catch (error) {
      const err = error as { name?: string };
      if (err.name === 'NotFound' || err.name === 'NoSuchBucket') {
        logger.debug(`Bucket ${bucketName} does not exist, will create`);
      } else throw error;
    }
    if (bucketExists) {
      if (!options.force) {
        logger.warn(`Bucket ${bucketName} already exists. Use --force to reconfigure`);
        return;
      }
      logger.info('--force specified, continuing with existing bucket');
    } else {
      logger.info(`Creating S3 bucket: ${bucketName} in region ${region}`);
      const createBucketParams: {
        Bucket: string;
        CreateBucketConfiguration?: { LocationConstraint: BucketLocationConstraint };
      } = { Bucket: bucketName };
      if (region !== 'us-east-1') {
        createBucketParams.CreateBucketConfiguration = {
          LocationConstraint: region as BucketLocationConstraint,
        };
      }
      await s3Client.send(new CreateBucketCommand(createBucketParams));
      logger.info(`✓ Created S3 bucket: ${bucketName}`);
    }
    await s3Client.send(new PutBucketVersioningCommand({
        Bucket: bucketName,
        VersioningConfiguration: { Status: 'Enabled' },
    }));
    logger.info('✓ Enabled bucket versioning');
    await s3Client.send(new PutBucketEncryptionCommand({
        Bucket: bucketName,
        ServerSideEncryptionConfiguration: {
          Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' }, BucketKeyEnabled: true }],
        },
    }));
    logger.info('✓ Enabled bucket encryption (AES-256)');
    const bucketPolicy = {
      Version: '2012-10-17',
      Statement: [{
          Sid: 'DenyExternalAccess',
          Effect: 'Deny',
          Principal: '*',
          Action: 's3:*',
          Resource: [`arn:aws:s3:::${bucketName}`, `arn:aws:s3:::${bucketName}/*`],
          Condition: { StringNotEquals: { 'aws:PrincipalAccount': accountId } },
      }],
    };
    await s3Client.send(new PutBucketPolicyCommand({
        Bucket: bucketName,
        Policy: JSON.stringify(bucketPolicy),
    }));
    logger.info('✓ Set bucket policy (deny external access)');
    logger.info('\n✓ Bootstrap completed successfully');
  } finally {
    awsClients.destroy();
  }
}

export function createBootstrapCommand(): CliCommand {
  return {
    name: 'bootstrap',
    description: 'Bootstrap cdkd',
    options: [
      { name: 'state-bucket', description: 'State bucket name', type: 'string' },
      { name: 'force', description: 'Force reconfiguration', type: 'boolean', default: false },
      ...commonOptions,
    ],
    action: withErrorHandling(bootstrapCommand),
  };
}
