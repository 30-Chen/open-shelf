#!/usr/bin/env node
/**
 * 生成可选的静态兜底数据 data/snapshot.json
 *
 *   node tools/update-snapshot.mjs                     # 按 defaults.js 里的清单抓取
 *   GITHUB_TOKEN=ghp_xxx node tools/update-snapshot.mjs   # 提高限额
 *   SNAPSHOT_REPOS="owner/a,owner/b" node tools/update-snapshot.mjs  # 临时指定清单
 *
 * 页面会优先用实时 API 数据；只有 API 失败（限流 / 断网）时才回退到这份快照。
 * 抓完后把 data/snapshot.json 一起提交到仓库即可。删除该文件不影响任何功能。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const TOKEN = process.env.GITHUB_TOKEN || '';
const OUT = path.join(ROOT, 'data', 'snapshot.json');

function readList() {
  if (process.env.SNAPSHOT_REPOS) {
    return process.env.SNAPSHOT_REPOS.split(',').map(s => s.trim()).filter(Boolean);
  }
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/modules/repo-showcase/defaults.js'), 'utf8');
  const start = src.indexOf('defaults:');
  const block = src.slice(start, src.indexOf(']', start));
  return [...block.matchAll(/'([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)'/g)].map(m => m[1]);
}

const headers = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'open-shelf-snapshot-builder'
};
if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;

async function getJSON(url) {
  const res = await fetch(url, { headers });
  if (res.status === 404) return null; // 从未发布 Release，属于正常情况
  if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + url + ' · ' + (await res.text()).slice(0, 120));
  return res.json();
}

function slimRepo(r) {
  return {
    full_name: r.full_name, name: r.name, html_url: r.html_url,
    owner: { login: r.owner && r.owner.login, avatar_url: r.owner && r.owner.avatar_url },
    description: r.description || '', homepage: r.homepage || '',
    language: r.language || '', stargazers_count: r.stargazers_count || 0,
    forks_count: r.forks_count || 0,
    license: r.license ? { spdx_id: r.license.spdx_id } : null,
    topics: (r.topics || []).slice(0, 6), pushed_at: r.pushed_at || ''
  };
}

function slimRelease(r) {
  if (!r) return null;
  return {
    tag_name: r.tag_name || '', name: r.name || '', published_at: r.published_at || '',
    html_url: r.html_url || '', body: String(r.body || '').slice(0, 1600),
    prerelease: !!r.prerelease,
    assets: (r.assets || []).map(a => ({
      name: a.name, size: a.size, download_count: a.download_count,
      browser_download_url: a.browser_download_url, content_type: a.content_type
    }))
  };
}

async function main() {
  const list = readList();
  if (!list.length) throw new Error('没有读取到项目清单，请检查 defaults.js');
  const repos = {};

  for (const fullName of list) {
    const [repo, releases] = await Promise.all([
      getJSON(API + '/repos/' + fullName),
      getJSON(API + '/repos/' + fullName + '/releases?per_page=10')
    ]);
    if (!repo) { console.warn('跳过（仓库不存在）:', fullName); continue; }
    const list = Array.isArray(releases) ? releases.filter(r => r && !r.draft).slice(0, 5) : [];
    const stable = list.filter(r => !r.prerelease);
    const pre = list.filter(r => r.prerelease);
    const ordered = stable.concat(pre);
    // release 字段保留最新版本以兼容旧页面；releases 供新版多版本切换使用
    repos[fullName] = {
      repo: slimRepo(repo),
      release: slimRelease(ordered[0] || null),
      releases: ordered.map(slimRelease).filter(Boolean)
    };
    console.log('✓', fullName, ordered.length ? ordered.map(r => r.tag_name).join(', ') : '（无 Release）',
      ordered.reduce((n, r) => n + (r.assets ? r.assets.length : 0), 0) + ' 个安装包');
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), repos }, null, 2) + '\n');
  console.log('\n已写入', OUT, '·', Object.keys(repos).length, '个项目');
}

main().catch(err => { console.error('生成失败：', err.message); process.exitCode = 1; });
