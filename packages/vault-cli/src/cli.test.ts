import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

// Import the command factories directly to test they register correctly
import { validateCommand } from './commands/validate.js';
import { buildCommand } from './commands/build.js';
import { composeCommand } from './commands/compose.js';
import { indexCommand } from './commands/index-cmd.js';
import { integrateCommand } from './commands/integrate.js';

function makeProgram(): Command {
  const program = new Command();
  program
    .name('pack-builder')
    .description('Map Assets build pipeline CLI')
    .version('0.1.0')
    .exitOverride();

  program.addCommand(validateCommand());
  program.addCommand(buildCommand());
  program.addCommand(composeCommand());
  program.addCommand(indexCommand());
  program.addCommand(integrateCommand());

  return program;
}

describe('CLI', () => {
  it('has pack-builder name', () => {
    const program = makeProgram();
    expect(program.name()).toBe('pack-builder');
  });

  it('has version 0.1.0', () => {
    const program = makeProgram();
    expect(program.version()).toBe('0.1.0');
  });

  it('registers validate command', () => {
    const program = makeProgram();
    const cmd = program.commands.find((c) => c.name() === 'validate');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain('Validate');
  });

  it('registers build command', () => {
    const program = makeProgram();
    const cmd = program.commands.find((c) => c.name() === 'build');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain('Build');
  });

  it('registers compose command', () => {
    const program = makeProgram();
    const cmd = program.commands.find((c) => c.name() === 'compose');
    expect(cmd).toBeDefined();
  });

  it('registers index command', () => {
    const program = makeProgram();
    const cmd = program.commands.find((c) => c.name() === 'index');
    expect(cmd).toBeDefined();
  });

  it('registers integrate command', () => {
    const program = makeProgram();
    const cmd = program.commands.find((c) => c.name() === 'integrate');
    expect(cmd).toBeDefined();
  });

  it('integrate uses --pack-version, not --version, so it never resolves to the root flag', () => {
    const program = makeProgram();
    const cmd = program.commands.find((c) => c.name() === 'integrate')!;
    const versionOpt = cmd.options.find((o) => o.long === '--pack-version');
    expect(versionOpt).toBeDefined();
    expect(versionOpt!.short).toBeUndefined();
    expect(cmd.options.some((o) => o.long === '--version')).toBe(false);
    expect(cmd.options.some((o) => o.short === '-v' || o.short === '-V')).toBe(false);
  });
});
