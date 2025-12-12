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

const repo = getArg('--repo', 'jaspermayone/website'); // default to your current repo
const projectArg = getArg('--project', null); // REQUIRED: Vercel project name or ID
const dryRun = process.argv.includes('--dry');
const explicitBefore = getArg('--before', null);
const includeAliased = process.argv.includes('--include-aliased');

if (!projectArg) {
  console.error('ERROR: Pass --project <vercel-project-name-or-id> (e.g., --project website or --project prj_...)');
  process.exit(1);
}

// Backoff-aware HTTPS JSON request
async function httpsJsonWithBackoff(urlObj, method = 'GET', headers = {}, reqBody = null, maxRetries = 8) {
  let attempt = 0;
  let baseDelayMs = 1500; // start at 1.5s
  while (true) {
    const response = await new Promise((resolve) => {
      const req = https.request(urlObj, { method, headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, headers: res.headers, body: data });
        });
      });
      req.on('error', (err) => resolve({ status: 0, headers: {}, body: JSON.stringify({ error: { message: err.message } }) }));
      if (reqBody) req.write(reqBody);
      req.end();
    });

    const { status, headers: respHeaders, body: respBody } = response;
    if (status >= 200 && status < 300) {
      try {
        return respBody.length ? JSON.parse(respBody) : {};
      } catch (e) {
        throw new Error(`JSON parse error: ${e.message}\nBody: ${respBody}`);
      }
    }

    // Handle 429 with backoff
    let parsed;
    try { parsed = respBody ? JSON.parse(respBody) : null; } catch { parsed = null; }
    const isRateLimited = status === 429 || (parsed && parsed.error && parsed.error.code === 'rate_limited');
    if (isRateLimited && attempt < maxRetries) {
      // Prefer reset from payload; else Retry-After header; else exponential backoff
      let waitMs = 0;
      const retryAfter = respHeaders['retry-after'];
      if (retryAfter) {
        const raNum = Number(retryAfter);
        waitMs = Number.isFinite(raNum) ? raNum * 1000 : baseDelayMs;
      } else if (parsed?.error?.limit?.reset) {
        // reset is a unix epoch seconds; wait until then plus small jitter
        const nowSec = Math.floor(Date.now() / 1000);
        const deltaSec = Math.max(0, parsed.error.limit.reset - nowSec);
        waitMs = (deltaSec * 1000) + Math.floor(Math.random() * 500);
      } else {
        waitMs = baseDelayMs + Math.floor(Math.random() * 400); // add jitter
        baseDelayMs = Math.min(baseDelayMs * 2, 30000); // cap at 30s
      }
      const remaining = parsed?.error?.limit?.remaining;
      const total = parsed?.error?.limit?.total;
      console.warn(`Rate limited (status 429). Attempt ${attempt + 1}/${maxRetries}. Waiting ~${Math.round(waitMs / 1000)}s (remaining=${remaining}/${total}).`);
      await new Promise((r) => setTimeout(r, waitMs));
      attempt += 1;
      continue;
    }

    // Other errors → throw
    throw new Error(`HTTP ${method} ${urlObj.href} failed: ${status} ${respBody}`);
  }
}

async function getLatestCommitDateISO(repoFullName) {
  const url = new URL(`https://api.github.com/repos/${repoFullName}/commits?per_page=1`);
  const headers = {
    'User-Agent': 'cleanup-script/1.0',
    'Accept': 'application/vnd.github+json'
  };
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;
  const res = await httpsJsonWithBackoff(url, 'GET', headers);
  if (!Array.isArray(res) || res.length === 0) throw new Error('No commits found for repo.');
  const latest = res[0];
  return latest.commit?.committer?.date || latest.commit?.author?.date;
}

async function listProjects() {
  const url = new URL(`https://api.vercel.com/v9/projects${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`);
  const headers = {
    Authorization: `Bearer ${vercelToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'cleanup-script/1.1'
  };
  const res = await httpsJsonWithBackoff(url, 'GET', headers);
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
      'User-Agent': 'cleanup-script/1.1'
    };
    const res = await httpsJsonWithBackoff(url, 'GET', headers);
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
    'User-Agent': 'cleanup-script/1.1'
  };
  await httpsJsonWithBackoff(url, 'DELETE', headers);
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
  console.log(`Target Vercel project: ${projectArg}`);
  console.log(dryRun ? 'Mode: DRY RUN' : 'Mode: LIVE');
  console.log(includeAliased ? 'Aliased deployments: WILL DELETE' : 'Aliased deployments: SKIP');
  console.log('');

  const projects = await listProjects();
  const target = projects.find(p => p.id === projectArg || p.name === projectArg);
  if (!target) {
    console.error('ERROR: Vercel project not found. Verify name or ID.');
    process.exit(1);
  }

  console.log(`Project: ${target.name} (${target.id})`);
  const deployments = await listDeployments(target.id);
  if (deployments.length === 0) {
    console.log('  No deployments');
    process.exit(0);
  }

  const sorted = deployments.sort((a, b) => b.created - a.created);
  const keepNewestIds = new Set(sorted.slice(0, 1).map(d => d.uid)); // keep newest
  const older = sorted.filter(d => d.created < cutoffMs && !keepNewestIds.has(d.uid));

  let toDelete = older;
  if (!includeAliased) {
    const aliased = older.filter(d => Array.isArray(d.aliases) && d.aliases.length > 0);
    if (aliased.length > 0) console.log(`  Skipping aliased: ${aliased.length}`);
    toDelete = older.filter(d => !(Array.isArray(d.aliases) && d.aliases.length > 0));
  }

  console.log(`  Total: ${deployments.length}`);
  console.log(`  Older than cutoff: ${older.length}`);
  console.log(`  Will delete: ${toDelete.length}`);
  console.log('');

  let deleted = 0;
  for (const d of toDelete) {
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
  console.log(`Done. Deleted: ${deleted}/${toDelete.length}.`);
})();
