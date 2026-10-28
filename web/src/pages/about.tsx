import { useCopy } from '../copy';

export function AboutPage() {
  const t = useCopy();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <p className="kicker">AutoLabs</p>
        <h1 className="text-xl font-semibold">{t('about.title')}</h1>
      </header>
      <section className="card flex flex-col gap-3 p-5 text-sm leading-relaxed text-muted-foreground">
        <p>
          一个项目就是一族 <code>&lt;Domain&gt;-Labs</code>：它有自己的 owner、自己的授权、自己的实验编号序列，以及一本 SOTA 账。
        </p>
        <p>
          实验文件由 AutoLabs 自己托管：内容寻址的 blob 组成不可变快照，冻结之后拒绝一切写入。计算不在这里发生——真正的执行由 Cybion 的 Thread 在用户自己的机器上完成，AutoLabs 只负责发指令、记账、判门禁。
        </p>
        <p>
          每一轮实验的链条是：<code>proposed → dispatched → running → 判定 → frozen / rejected</code>，每一环都带快照、门禁和操作者，任何榜单数字都能追溯回它用的那份文件。
        </p>
      </section>
    </div>
  );
}
