#!/usr/bin/env node
'use strict';

// A1-Suite-Local-ANT dmux helper CLI.
//
// Reads a plan.json (the schema written for sub-plans 7-10), builds an
// orchestration plan via the project-local lib fork, and provides four
// operations:
//
//   --dry-run     Print the plan without side effects (default if no flag).
//   --execute     Materialize the plan: write task.md/handoff.md/status.md,
//                 create git worktrees, start a tmux session, launch each
//                 worker in its own pane.
//   --status      Read each worker's status.md and print it.
//   --teardown    Kill the tmux session, remove worktrees, delete branches.
//   --merge       After workers complete, merge each branch in mergeOrder
//                 to ant/main with --no-ff, then push ant + tag.
//
// Usage:
//   scripts/orchestrate-worktrees.js .orchestration/<session>/plan.json --dry-run
//   scripts/orchestrate-worktrees.js .orchestration/<session>/plan.json --execute
//   scripts/orchestrate-worktrees.js .orchestration/<session>/plan.json --status
//   scripts/orchestrate-worktrees.js .orchestration/<session>/plan.json --teardown
//   scripts/orchestrate-worktrees.js .orchestration/<session>/plan.json --merge

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  buildOrchestrationPlan,
  executePlan
} = require('./lib/tmux-worktree-orchestrator');

function usage() {
  process.stderr.write(`Usage: scripts/orchestrate-worktrees.js <plan.json> [--dry-run|--execute|--status|--teardown|--merge] [--repo-root <path>]

Options:
  --dry-run     Print the plan without side effects (default if no flag).
  --execute     Materialize plan + start tmux + launch workers.
  --status      Read each worker's status.md and print it.
  --teardown    Kill tmux session, remove worktrees, delete branches.
  --merge       Merge branches in mergeOrder to ant/main + push ant + tag.
  --repo-root   Override repo root (default: process.cwd()).
  -h, --help    Print this help.
`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let planPath = null;
  let repoRoot = null;
  const flags = new Set();

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      usage();
    } else if (a === '--dry-run' || a === '--execute' || a === '--status' || a === '--teardown' || a === '--merge') {
      flags.add(a.slice(2));
    } else if (a === '--repo-root') {
      repoRoot = args[++i];
    } else if (a.startsWith('--repo-root=')) {
      repoRoot = a.slice('--repo-root='.length);
    } else if (a.startsWith('--')) {
      process.stderr.write(`Unknown flag: ${a}\n`);
      usage();
    } else if (!planPath) {
      planPath = a;
    } else {
      process.stderr.write(`Unexpected positional arg: ${a}\n`);
      usage();
    }
  }
  return { planPath, flags, repoRoot };
}

