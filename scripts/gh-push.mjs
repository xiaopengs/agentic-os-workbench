#!/usr/bin/env node
/**
 * GitHub 备用推送通道（Git Data API）
 *
 * 用途：当沙箱/内网环境对 github.com 的 443 做了 SNI 阻断，导致
 *       `git push` 在 TLS 握手阶段失败（SSL_ERROR_SYSCALL），
 *       但 api.github.com 仍可达时，用本脚本经 REST API 推送提交。
 *
 * 用法：
 *   GH_TOKEN=<pat> node scripts/gh-push.mjs            # 推送当前 HEAD
 *   GH_TOKEN=<pat> node scripts/gh-push.mjs --full     # 强制全量树（分叉时使用）
 *
 * 行为：
 *   · 远端 HEAD == 本地 HEAD~1  → 增量：只为变更文件创建 blob
 *   · 否则                      → 全量：以远端 HEAD 为父，提交本地完整工作树
 *   · 推送成功后同步更新 refs/remotes/origin/<branch>（失败不影响结果）
 *
 * ⚠️ 全量模式以本地树覆盖远端树，仅适用于单人仓库；多人协作请先 git pull。
 */
import { execFileSync } from 'node:child_process';

const OWNER = process.env.GH_OWNER || 'xiaopengs';
const REPO = process.env.GH_REPO || 'agentic-os-workbench';
const TOKEN = process.env.GH_TOKEN;
const FORCE_FULL = process.argv.includes('--full');

if (!TOKEN) {
  console.error('缺少 GH_TOKEN 环境变量');
  process.exit(1);
}

const sh = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], {
  encoding: 'utf8',
}).trim();

// 读取 HEAD 中某文件的原始字节（不指定 encoding，得到 Buffer）。
// ⚠️ 绝不能用 utf8 读：PNG 等二进制含非法 UTF-8 序列（如 PNG 魔数 0x89），
//    会被替换成 U+FFFD（efbfbd），远端文件直接损坏 —— README 截图全裂的根因。
const gitShowBuffer = (file) =>
  execFileSync('git', ['-c', 'core.quotepath=false', 'show', `${head}:${file}`], {
    maxBuffer: 1 << 26, // 64MB，足够大截图
  });

// 统一以 base64 创建 blob：文本与二进制同一条路径，杜绝编码损坏。
// （Trees API 的 content 字段只支持 UTF-8 文本，二进制必须先建 blob 拿 sha。）
const BLOB_CONCURRENCY = 8;
async function createBlob(file) {
  const buf = gitShowBuffer(file);
  const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  });
  return { path: file, mode: '100644', type: 'blob', sha: blob.sha };
}

// 小并发池：既提速又不触发 GitHub API 限流
async function createBlobsAll(files) {
  const items = new Array(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      items[i] = await createBlob(files[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(BLOB_CONCURRENCY, files.length) }, worker));
  return items;
}

async function api(method, path, payload) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'agentic-os-gh-push',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

const head = sh('rev-parse', 'HEAD');
const branch = sh('rev-parse', '--abbrev-ref', 'HEAD') || 'main';
const message = sh('log', '-1', '--pretty=%B');

const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`);
const remote = ref.object.sha;
console.log(`本地 HEAD : ${head.slice(0, 7)}`);
console.log(`远端 HEAD : ${remote.slice(0, 7)}`);

let parent;
let treeItems;
let baseTree;

if (!FORCE_FULL && remote === sh('rev-parse', 'HEAD~1')) {
  /* 增量：只处理变更文件，base_tree = 远端 */
  parent = remote;
  baseTree = sh('rev-parse', 'HEAD~1^{tree}');
  const files = sh('diff', '--name-only', remote, head).split('\n').filter(Boolean);
  console.log(`模式     : 增量（${files.length} 个文件，base64 blob）`);
  treeItems = await createBlobsAll(files);
} else {
  /* 全量：本地完整树，父 = 远端 HEAD */
  parent = remote;
  const files = sh('ls-tree', '-r', '--name-only', head).split('\n').filter(Boolean);
  console.log(`模式     : 全量（${files.length} 个文件，base64 blob，以远端为父）`);
  treeItems = await createBlobsAll(files);
}

const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
  ...(baseTree ? { base_tree: baseTree } : {}),
  tree: treeItems,
});

const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message,
  tree: tree.sha,
  parents: [parent],
});

await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${branch}`, { sha: commit.sha });

try {
  // 远端 commit 对象不在本地库（API 侧生成），update-ref 必然失败，静默忽略
  execFileSync('git', ['update-ref', `refs/remotes/origin/${branch}`, commit.sha], {
    stdio: 'ignore',
  });
} catch {
  /* 忽略 */
}

console.log(`\n✅ 已推送 ${commit.sha.slice(0, 7)} → ${OWNER}/${REPO}@${branch}`);
console.log(`   https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
