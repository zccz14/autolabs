import { useEffect, useState } from 'react';

/** 扁平常量字典：构建期保证完整性，不做懒加载、不做嵌套键。 */
export const COPY = {
  'nav.workbench': { zh: '工作台', en: 'Workbench' },
  'nav.projects': { zh: '项目', en: 'Projects' },
  'nav.about': { zh: '关于', en: 'About' },
  'nav.devices': { zh: '设备', en: 'Devices' },
  'nav.research': { zh: '研究', en: 'Research' },
  'action.refresh': { zh: '刷新', en: 'Refresh' },
  'action.create': { zh: '新建项目', en: 'New project' },
  'action.submit': { zh: '创建', en: 'Create' },
  'action.cancel': { zh: '取消', en: 'Cancel' },
  'action.open': { zh: '打开', en: 'Open' },
  'action.download': { zh: '下载快照', en: 'Download snapshot' },
  'action.freeze': { zh: '冻结', en: 'Freeze' },
  'action.newRun': { zh: '开新一轮实验', en: 'New run' },
  'action.dispatch': { zh: '发出这一轮', en: 'Dispatch this run' },
  'action.verdict': { zh: '上报结论', en: 'Submit verdict' },
  'action.implemented': { zh: '上报实现完成', en: 'Report implemented' },
  'action.save': { zh: '保存', en: 'Save' },
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
    zh: '编号与输入快照由平台分配，思路随这一行留下；提交后平台直接在你的 Cybion 里开一个 Thread、发第一条输入，这一轮就发出去了。发不出去就留在 proposed，可以回到这一轮点「发出这一轮」重试。',
    en: 'The platform allocates the lab number and pins the input snapshot, and the idea stays with this row. On submit it opens a thread in your Cybion and sends the first input, so the run is dispatched. If that fails the run stays proposed, and you can retry from the run page.',
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
  'label.trend': { zh: '指标趋势', en: 'Metric trend' },
  'desc.trend': {
    zh: '横轴是实验编号，纵轴是这个指标的值。实心点是冻结的 run，空心点是被排除或还没结算的；虚线是 0。',
    en: 'X is the lab number and Y is this metric. Filled dots are frozen runs, hollow dots are rejected or unsettled ones; the dashed line is zero.',
  },
  'label.directionHigher': { zh: '越大越好', en: 'Higher is better' },
  'label.directionLower': { zh: '越小越好', en: 'Lower is better' },
  'label.directionNeutral': { zh: '中性', en: 'Neutral' },
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
  'label.evaluation': { zh: '评估', en: 'Evaluation' },
  'eval.hint': {
    zh: '指标由一条评估命令在你自己的机器上算出来，执行体只负责把实验做出来。',
    en: 'Metrics are computed by an evaluation command on your own machine; the executor only builds the experiment.',
  },
  'eval.waiting': { zh: '等评估器算出指标…', en: 'Waiting for the evaluator…' },
  'eval.dirty': {
    zh: '这个包不符合规范，算不出指标',
    en: 'This package does not follow the spec, so no metrics can be computed',
  },
  'eval.done': { zh: '这一轮的指标已经算出来了。', en: 'This run has its metrics.' },
  'eval.none': { zh: '这一轮还没有指标。', en: 'This run has no metrics yet.' },
  'eval.rejected': {
    zh: '这一轮没有进榜单：原因见上面的门禁。下面是评估器交回来的原始数字，只作证据。',
    en: 'This run did not make the leaderboard: see the gates above. The raw numbers below are evidence only.',
  },
  'eval.attempts': { zh: '尝试', en: 'attempts' },
  'eval.fromSnapshot': { zh: '命令来自快照里的 lab.json', en: 'Command from lab.json in the snapshot' },
  'eval.fromProject': { zh: '命令来自项目设置', en: 'Command from project settings' },
  'eval.recomputeTree': { zh: '复算用的树', en: 'Tree used for recompute' },
  'action.recheckAll': { zh: '复算全部历史', en: 'Recheck all' },
  'recheck.queued': { zh: '已排进复算队列', en: 'Queued for recheck' },
  'recheck.running': { zh: '复算中…', en: 'Rechecking…' },
  'recheck.matched': { zh: '复算一致', en: 'Recheck matched' },
  'recheck.diverged': { zh: '复算不一致', en: 'Recheck diverged' },
  'recheck.failed': { zh: '复算失败', en: 'Recheck failed' },
  'project.evalTitle': { zh: '评估入口', en: 'Evaluation entry' },
  'project.evalHint': {
    zh: '一条命令，在你选的设备上跑。它会拿到 AUTOLABS_SNAPSHOT_URL、AUTOLABS_TOKEN、AUTOLABS_DATASET 和 AUTOLABS_METRICS，最后一行打印 {"metrics": {"<key>": <number>}}。',
    en: 'One command, run on the device you pick. It receives AUTOLABS_SNAPSHOT_URL, AUTOLABS_TOKEN, AUTOLABS_DATASET and AUTOLABS_METRICS, and prints {"metrics": {"<key>": <number>}} as its last line.',
  },
  'project.evalCommand': { zh: '评估命令', en: 'Evaluation command' },
  'project.evalDevice': { zh: '评估设备', en: 'Evaluation device' },
  'project.evalDeviceNone': { zh: '还没有接入设备', en: 'No device connected yet' },
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
  'devices.addressTitle': { zh: '我的设备地址', en: 'My device address' },
  'devices.addressHint': {
    zh: '把这一串加进你机器的 trust，那台机器才认 AutoLabs。它只是一串公开地址，不是密钥：密钥由 AutoLabs 保管，你不需要备份、也不需要输入它。',
    en: 'Add this string to your machine trust list, and that machine will accept AutoLabs. It is a public address, not a key: AutoLabs holds the key, so there is nothing to back up or type in.',
  },
  'devices.addressEmpty': {
    zh: '还没有地址。生成之后就把它加进你机器的 trust。',
    en: 'No address yet. Generate one, then add it to your machine trust list.',
  },
  'devices.createAddress': { zh: '生成地址', en: 'Generate address' },
  'devices.rotate': { zh: '换一把地址', en: 'Rotate address' },
  'devices.rotateHint': {
    zh: '换完要逐台重加新地址：旧地址立刻失效，那些机器会不再认 AutoLabs。只在怀疑泄漏时才换。',
    en: 'Every machine has to add the new address: the old one stops working at once, and those machines will no longer accept AutoLabs. Rotate only when you suspect a leak.',
  },
  'devices.rotateConfirm': { zh: '确认换一把', en: 'Rotate anyway' },
  'devices.copy': { zh: '复制', en: 'Copy' },
  'devices.copied': { zh: '已复制', en: 'Copied' },
  'devices.devicesTitle': { zh: '已接入的设备', en: 'Connected devices' },
  'devices.devicesHint': {
    zh: '接入时会立刻探活一次：发一条空命令过去，回来了才算接上。没接上的设备不会接活。',
    en: 'Connecting probes the device right away: one empty command is sent, and only a reply counts as connected. An unprobed device will not be given work.',
  },
  'devices.deviceAddress': { zh: '设备地址', en: 'Device address' },
  'devices.add': { zh: '接入并探活', en: 'Connect and probe' },
  'devices.addressPlaceholder': {
    zh: '在那台机器上跑 exe status，复制 address 那一行',
    en: 'Run exe status on that machine and copy the address line',
  },
  'devices.labelPlaceholder': { zh: '例如 MacMini', en: 'e.g. MacMini' },
  'devices.probe': { zh: '探活', en: 'Probe' },
  'devices.remove': { zh: '移除', en: 'Remove' },
  'devices.empty': { zh: '还没有接入任何设备。', en: 'No device connected yet.' },
  'devices.neverProbed': { zh: '还没探过', en: 'Never probed' },
  'devices.probeOk': { zh: '探活通过', en: 'Probe passed' },
  'devices.probeFailed': { zh: '探活失败', en: 'Probe failed' },
  'devices.lastProbe': { zh: '上次探活', en: 'Last probe' },
  'devices.trustStep': {
    zh: '在这台机器上把地址写进 trust（eXe App 的「调用方」页，或 ~/.config/exe/config.toml 的 trust 列表），保存后设备两秒内自己生效。',
    en: 'On that machine, put the address into its trust list (the Callers page of the eXe app, or the trust array in ~/.config/exe/config.toml). The device picks it up within two seconds.',
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
