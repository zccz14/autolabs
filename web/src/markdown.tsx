import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 思路与结论是 Markdown：标题、列表、代码块、表格都按结构渲染，
 * 而不是把源码原样摊开给人看。样式在 style.css 的 .md 里。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
