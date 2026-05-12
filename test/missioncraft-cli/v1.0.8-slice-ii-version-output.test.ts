// v1.0.8 slice (ii) — idea-285 `msn version` extended output (consumes substrate-detect).
//
// Asserts tree-format text output (matches architect spec) + JSON variant. Missing-binary
// display tested via PATH manipulation (forces detectSubstrate to come back null for the
// stripped binary while preserving real-binary detection for the other).

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const CLI_BIN = join(__dirname, '..', '..', 'dist', 'missioncraft-cli', 'bin.js');

// Use absolute path to node so PATH stripping in tests doesn't break the test launcher itself —
// only the child probes (git --version / gh --version) need to fail for missing-binary tests.
const NODE_BIN = process.execPath;

function runCli(args: string[], env: Record<string, string> = {}): { stdout: string; status: number | null } {
  const result = spawnSync(NODE_BIN, [CLI_BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
  return { stdout: result.stdout, status: result.status };
}

describe('v1.0.8 slice (ii) — idea-285 msn version extended output', () => {
  it('msn --version emits tree-format with missioncraft + git + gh version lines', () => {
    const { stdout, status } = runCli(['--version']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^missioncraft \d+\.\d+\.\d+$/m);                // first line
    expect(stdout).toMatch(/├── git\s+\d+\.\d+/);                            // git branch line
    expect(stdout).toMatch(/└── gh\s+\d+\.\d+/);                             // gh terminal line
  });

  it('msn version verb produces identical text output as --version short-circuit', () => {
    const a = runCli(['--version']);
    const b = runCli(['version']);
    expect(a.stdout).toBe(b.stdout);
  });

  it('msn version --output json emits structured JSON with all 3 keys', () => {
    const { stdout, status } = runCli(['version', '--output', 'json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      missioncraft: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      git: expect.any(String),
    });
    // gh may be null on barebones environments; assert key presence either way.
    expect(parsed).toHaveProperty('gh');
  });

  it('msn version --output yaml emits all 3 keys in YAML form', () => {
    const { stdout, status } = runCli(['version', '--output', 'yaml']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^missioncraft: /m);
    expect(stdout).toMatch(/^git: /m);
    expect(stdout).toMatch(/^gh: /m);
  });

  it('missing binary surfaces as NOT FOUND with install-hint when PATH is stripped', () => {
    // Stripping PATH to /nonexistent forces both `git` + `gh` probes to fail; the version
    // probe itself stays clean (detectSubstrate is non-throwing per slice-i contract).
    const { stdout, status } = runCli(['--version'], { PATH: '/nonexistent' });
    expect(status).toBe(0);
    expect(stdout).toMatch(/missioncraft \d+\.\d+\.\d+/);
    expect(stdout).toMatch(/git\s+NOT FOUND \(install:/);
    expect(stdout).toMatch(/gh\s+NOT FOUND \(install:/);
  });
});