function loadPlan(planPath) {
  const absolutePath = path.resolve(planPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Plan file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Plan file is not valid JSON: ${absolutePath}\n${error.message}`);
  }
  return { absolutePath, plan: parsed };
}

function buildFromJson({ plan, repoRoot }) {
  const config = {
    repoRoot: repoRoot || process.cwd(),
    sessionName: plan.sessionName,
    baseRef: plan.baseRef,
    workers: plan.workers,
    seedPaths: plan.seedPaths,
    launcherCommand: plan.launcherCommand,
    branchPrefix: plan.branchPrefix,
    worktreeRoot: plan.worktreeRoot,
    coordinationRoot: plan.coordinationRoot,
    replaceExisting: Boolean(plan.replaceExisting),
    mergeOrder: plan.mergeOrder
  };
  return buildOrchestrationPlan(config);
}

function shellQuoteForDisplay(value) {
  if (typeof value !== 'string' || value.length === 0) return JSON.stringify(value);
  if (/[^A-Za-z0-9_\-\=\/\.]/.test(value)) return JSON.stringify(value);
  return value;
}

function printDryRun(orchestration) {
  process.stdout.write('=== Orchestration Plan (dry-run) ===\n');
  process.stdout.write(`Session:          ${orchestration.sessionName}\n`);
  process.stdout.write(`Base ref:         ${orchestration.baseRef}\n`);
  process.stdout.write(`Branch prefix:    ${orchestration.branchPrefix}\n`);
  process.stdout.write(`Repo root:        ${orchestration.repoRoot}\n`);
  process.stdout.write(`Coordination dir: ${orchestration.coordinationDir}\n`);
  if (orchestration.mergeOrder.length > 0) {
    process.stdout.write(`Merge order:      ${orchestration.mergeOrder.join(' → ')}\n`);
  }
  process.stdout.write('\n');

  for (const w of orchestration.workerPlans) {
    process.stdout.write(`--- Worker: ${w.workerName} (slug: ${w.workerSlug}) ---\n`);
    process.stdout.write(`  Branch:        ${w.branchName}\n`);
    process.stdout.write(`  Worktree:      ${w.worktreePath}\n`);
    process.stdout.write(`  Plan file:     ${w.planFile || '(none)'}\n`);
    process.stdout.write(`  Tag to ship:   ${w.tagName || '(none)'}\n`);
    process.stdout.write(`  Task:          ${w.taskFilePath}\n`);
    process.stdout.write(`  Status:        ${w.statusFilePath}\n`);
    process.stdout.write(`  Handoff:       ${w.handoffFilePath}\n`);
    process.stdout.write(`  Seed paths:    ${w.seedPaths.length > 0 ? w.seedPaths.join(', ') : '(none)'}\n`);
    process.stdout.write(`  Launch cmd:    ${w.launchCommand}\n`);
    process.stdout.write(`  Git worktree:  ${w.gitCommand}\n`);
    process.stdout.write('\n');
  }

  process.stdout.write('=== TMUX commands to be executed ===\n');
  for (const t of orchestration.tmuxCommands) {
    const rendered = t.args.map(shellQuoteForDisplay).join(' ');
    process.stdout.write(`  ${t.cmd} ${rendered}    # ${t.description}\n`);
  }
}

function printStatus(orchestration) {
  for (const w of orchestration.workerPlans) {
    process.stdout.write(`=== ${w.workerName} (${w.workerSlug}) ===\n`);
    if (fs.existsSync(w.statusFilePath)) {
      process.stdout.write(fs.readFileSync(w.statusFilePath, 'utf8'));
    } else {
      process.stdout.write('(status.md not yet written — worker has not started)\n');
    }
    process.stdout.write('\n');
  }
}

function teardown(orchestration) {
  const repoRoot = orchestration.repoRoot;

  // Kill tmux session if present
  const hasSession = spawnSync('tmux', ['has-session', '-t', orchestration.sessionName], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  });
  if (hasSession.status === 0) {
    spawnSync('tmux', ['kill-session', '-t', orchestration.sessionName], { cwd: repoRoot });
    process.stdout.write(`Killed tmux session: ${orchestration.sessionName}\n`);
  } else {
    process.stdout.write(`No tmux session to kill: ${orchestration.sessionName}\n`);
  }

  // Remove worktrees + branches
  for (const w of orchestration.workerPlans) {
    spawnSync('git', ['worktree', 'remove', '--force', w.worktreePath], { cwd: repoRoot });
    spawnSync('git', ['branch', '-D', w.branchName], { cwd: repoRoot });
    process.stdout.write(`Removed worktree + branch: ${w.branchName}\n`);
  }
  spawnSync('git', ['worktree', 'prune', '--expire', 'now'], { cwd: repoRoot });
  process.stdout.write(`Teardown complete (${orchestration.workerPlans.length} workers).\n`);
}

