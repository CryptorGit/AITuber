import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ReplayMeta = {
  created_at: string;
  node_version: string;
  platform: string;
  arch: string;
  orchestrator_commit: string;
  showdown_commit: string;
  showdown_path: string;
  config: {
    format: string;
    obs_mode: 'features' | 'full';
    save_compress: 0 | 1;
    save_sample_rate: number;
    p1_policy: string;
    p2_policy: string;
  };
};

function repoRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return join(here, '../../../../..');
}

function tryGit(args: string[], cwd?: string): string {
  try {
    const out = execSync(['git', ...args].join(' '), {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const s = String(out).trim();
    return s || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function collectReplayMeta(cfg: {
  format: string;
  obs_mode: 'features' | 'full';
  save_compress: boolean;
  save_sample_rate: number;
  p1_policy: string;
  p2_policy: string;
}): ReplayMeta {
  if (process.env.VGC_META_FORCE_UNKNOWN === '1') {
    return {
      created_at: new Date().toISOString(),
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      orchestrator_commit: 'unknown',
      showdown_commit: 'unknown',
      showdown_path: 'tools/pokemon-showdown',
      config: {
        format: cfg.format,
        obs_mode: cfg.obs_mode,
        save_compress: cfg.save_compress ? 1 : 0,
        save_sample_rate: cfg.save_sample_rate,
        p1_policy: cfg.p1_policy,
        p2_policy: cfg.p2_policy,
      },
    };
  }

  const root = repoRoot();
  const orchestratorCommit = tryGit(['rev-parse', 'HEAD'], root);
  const showdownPath = 'tools/pokemon-showdown';
  const showdownCommit = tryGit(['-C', showdownPath, 'rev-parse', 'HEAD'], root);

  return {
    created_at: new Date().toISOString(),
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    orchestrator_commit: orchestratorCommit,
    showdown_commit: showdownCommit,
    showdown_path: showdownPath,
    config: {
      format: cfg.format,
      obs_mode: cfg.obs_mode,
      save_compress: cfg.save_compress ? 1 : 0,
      save_sample_rate: cfg.save_sample_rate,
      p1_policy: cfg.p1_policy,
      p2_policy: cfg.p2_policy,
    },
  };
}

export function compareReplayMeta(recordMeta: any): string[] {
  const warnings: string[] = [];
  if (!recordMeta || typeof recordMeta !== 'object') {
    warnings.push('meta_missing: replay record has no meta; exact reproducibility assumptions cannot be verified');
    return warnings;
  }

  const current = collectReplayMeta({
    format: String(recordMeta?.config?.format ?? ''),
    obs_mode: recordMeta?.config?.obs_mode === 'full' ? 'full' : 'features',
    save_compress: Boolean(recordMeta?.config?.save_compress),
    save_sample_rate: Number(recordMeta?.config?.save_sample_rate ?? 1),
    p1_policy: String(recordMeta?.config?.p1_policy ?? ''),
    p2_policy: String(recordMeta?.config?.p2_policy ?? ''),
  });

  const check = (key: string, rec: string, cur: string) => {
    if (rec === 'unknown' || cur === 'unknown') {
      warnings.push(`meta_unknown:${key} record=${rec} current=${cur}`);
      return;
    }
    if (rec !== cur) warnings.push(`meta_mismatch:${key} record=${rec} current=${cur}`);
  };

  check('node_version', String(recordMeta.node_version ?? 'unknown'), current.node_version);
  check('platform', String(recordMeta.platform ?? 'unknown'), current.platform);
  check('arch', String(recordMeta.arch ?? 'unknown'), current.arch);
  check('orchestrator_commit', String(recordMeta.orchestrator_commit ?? 'unknown'), current.orchestrator_commit);
  check('showdown_commit', String(recordMeta.showdown_commit ?? 'unknown'), current.showdown_commit);

  return warnings;
}
