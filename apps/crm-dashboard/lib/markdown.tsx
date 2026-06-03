import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders artifact block content (markdown) with Tailwind-styled elements.
// Server-rendered (no "use client") so the data path stays server-only.
// No @tailwindcss/typography dependency — elements are styled via the components map.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm text-gray-800 leading-relaxed [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-semibold text-gray-900 mt-4 mb-1.5 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold text-gray-900 mt-4 mb-1.5 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-700 mt-3 mb-1 first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-semibold text-gray-700 mt-2 mb-1 first:mt-0">{children}</h4>,
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{children}</a>
          ),
          strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-gray-300 pl-3 text-gray-600 mb-2">{children}</blockquote>
          ),
          hr: () => <hr className="my-3 border-gray-200" />,
          pre: ({ children }) => (
            <pre className="bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto text-xs font-mono mb-2">{children}</pre>
          ),
          code: ({ className, children }) => {
            const isBlock = typeof className === "string" && className.startsWith("language-");
            return isBlock ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="bg-gray-100 text-gray-800 rounded px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto mb-2">
              <table className="text-xs border-collapse w-full">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-gray-200 px-2 py-1 bg-gray-50 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border border-gray-200 px-2 py-1 align-top">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
