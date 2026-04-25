import { CliParser } from './cli-parser.js';
import { createBootstrapCommand } from './commands/bootstrap.js';
import { createSynthCommand } from './commands/synth.js';
import { createDeployCommand } from './commands/deploy.js';
import { createDiffCommand } from './commands/diff.js';
import { createDestroyCommand } from './commands/destroy.js';
import { createPublishAssetsCommand } from './commands/publish-assets.js';
import { createForceUnlockCommand } from './commands/force-unlock.js';

async function main(): Promise<void> {
  const parser = new CliParser('cdkd', 'CDK Direct');
  parser.addCommand(createBootstrapCommand());
  parser.addCommand(createSynthCommand());
  parser.addCommand(createDeployCommand());
  parser.addCommand(createDiffCommand());
  parser.addCommand(createDestroyCommand());
  parser.addCommand(createPublishAssetsCommand());
  parser.addCommand(createForceUnlockCommand());
  await parser.parse(process.argv);
}
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
