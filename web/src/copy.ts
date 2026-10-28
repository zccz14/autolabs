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
  'hint.dataset': { zh: '数据集由 Firmament 定义，AutoLabs 只钉住 manifest 摘要。', en: 'Datasets are defined by Firmament; AutoLabs only pins the manifest digest.' },
  'label.gates': { zh: '门禁', en: 'Gates' },
  'label.metrics': { zh: '指标', en: 'Metrics' },
  'label.report': { zh: '结论报告', en: 'Report' },
  'label.state': { zh: '状态', en: 'State' },
  'label.none': { zh: '无', en: 'None' },
  'empty.projects': { zh: '还没有项目。建一个 <Domain>-Labs，比如 q-labs。', en: 'No projects yet. Create a <Domain>-Labs, e.g. q-labs.' },
  'empty.runs': { zh: '还没有实验。编号由项目分配，永不复用。', en: 'No runs yet. Lab numbers are allocated per project and never reused.' },
  'empty.snapshots': { zh: '还没有快照。快照就是一次不可变的实验文件提交。', en: 'No snapshots yet. A snapshot is one immutable submission of experiment files.' },
  'hint.login': { zh: '正在确认你的 Auth Mini 身份…', en: 'Checking your Auth Mini identity…' },
  'hint.audience': { zh: '若被拒绝：Auth Mini 需要把 autolabs.ntnl.io 加进 audience 列表。', en: 'If rejected: Auth Mini must include autolabs.ntnl.io in its audiences.' },
  'about.title': { zh: 'AutoLabs 是什么', en: 'What AutoLabs is' },
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
