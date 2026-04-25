export interface CliOption {
  name: string;
  short?: string;
  description: string;
  type: 'string' | 'boolean' | 'number' | 'array';
  default?: any;
}
export interface CliCommand {
  name: string;
  description: string;
  options: CliOption[];
  argumentDescription?: string;
  action: (args: string[], options: any) => Promise<void>;
}
export class CliParser {
  private commands = new Map<string, CliCommand>();
  private version: string = '0.1.0';
  private name: string;
  private description: string;
  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }
  addCommand(command: CliCommand) {
    this.commands.set(command.name, command);
  }
  setVersion(version: string) {
    this.version = version;
  }
  async parse(argv: string[]) {
    const userArgs = argv.slice(2);
    if (userArgs.length === 0 || userArgs[0] === '--help' || userArgs[0] === '-h') {
      this.showHelp();
      return;
    }
    const commandName = userArgs[0];
    const command = this.commands.get(commandName!);
    if (!command) {
      console.error(`Unknown command: ${commandName}`);
      this.showHelp();
      process.exit(1);
    }
    const { positional, options } = this.parseArgs(userArgs.slice(1), command.options);
    await command.action(positional, options);
  }
  private parseArgs(args: string[], optionsDef: CliOption[]) {
    const positional: string[] = [];
    const options: any = {};
    for (const opt of optionsDef) options[opt.name] = opt.default;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg.startsWith('-')) {
        const key = arg.replace(/^-+/, '');
        const optDef = optionsDef.find(o => o.name === key || o.short === key);
        if (optDef) {
          if (optDef.type === 'boolean') options[optDef.name] = true;
          else options[optDef.name] = args[++i];
        }
      } else positional.push(arg);
    }
    return { positional, options };
  }
  private showHelp() {
    console.log(`${this.name} - ${this.description}\n`);
    console.log('Usage: cdkd <command> [options]\n\nCommands:');
    for (const cmd of Array.from(this.commands.values())) {
      console.log(`  ${cmd.name.padEnd(15)} ${cmd.description}`);
    }
  }
}
