// filename: vercel-delete-deployments-before-latest-commit.js
// Purpose: Delete Vercel deployments created before the latest commit on a GitHub repo.
// Usage:
//   1) Set env:
//        VERCEL_TOKEN=...          // Personal token (do NOT hardcode)
//        VERCEL_TEAM_ID=...        // optional (for org/team scope)
//        GITHUB_TOKEN=...          // optional if the repo is private or you hit rate limits
//   2) Run:
//        node vercel-delete-deployments-before-latest-commit.js --repo jaspermayone/website
//        node vercel-delete-deployments-before-latest-commit.js --repo jaspermayone/website --dry
//
// Safety:
// - Dry-run by default if you add --dry.
// - Keeps newest deployment per project.
// - Skips deployments with active aliases to avoid breaking prod.
//
// Notes:
// - GitHub commit timestamp is used as cutoff (author/committer date from the latest commit on default branch).
// - If you want an explicit date, pass --before 2025-12-11T23:59:59Z.

import https from 'https';
import { URL } from 'url';

function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const vercelToken = process.env.VERCEL_TOKEN || process.env.VERSEL_TOKEN;
if (!vercelToken) {
  console.error('ERROR: Set VERCEL_TOKEN in your environment.');
  process.exit(1);
}
const teamId = process.env.VERCEL_TEAM_ID || process.env.VERSEL_TEAM_ID || null;
const githubToken = process.env.GITHUB_TOKEN || null;

const repo = getArg('--repo', null); // e.g., "jaspermayone/website"
const dryRun = process.argv.includes('--dry');
const explicitBefore = getArg('--before', null);

if (!repo) {
  console.error('ERROR: Pass --repo owner/repo (e.g., --repo jaspermayone/website)');
  process.exit(1);
}

function httpsJson(urlObj, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(urlObj, { method, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(body.length ? JSON.parse(body) : {});
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}\nBody: ${body}`));
          }
        } else {
          reject(new Error(`HTTP ${method} ${urlObj.href} failed: ${res.statusCode} ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getLatestCommitDateISO(repoFullName) {
  // GET https://api.github.com/repos/{owner}/{repo}/commits?per_page=1
  const url = new URL(`https://api.github.com/repos/${repoFullName}/commits?per_page=1`);
  const headers = {
    'User-Agent': 'cleanup-script/1.0',
    'Accept': 'application/vnd.github+json'
  };
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

  const res = await httpsJson(url, 'GET', headers);
  if (!Array.isArray(res) || res.length === 0) {
    throw new Error('No commits found for repo. Ensure it is public or provide GITHUB_TOKEN.');
  }
  const latest = res[0];
  const date = latest.commit?.committer?.date || latest.commit?.author?.date;
  if (!date) throw new Error('Could not resolve latest commit date.');
  return date; // ISO string
}

async function listProjects() {
  const url = new URL(`https://api.vercel.com/v9/projects${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`);
  const headers = {
    Authorization: `Bearer ${vercelToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'cleanup-script/1.0'
  };
  const res = await httpsJson(url, 'GET', headers);
  return res.projects || [];
}

async function listDeployments(projectId) {
  const deployments = [];
  let until = undefined;
  while (true) {
    const params = new URLSearchParams();
    params.set('projectId', projectId);
    params.set('limit', '100');
    if (teamId) params.set('teamId', teamId);
    if (until) params.set('until', String(until));
    const url = new URL(`https://api.vercel.com/v6/deployments?${params.toString()}`);
    const headers = {
      Authorization: `Bearer ${vercelToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'cleanup-script/1.0'
    };
    const res = await httpsJson(url, 'GET', headers);
    const page = res.deployments || [];
    if (page.length === 0) break;
    deployments.push(...page);
    const last = page[page.length - 1];
    until = last.created;
    if (page.length < 100) break;
  }
  return deployments;
}

async function deleteDeployment(deploymentId) {
  const url = new URL(`https://api.vercel.com/v13/deployments/${deploymentId}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`);
  const headers = {
    Authorization: `Bearer ${vercelToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'cleanup-script/1.0'
  };
  await httpsJson(url, 'DELETE', headers);
}

function iso(ts) {
  try { return new Date(ts).toISOString(); } catch { return String(ts); }
}

(async function main() {
  const cutoffISO = explicitBefore || await getLatestCommitDateISO(repo);
  const cutoffMs = new Date(cutoffISO).getTime();
  if (Number.isNaN(cutoffMs)) {
    console.error(`Invalid cutoff date: ${cutoffISO}`);
    process.exit(1);
  }

  console.log(`Repo: ${repo}`);
  console.log(`Cutoff (latest commit): ${cutoffISO}`);
  console.log(dryRun ? 'Mode: DRY RUN' : 'Mode: LIVE');
  console.log('');

  const projects = await listProjects();

  // If you want to limit to projects whose name matches repo, uncomment:
  // const targetProjects = projects.filter(p => p.name === repo.split('/')[1]);
  // Otherwise, apply across all projects:
  const targetProjects = projects;

  let candidates = 0;
  let deleted = 0;

  for (const p of targetProjects) {
    console.log(`Project: ${p.name} (${p.id})`);
    const deployments = await listDeployments(p.id);
    if (deployments.length === 0) {
      console.log('  No deployments');
      continue;
    }
    const sorted = deployments.sort((a, b) => b.created - a.created);
    const keepNewestIds = new Set(sorted.slice(0, 1).map(d => d.uid)); // keep newest
    const older = sorted.filter(d => d.created < cutoffMs && !keepNewestIds.has(d.uid));

    // Skip aliased deployments to avoid breaking live domains.
    const aliased = older.filter(d => Array.isArray(d.aliases) && d.aliases.length > 0);
    const toDelete = older.filter(d => !aliased.includes(d));

    console.log(`  Total: ${deployments.length}`);
    console.log(`  Older than cutoff: ${older.length}`);
    if (aliased.length > 0) {
      console.log(`  Skipping aliased (un-alias first if desired): ${aliased.length}`);
    }

    for (const d of toDelete) {
      candidates += 1;
      const info = `    - ${d.uid} | created=${iso(d.created)} | url=${d.url} | state=${d.state || 'unknown'}`;
      if (dryRun) {
        console.log(info + ' [DRY]');
      } else {
        try {
          await deleteDeployment(d.uid);
          console.log(info + ' [DELETED]');
          deleted += 1;
        } catch (e) {
          console.error(`    ERROR deleting ${d.uid}: ${e.message}`);
        }
      }
    }
    console.log('');
  }

  console.log(`Done. Candidates: ${candidates}. Deleted: ${deleted}.`);
})();
