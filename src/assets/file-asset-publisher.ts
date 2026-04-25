import { createReadStream, statSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { FileAsset } from '../types/assets.js';
import { getLogger } from '../utils/logger.js';
export class FileAssetPublisher {
  private logger = getLogger().child('FileAssetPublisher');
  async publish(assetHash: string, asset: FileAsset, cdkOutputDir: string, accountId: string, region: string): Promise<void> {
    for (const [, dest] of Object.entries(asset.destinations)) {
      const bucketName = this.resolvePlaceholders(dest.bucketName, accountId, region);
      const objectKey = this.resolvePlaceholders(dest.objectKey, accountId, region);
      const destRegion = dest.region ? this.resolvePlaceholders(dest.region, accountId, region) : region;
      const client = new S3Client({ region: destRegion });
      try {
        if (await this.objectExists(client, bucketName, objectKey)) continue;
        const sourcePath = join(cdkOutputDir, asset.source.path);
        if (asset.source.packaging === 'zip') await this.uploadZip(client, sourcePath, bucketName, objectKey);
        else await this.uploadFile(client, sourcePath, bucketName, objectKey);
      } finally { client.destroy(); }
    }
  }
  private async objectExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
    try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true; }
    catch { return false; }
  }
  private async uploadFile(client: S3Client, filePath: string, bucket: string, key: string): Promise<void> {
    const stat = statSync(filePath);
    const stream = createReadStream(filePath);
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: stream, ContentLength: stat.size }));
  }
  private async uploadZip(client: S3Client, dirPath: string, bucket: string, key: string): Promise<void> {
    const tempZip = join(tmpdir(), `cdkd-asset-${randomBytes(8).toString('hex')}.zip`);
    try {
      const stat = statSync(dirPath);
      if (stat.isDirectory()) execSync(`zip -r9 "${tempZip}" .`, { cwd: dirPath, stdio: 'ignore' });
      else execSync(`zip -9 "${tempZip}" "${basename(dirPath)}"`, { cwd: join(dirPath, '..'), stdio: 'ignore' });
      const zipData = readFileSync(tempZip);
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: zipData, ContentLength: zipData.length }));
    } finally { try { execSync(`rm -f "${tempZip}"`); } catch {} }
  }
  private resolvePlaceholders(value: string, accountId: string, region: string): string {
    return value.replace(/\$\{AWS::AccountId\}/g, accountId).replace(/\$\{AWS::Region\}/g, region);
  }
}
