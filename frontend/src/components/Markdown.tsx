import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

// Shared renderer for Canvas's preview mode and NoteDetail's body view, so
// both read markdown consistently (headers, bold/italic, lists, links,
// blockquotes, tables via remark-gfm, and fenced ``` code blocks) styled to
// match the dark/cream theme.
const components: Components = {
  h1: ({ node, ...p }) => <h1 className="text-xl font-semibold text-cream mt-4 mb-2 first:mt-0" {...p} />,
  h2: ({ node, ...p }) => <h2 className="text-lg font-semibold text-cream mt-4 mb-2 first:mt-0" {...p} />,
  h3: ({ node, ...p }) => <h3 className="text-base font-semibold text-cream mt-3 mb-1.5 first:mt-0" {...p} />,
  p: ({ node, ...p2 }) => <p className="mb-3 last:mb-0" {...p2} />,
  strong: ({ node, ...p }) => <strong className="text-cream font-semibold" {...p} />,
  em: ({ node, ...p }) => <em className="italic" {...p} />,
  ul: ({ node, ...p }) => <ul className="list-disc list-outside pl-5 mb-3 space-y-1" {...p} />,
  ol: ({ node, ...p }) => <ol className="list-decimal list-outside pl-5 mb-3 space-y-1" {...p} />,
  li: ({ node, ...p }) => <li {...p} />,
  a: ({ node, ...p }) => (
    <a className="text-cream underline hover:text-cream/80" target="_blank" rel="noreferrer" {...p} />
  ),
  blockquote: ({ node, ...p }) => (
    <blockquote className="border-l-2 border-neutral-600 pl-3 italic text-cream-dim/80 mb-3" {...p} />
  ),
  hr: () => <hr className="border-neutral-700 my-4" />,
  pre: ({ node, ...p }) => (
    <pre
      className="bg-neutral-950 border border-neutral-700 rounded-md p-3 overflow-x-auto mb-3 text-cream text-sm"
      {...p}
    />
  ),
  code: ({ node, className, children, ...rest }) => {
    const text = String(children).replace(/\n$/, "");
    // Fenced blocks (```lang or bare ```) land here too, wrapped in <pre> by
    // the renderer above — treat anything multi-line, or tagged with a
    // language class, as block code rather than inline.
    const isBlock = /language-(\w+)/.test(className ?? "") || text.includes("\n");
    if (isBlock) {
      return (
        <code className={`font-mono ${className ?? ""}`} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="bg-neutral-700/60 text-cream px-1 py-0.5 rounded text-[0.85em] font-mono" {...rest}>
        {children}
      </code>
    );
  },
  table: ({ node, ...p }) => (
    <div className="overflow-x-auto mb-3">
      <table className="border-collapse text-sm" {...p} />
    </div>
  ),
  thead: ({ node, ...p }) => <thead className="border-b border-neutral-600" {...p} />,
  th: ({ node, ...p }) => <th className="text-left text-cream font-medium px-2 py-1" {...p} />,
  td: ({ node, ...p }) => <td className="px-2 py-1 border-t border-neutral-700/60 align-top" {...p} />,
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