function mergePlan(orchestration, plan) {
  const repoRoot = orchestration.repoRoot;
  const mergeOrder = Array.isArray(plan.mergeOrder) && plan.mergeOrder.length > 0
    ? plan.mergeOrder
    : orchestration.workerPlans.map(w => w.workerSlug);
  const mergeTarget = resolveMergeTarget(plan.baseRef);

  // Resolve slugs to worker plans
  const bySlug = new Map(orchestration.workerPlans.map(w => [w.workerSlug, w]));
  const ordered = [];
  for (const slug of mergeOrder) {
    const w = bySlug.get(slug);
    if (!w) {
      process.stderr.write(`Unknown worker slug in mergeOrder: ${slug} — skipping.\n`);
      continue;
    }
    ordered.push(w);
  }

  for (let i = 0; i < ordered.length; i++) {
    const w = ordered[i];
    process.stdout.write(`\n=== [${i + 1}/${ordered.length}] Merging ${w.branchName} → ${mergeTarget.remoteHead} ===\n`);

    // Ensure every merge starts from the current explicit remote-tracking ref.
    const fetch = spawnSync('git', ['fetch', 'ant', mergeTarget.fetchRefspec], { cwd: repoRoot, encoding: 'utf8' });
    if (fetch.status !== 0) {
      process.stderr.write(`git fetch ant ${mergeTarget.fetchRefspec} failed:\n${fetch.stderr}\n`);
      process.exit(1);
    }
    process.stdout.write(`Fetched ${mergeTarget.remoteHead} into ${mergeTarget.trackingRef}.\n`);

    if (isAncestor(repoRoot, w.branchName, mergeTarget.trackingRef)) {
      process.stdout.write(`  ✓ ${w.branchName} is already present in ${mergeTarget.remoteHead}\n`);
      pushWorkerTag(repoRoot, w);
      continue;
    }

    const localMergeRef = `refs/heads/${mergeTarget.localBranch}`;
    const hasLocalMergeBranch = refExists(repoRoot, localMergeRef);
    const hasResolvedLocalMerge = hasLocalMergeBranch
      && isAncestor(repoRoot, w.branchName, mergeTarget.localBranch);
    const canResume = hasResolvedLocalMerge
      && isAncestor(repoRoot, mergeTarget.trackingRef, mergeTarget.localBranch);

    if (hasResolvedLocalMerge && !canResume) {
      process.stderr.write(
        `Local ${mergeTarget.localBranch} already contains ${w.branchName}, ` +
        `but ${mergeTarget.trackingRef} has advanced.\n`
      );
      process.stderr.write('Refusing to reset away the resolved merge. To continue safely:\n');
      process.stderr.write(`  1. git checkout ${mergeTarget.localBranch}\n`);
      process.stderr.write(`  2. git merge --no-ff ${mergeTarget.trackingRef} -m "merge: refresh ${mergeTarget.remoteHead}"\n`);
      process.stderr.write('  3. Resolve conflicts if needed, run verification, then rerun --merge.\n');
      process.exit(2);
    }

    if (canResume) {
      const co = spawnSync('git', ['checkout', mergeTarget.localBranch], { cwd: repoRoot, encoding: 'utf8' });
      if (co.status !== 0) {
        process.stderr.write(`git checkout ${mergeTarget.localBranch} failed:\n${co.stderr}\n`);
        process.exit(1);
      }
      process.stdout.write(`  ✓ resuming resolved merge from ${mergeTarget.localBranch}\n`);
    } else {
      const co = spawnSync('git', ['checkout', '-B', mergeTarget.localBranch, mergeTarget.trackingRef], { cwd: repoRoot, encoding: 'utf8' });
      if (co.status !== 0) {
        process.stderr.write(`git checkout -B ${mergeTarget.localBranch} ${mergeTarget.trackingRef} failed:\n${co.stderr}\n`);
        process.exit(1);
      }

      const mergeMsg = `merge: ${w.branchName} (${w.workerName})`;
      const merge = spawnSync(
        'git',
        ['merge', '--no-ff', w.branchName, '-m', mergeMsg],
        { cwd: repoRoot, encoding: 'utf8' }
      );
      if (merge.status !== 0) {
        process.stderr.write(`\nMERGE CONFLICT on ${w.branchName}.\n\n`);
        process.stderr.write('To resolve:\n');
        process.stderr.write('  1. Open the conflicted file(s) — likely server/app.js (route block collision) or server/db.js (table collision).\n');
        process.stderr.write('  2. For each conflict: keep the route block / table from the branch being merged; drop the placeholder stub.\n');
        process.stderr.write('  3. `npm test` to confirm everything still passes.\n');
        process.stderr.write('  4. `git add . && git commit --no-edit` to complete the merge commit on the current merge branch.\n');
        process.stderr.write('  5. Re-run: scripts/orchestrate-worktrees.js plan.json --merge\n');
        process.stderr.write('     (the --merge command will push the resolved merge branch, then continue).\n');
        process.exit(2);
      }
      process.stdout.write(`  ✓ merge commit created\n`);
    }

    // Push
    const push = spawnSync('git', ['push', 'ant', `HEAD:${mergeTarget.remoteHead}`], { cwd: repoRoot, encoding: 'utf8' });
    if (push.status !== 0) {
      process.stderr.write(`git push ant HEAD:${mergeTarget.remoteHead} failed:\n${push.stderr}\n`);
      process.exit(1);
    }
    process.stdout.write(`  ✓ pushed to ${mergeTarget.remoteHead}\n`);

    pushWorkerTag(repoRoot, w);
  }

  process.stdout.write(`\nAll ${ordered.length} merges complete. ${mergeTarget.remoteHead} is up to date.\n`);
}

