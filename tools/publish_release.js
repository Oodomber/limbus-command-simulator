// 一次性发布脚本：建 tag + 建 release + 上传 exe 附件
// 用法：$env:GH_TOKEN='...'; node tools/publish_release.js [tag]
//
// 说明：本机 hosts 把 github 各域名指向 127.0.0.1（本地代理），Node 的 TLS 不认它的证书，
// 所以统一走系统 curl.exe（Schannel，能用 Windows 证书库）+ --ssl-no-revoke。
// Token 只从环境变量读，不落盘、不打印。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'Oodomber/limbus-command-simulator';
const TAG = process.argv[2] || 'v1.3.0';

// Token 来源优先级：
//   1) 环境变量 GH_TOKEN
//   2) git 已保存的 GitHub 凭证（Git Credential Manager）—— 与 git push 用的是同一份权限
// 细粒度 PAT 若只有 Contents: Read，会在建 tag / release 时 403，所以这里允许用 git 凭证兜底。
function readGitToken() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      cwd: path.dirname(__dirname),
    });
    const m = out.match(/^password=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

const GIT_TOKEN = readGitToken();
const TOKEN = GIT_TOKEN || process.env.GH_TOKEN;
const TOKEN_SRC = GIT_TOKEN ? 'git 已保存凭证' : 'GH_TOKEN 环境变量';
if (!TOKEN) {
  console.error('没有可用 token：既没读到 git 凭证，也没有 GH_TOKEN');
  process.exit(1);
}

const ROOT = path.dirname(__dirname);
const ASSET = path.join(ROOT, 'dist', '谨遵指令 1.3.0.exe');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-release-'));

function curl(args, label) {
  const full = ['--ssl-no-revoke', '-sS', '--fail-with-body',
    '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28', ...args];
  try {
    const out = execFileSync('curl.exe', full, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return out;
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    throw new Error(`${label} 失败：${stderr || e.message}`);
  }
}

function apiJson(method, apiPath, bodyObj, label) {
  const args = ['-X', method, `https://api.github.com${apiPath}`];
  if (bodyObj) {
    const f = path.join(TMP, 'body-' + Date.now() + '.json');
    fs.writeFileSync(f, JSON.stringify(bodyObj), 'utf8');
    args.push('-H', 'Content-Type: application/json', '--data-binary', '@' + f);
  }
  const out = curl(args, label);
  try { return JSON.parse(out); } catch (e) { return { _raw: out }; }
}

function uploadAsset(uploadUrl, filePath) {
  const name = path.basename(filePath);
  const url = uploadUrl.replace('{?name,label}', '') + '?name=' + encodeURIComponent(name);
  const sizeMb = (fs.statSync(filePath).size / 1048576).toFixed(1);
  console.log(`  正在上传 ${name}（${sizeMb} MB），大文件需要几分钟…`);
  const out = curl(
    ['-X', 'POST', url, '-H', 'Content-Type: application/octet-stream',
      '--data-binary', '@' + filePath, '--max-time', '1800'],
    '上传附件'
  );
  try { return JSON.parse(out); } catch (e) { return { _raw: out }; }
}

const BODY = `## 谨遵指令 v1.3.0

自 v1.2.1 以来的主要变化。

### 图像识别模式（全新）
- 窗口级捕获，只抓游戏窗口，不再把软件自己的窗口拍进去。
- 纯 JS 像素管线，**不依赖 Python、不使用 OCR**：锚点 + 模板匹配识别当前环节，实拍帧留一法验证 100%。
- 时序状态机（合法转移 + 连续帧迟滞）抑制抖动误判。
- 识别到环节后自动生成指令并投递，开局走传呼机确认，进地牢后自动推进。
- 结构化读数：商店普通/特殊、商店上下滚动箭头、事件选项数、卡包数量、关底/关卡饰品奖励区分、奖励卡数量。

### 广播模式（新）
- 屏幕上方横幅播报指令，打字机动画 + 音效，自动消失、不需要确认。
- 与传呼机模式二选一，在「谨遵指令」开局的确认弹窗里选择。
- 开局环节仍用传呼机逐条确认；开局饰品选完后立即收起传呼机与悬浮球，此后切广播。

### 启动与退出
- 便携版双层启动画面：解压阶段显示 BMP 启动图，Electron 起来后显示应用内启动动画。
- 左下角版本号改为运行时读取。
- 关窗彻底退出（含隐藏的采集窗口、广播窗口），不再残留后台进程占用实例锁。

### 数据更新
- 人格 181 → **192**，E.G.O 109 → **116**，饰品 445 → **447**，与灰机 wiki 全量对齐。
- 修正若干译名（流浪乐队老大、第四根火柴之焰、知识树之枝等），统一使用双冒号写法。

### 指令修正
- 层数改为按画面推进计层（离开关底奖励才 +1），修复高层出现低层卡包的问题。
- 战斗 EGO 指令从约 20% 降到约 6%，且第 2 层起才出现。
- 判定环节只从编队前 7 位选人（场上最多 7 人）。
- 新增金枝类型 LUXURIA。
- 多条指令会显示 1 / 3 这样的批次进度。

### 其他
- 难度与显示方式移到开局确认弹窗；镜牢难度默认「困难」，显示默认「广播」。
- 编队窗口新增全局快捷键（默认 F4，可在设置里改）。
- 开发者面板改为连点三下指令 LOGO 打开，无需密码。

> 注：便携版每次启动会解压到临时目录，首次启动比开发版慢 1~2 秒属正常现象。
`;

(async () => {
  console.log(`使用 ${TOKEN_SRC}（${TOKEN.slice(0, 4)}…，长度 ${TOKEN.length}）`);
  console.log('检查 token 与仓库…');
  const repo = apiJson('GET', `/repos/${REPO}`, null, '读取仓库');
  console.log(`  OK：${repo.full_name}（默认分支 ${repo.default_branch}）`);

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
  console.log(`本地 HEAD = ${sha.slice(0, 7)}`);

  let releaseUrl = null;
  try {
    const r = apiJson('POST', `/repos/${REPO}/git/refs`, { ref: `refs/tags/${TAG}`, sha }, '建 tag');
    console.log(`已创建 tag ${TAG} → ${sha.slice(0, 7)}`);
    releaseUrl = r && r.ref;
  } catch (e) {
    if (/already exists/i.test(e.message)) console.log(`tag ${TAG} 已存在，跳过`);
    else throw e;
  }

  console.log('创建 Release…');
  let release;
  try {
    release = apiJson('POST', `/repos/${REPO}/releases`, {
      tag_name: TAG,
      name: `谨遵指令 ${TAG}`,
      body: BODY,
      draft: false,
      prerelease: false,
    }, '建 release');
    console.log(`  Release 已建：#${release.id}`);
  } catch (e) {
    if (/already_exists/i.test(e.message)) {
      release = apiJson('GET', `/repos/${REPO}/releases/tags/${TAG}`, null, '读已有 release');
      console.log(`  Release 已存在：#${release.id}，改为补传附件`);
    } else throw e;
  }

  if (!fs.existsSync(ASSET)) {
    console.error('找不到安装包：' + ASSET);
    process.exit(1);
  }
  const asset = uploadAsset(release.upload_url, ASSET);
  console.log(`  完成：${asset.browser_download_url || JSON.stringify(asset).slice(0, 300)}`);
  console.log(`Release 页面：${release.html_url}`);
})();
