import { useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, AlertCircle } from "lucide-react";
import { getThunderstoreReadme } from "../lib/tauri-api";
import { cn } from "../lib/utils";

// One fetch per package version per session; reopening an accordion is instant.
const readmeCache = new Map<string, Promise<string>>();

function loadReadme(owner: string, name: string, version: string): Promise<string> {
  const key = `${owner}/${name}/${version}`;
  let p = readmeCache.get(key);
  if (!p) {
    p = getThunderstoreReadme(owner, name, version);
    // Don't pin a failure — let the next open retry.
    p.catch(() => readmeCache.delete(key));
    readmeCache.set(key, p);
  }
  return p;
}

const isWebUrl = (url?: string) => !!url && /^https?:\/\//i.test(url);

// READMEs are third-party content. react-markdown builds React elements and
// drops raw HTML, so nothing here ever reaches innerHTML; links and images
// are further limited to http(s).
const components: Components = {
  h1: ({ children }) => <h3 className="text-lg font-semibold text-zinc-100 mt-4 mb-2 first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="text-base font-semibold text-zinc-200 mt-4 mb-2 first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="text-sm font-semibold text-zinc-200 mt-3 mb-1.5">{children}</h5>,
  h4: ({ children }) => <h6 className="text-sm font-medium text-zinc-300 mt-3 mb-1">{children}</h6>,
  p: ({ children }) => <p className="text-sm text-zinc-400 leading-relaxed my-2">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1 text-sm text-zinc-400">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm text-zinc-400">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-zinc-200">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-zinc-700 pl-3 my-2 text-zinc-500">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-zinc-800" />,
  a: ({ href, children }) =>
    isWebUrl(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300 underline underline-offset-2">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) =>
    isWebUrl(src) ? <img src={src} alt={alt ?? ""} loading="lazy" className="max-w-full rounded-lg my-2" /> : null,
  code: ({ className, children }) => (
    <code className={cn("font-mono text-[12px] text-zinc-300 bg-zinc-800/70 rounded px-1 py-0.5", className)}>{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 overflow-x-auto [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full text-xs text-zinc-400 border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="text-left font-semibold text-zinc-300 border-b border-zinc-700 px-2 py-1.5">{children}</th>,
  td: ({ children }) => <td className="border-b border-zinc-800/60 px-2 py-1.5 align-top">{children}</td>,
};

/** The mod's README from Thunderstore, rendered as markdown. Fetched on mount. */
export function ModReadme({
  owner,
  name,
  version,
  className,
}: {
  owner: string;
  name: string;
  version: string;
  className?: string;
}) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setMarkdown(null);
    setError(null);
    loadReadme(owner, name, version)
      .then((md) => live && setMarkdown(md))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [owner, name, version]);

  if (error) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-red-400", className)}>
        <AlertCircle className="w-4 h-4 shrink-0" />
        Couldn't load the description: {error}
      </div>
    );
  }
  if (markdown === null) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-zinc-500", className)}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading description...
      </div>
    );
  }
  if (!markdown.trim()) {
    return <p className={cn("text-xs text-zinc-500", className)}>This mod has no description.</p>;
  }
  return (
    <div className={cn("min-w-0 break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