function pushWorkerTag(repoRoot, workerPlan) {
  if (!workerPlan.tagName) return;

  const pushTag = spawnSync('git', ['push', 'ant', workerPlan.tagName], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (pushTag.status !== 0) {
    process.stderr.write(`git push ant ${workerPlan.tagName} failed:\n${pushTag.stderr}\n`);
    process.exit(1);
  }
  process.stdout.write(`  ✓ pushed tag ${workerPlan.tagName}\n`);
}

function resolveMergeTarget(baseRef = '') {
  if (baseRef === 'refs/remotes/ant/ant/main') {
    return {
      remoteHead: 'refs/heads/ant/main',
      trackingRef: 'refs/remotes/ant/ant/main',
      fetchRefspec: 'refs/heads/ant/main:refs/remotes/ant/ant/main',
      localBranch: '__orchestration_merge_ant_main'
    };
  }

  if (baseRef === 'refs/remotes/ant/main') {
    return {
      remoteHead: 'refs/heads/main',
      trackingRef: 'refs/remotes/ant/main',
      fetchRefspec: 'refs/heads/main:refs/remotes/ant/main',
      localBranch: '__orchestration_merge_main'
    };
  }

  throw new Error(
    `Ambiguous merge baseRef ${JSON.stringify(baseRef)}. ` +
    'Use refs/remotes/ant/ant/main for the preferred topology or refs/remotes/ant/main for fallback.'
  );
}

function refExists(repoRoot, ref) {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd: repoRoot });
  return result.status === 0;
}

function isAncestor(repoRoot, ancestor, descendant) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: repoRoot,
    stdio: 'ignore'
  });
  return result.status === 0;
}

function main() {
  const { planPath, flags, repoRoot } = parseArgs(process.argv);
  if (!planPath) usage();
  const { plan } = loadPlan(planPath);
  const orchestration = buildFromJson({ plan, repoRoot });

  if (flags.has('status')) return printStatus(orchestration);
  if (flags.has('teardown')) return teardown(orchestration);
  if (flags.has('merge')) return mergePlan(orchestration, plan);

  if (flags.has('execute')) {
    const result = executePlan(orchestration);
    process.stdout.write(`\nSession:     ${result.sessionName}\n`);
    process.stdout.write(`Workers:     ${result.workerCount}\n`);
    process.stdout.write(`Coord dir:   ${result.coordinationDir}\n`);
    process.stdout.write(`\nAttach with: tmux attach -t ${result.sessionName}\n`);
    process.stdout.write(`Status:      scripts/orchestrate-worktrees.js ${planPath} --status\n`);
    process.stdout.write(`Teardown:    scripts/orchestrate-worktrees.js ${planPath} --teardown\n`);
    process.stdout.write(`Merge:       scripts/orchestrate-worktrees.js ${planPath} --merge  (after all workers ship)\n`);
    return;
  }

  // Default: dry-run
  printDryRun(orchestration);
}

try {
  main();
} catch (error) {
  process.stderr.write(`\nERROR: ${error.message}\n`);
  if (process.env.DEBUG) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exit(1);
}
