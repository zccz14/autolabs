import { useEffect, useState } from 'react';

/** 扁平常量字典：构建期保证完整性，不做懒加载、不做嵌套键。 */
export const COPY = {
  'nav.workbench': { zh: '工作台', en: 'Workbench' },
  'nav.projects': { zh: '项目', en: 'Projects' },
  'nav.about': { zh: '关于', en: 'About' },
  'nav.research': { zh: '研究', en: 'Research' },
  'action.refresh': { zh: '刷新', en: 'Refresh' },
  'action.create': { zh: '新建项目', en: 'New project' },
  'action.submit': { zh: '创建', en: 'Create' },
  'action.cancel': { zh: '取消', en: 'Cancel' },
  'action.open': { zh: '打开', en: 'Open' },
  'action.download': { zh: '下载快照', en: 'Download snapshot' },
  'action.freeze': { zh: '冻结', en: 'Freeze' },
  'action.newRun': { zh: '开新一轮实验', en: 'New run' },
  'action.dispatch': { zh: '绑定 Cybion Thread', en: 'Bind Cybion thread' },
  'action.verdict': { zh: '上报结论', en: 'Submit verdict' },
  'action.promote': { zh: '晋升为 SOTA', en: 'Promote to SOTA' },
  'label.slug': { zh: '标识', en: 'Slug' },
  'label.name': { zh: '名称', en: 'Name' },
  'label.description': { zh: '定位', en: 'Description' },
  'label.visibility': { zh: '可见性', en: 'Visibility' },
  'label.private': { zh: '私有', en: 'Private' },
  'label.publicRead': { zh: '公开只读', en: 'Public read' },
  'label.project': { zh: '项目', en: 'Project' },
  'label.owner': { zh: '负责人', en: 'Owner' },
  'label.labs': { zh: '实验数', en: 'Labs' },
  'label.nextLab': { zh: '下一个编号', en: 'Next lab' },
  'label.sota': { zh: '当前 SOTA', en: 'Current SOTA' },
  'label.runs': { zh: '实验', en: 'Runs' },
  'label.directory': { zh: '目录', en: 'Directory' },
  'label.idea': { zh: '思路', en: 'Idea' },
  'label.ideaRequired': { zh: '思路（必填）', en: 'Idea (required)' },
  'label.note': { zh: '备注', en: 'Note' },
  'placeholder.idea': {
    zh: '这一轮要验证什么、为什么这么设计，以及排除了哪些做法',
    en: 'What this run tests, why it is designed this way, and which alternatives were ruled out',
  },
  'placeholder.note': { zh: '可选的补充说明', en: 'Optional note' },
  'hint.ideaRequired': { zh: '没有思路，这一行就只剩一个数字。', en: 'Without the idea, the row is just a number.' },
  'desc.newRun': {
    zh: '这里只登记一行：编号与输入快照由平台分配，思路随这一行留下。计算不在这里发生——创建后打开这一轮，绑定 Cybion Thread 才算发出。',
    en: 'This only records the row: the platform allocates the lab number and pins the input snapshot, and the idea stays with it. Computation does not happen here — open the run after creating it and bind a Cybion thread to actually send it out.',
  },
  'label.result': { zh: '结果', en: 'Result' },
  'label.all': { zh: '全部', en: 'All' },
  'desc.directory': { zh: '研究地图：一行一个实验，思路、结果、指标并排。', en: 'The research map: one row per experiment, with idea, result, and metrics side by side.' },
  'label.ideaEmpty': { zh: '未填写', en: 'Not recorded' },
  'label.leaderboard': { zh: '榜单', en: 'Leaderboard' },
  'label.snapshots': { zh: '快照', en: 'Snapshots' },
  'label.metricsTab': { zh: '指标', en: 'Metrics' },
  'label.datasetTab': { zh: '数据集', en: 'Dataset' },
  'label.definition': { zh: '口径', en: 'Definition' },
  'label.unit': { zh: '单位', en: 'Unit' },
  'label.direction': { zh: '方向', en: 'Direction' },
  'label.primary': { zh: '主指标', en: 'Primary' },
  'label.version': { zh: '版本', en: 'Version' },
  'label.dataset': { zh: '数据集', en: 'Dataset' },
  'action.addMetric': { zh: '定义指标', en: 'Define metric' },
  'action.saveMetric': { zh: '保存（新版本）', en: 'Save (new version)' },
  'action.retire': { zh: '退役', en: 'Retire' },
  'action.bindDataset': { zh: '绑定数据集', en: 'Bind dataset' },
  'empty.metrics': { zh: '还没有指标。先定义口径，再谈谁更好。', en: 'No metrics yet. Define the definition before arguing who is better.' },
  'hint.metricVersion': { zh: '每次保存都会生成新版本，旧版本留档——口径不会被悄悄改掉。', en: 'Every save creates a new version; old ones stay. Definitions are never silently rewritten.' },
  'hint.metricUnit': {
    zh: 'ratio 展示成百分比（0.166 → 16.60%）；number 原样展示，夏普这类无量纲值用 number。',
    en: 'ratio renders as a percentage (0.166 → 16.60%); number renders as-is — use it for dimensionless values like Sharpe.',
  },
  'hint.dataset': { zh: '数据集由 Firmament 定义，AutoLabs 只钉住 manifest 摘要。', en: 'Datasets are defined by Firmament; AutoLabs only pins the manifest digest.' },
  'label.gates': { zh: '门禁', en: 'Gates' },
  'label.metrics': { zh: '指标', en: 'Metrics' },
  'label.report': { zh: '结论报告', en: 'Report' },
  'label.ideaAndReport': { zh: '思路与结论', en: 'Idea and report' },
  'label.state': { zh: '状态', en: 'State' },
  'label.none': { zh: '无', en: 'None' },
  'empty.projects': { zh: '还没有项目。建一个 <Domain>-Labs，比如 q-labs。', en: 'No projects yet. Create a <Domain>-Labs, e.g. q-labs.' },
  'empty.runs': { zh: '还没有实验。编号由项目分配，永不复用。', en: 'No runs yet. Lab numbers are allocated per project and never reused.' },
  'empty.snapshots': { zh: '还没有快照。快照就是一次不可变的实验文件提交。', en: 'No snapshots yet. A snapshot is one immutable submission of experiment files.' },
  'hint.login': { zh: '正在确认你的 Auth Mini 身份…', en: 'Checking your Auth Mini identity…' },
  'hint.loginRemote': {
    zh: '这台设备还没有通行密钥？在登录页选「在另一台设备上批准」，用已经登录的设备输入确认码即可——不需要在这台机器上注册新的通行密钥。',
    en: 'No passkey on this device? Choose “Approve on another device” on the login page and enter the confirmation code from a device that is already signed in — no new passkey needed here.',
  },
  'action.openLogin': { zh: '打开登录页', en: 'Open login page' },
  'hint.audience': { zh: '若被拒绝：Auth Mini 需要把 autolabs.ntnl.io 加进 audience 列表。', en: 'If rejected: Auth Mini must include autolabs.ntnl.io in its audiences.' },
  'about.title': { zh: '托管的研究地图', en: 'A hosted research map' },
  'about.p1': {
    zh: '一个项目是一族 <Domain>-Labs，也是一张研究地图：一行一个实验，思路、结果、指标三列并排。地图存在的理由很直接——自动化研究最常见的失败，是在一个狭窄的搜索空间里反复重跑同一类实验；把它画出来，这种重复就变得没必要。',
    en: 'A project is a family of <Domain>-Labs and, at the same time, a research map: one row per experiment, with idea, result, and metrics side by side. The map exists for one reason: the usual failure of automated research is running the same kind of experiment over and over in a narrow search space; once it is drawn, that repetition stops being necessary.',
  },
  'about.p2': {
    zh: 'AutoLabs 是控制面，不是执行面：它发指令、记账、判门禁、把地图推给人看。计算不在这里发生——真正的执行由 Cybion 的 Thread 在用户自己的机器上完成。',
    en: 'AutoLabs is a control plane, not an execution plane: it issues instructions, keeps the ledger, judges gates, and puts the map in front of people. Computation does not happen here — the actual execution runs in a Cybion thread on the user\'s own machine.',
  },
  'about.p3': {
    zh: '指标是带版本的契约：口径写清楚、只追加、不被悄悄改掉；SOTA 是一本账，记着谁把谁挤下去、为什么。地图上的任何一行，都能追回它当时用的那份快照与那版口径。',
    en: 'Metrics are versioned contracts: definitions are explicit, append-only, and never silently rewritten. SOTA is a ledger that records who displaced whom, and why. Any row on the map can be traced back to the snapshot and the definition version it used.',
  },
  'label.tokens': { zh: '令牌', en: 'Tokens' },
  'action.mintToken': { zh: '签发令牌', en: 'Mint token' },
  'action.revoke': { zh: '吊销', en: 'Revoke' },
  'action.confirmRevoke': { zh: '确认吊销', en: 'Confirm revoke' },
  'action.copy': { zh: '复制', en: 'Copy' },
  'action.copied': { zh: '已复制', en: 'Copied' },
  'label.capabilities': { zh: '能力', en: 'Capabilities' },
  'label.created': { zh: '创建', en: 'Created' },
  'label.expires': { zh: '到期', en: 'Expires' },
  'label.expiresInDays': { zh: '有效天数', en: 'Valid days' },
  'label.live': { zh: '有效', en: 'Live' },
  'label.revoked': { zh: '已吊销', en: 'Revoked' },
  'label.expired': { zh: '已过期', en: 'Expired' },
  'label.newToken': { zh: '新令牌（只显示一次）', en: 'New token (shown once)' },
  'empty.tokens': { zh: '还没有令牌。', en: 'No tokens yet.' },
  'hint.tokens': {
    zh: '令牌只在签发那一刻显示一次；吊销即刻失效，不可恢复。用完就吊销，别留长命凭据。',
    en: 'A token is shown once, at mint time. Revoking kills it immediately and for good — revoke what you no longer need.',
  },
  'hint.tokenCapabilities': {
    zh: 'read 读、write 写、verdict 上报结论、sota 改 SOTA 指针——sota 是危险能力，单独签发，用完吊销。',
    en: 'read, write, verdict, and sota. sota moves the SOTA pointer — issue it on its own and revoke it right after.',
  },
} as const;

export type CopyKey = keyof typeof COPY;
export type Lang = 'zh' | 'en';

/** 跟随外壳（LinkitMyInfo 的语言选择）写入的 <html lang>。 */
export function useLang(): Lang {
  const [lang, setLang] = useState<Lang>(() =>
    typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'zh',
  );
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setLang(root.lang.toLowerCase().startsWith('en') ? 'en' : 'zh');
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
  }, []);
  return lang;
}

export function useCopy() {
  const lang = useLang();
  return (key: CopyKey): string => COPY[key][lang];
}
