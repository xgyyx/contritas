"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";

interface MarkdownRendererProps {
  content: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractText((children as any).props.children);
  }
  return "";
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className="prose prose-neutral max-w-none dark:prose-invert"
      components={{
        h1: ({ children, ...props }) => {
          const text = extractText(children);
          const id = slugify(text);
          return (
            <h1 id={id} className="scroll-mt-20 text-2xl font-bold mt-8 mb-4" {...props}>
              {children}
            </h1>
          );
        },
        h2: ({ children, ...props }) => {
          const text = extractText(children);
          const id = slugify(text);
          return (
            <h2 id={id} className="scroll-mt-20 text-xl font-semibold mt-6 mb-3 border-b pb-2" {...props}>
              {children}
            </h2>
          );
        },
        h3: ({ children, ...props }) => {
          const text = extractText(children);
          const id = slugify(text);
          return (
            <h3 id={id} className="scroll-mt-20 text-lg font-medium mt-4 mb-2" {...props}>
              {children}
            </h3>
          );
        },
        h4: ({ children, ...props }) => {
          const text = extractText(children);
          const id = slugify(text);
          return (
            <h4 id={id} className="scroll-mt-20 text-base font-medium mt-3 mb-1" {...props}>
              {children}
            </h4>
          );
        },
        table: ({ children, ...props }) => (
          <div className="overflow-x-auto my-4">
            <table className="min-w-full border-collapse border border-border text-sm" {...props}>
              {children}
            </table>
          </div>
        ),
        th: ({ children, ...props }) => (
          <th className="border border-border bg-muted px-3 py-2 text-left font-medium" {...props}>
            {children}
          </th>
        ),
        td: ({ children, ...props }) => (
          <td className="border border-border px-3 py-2" {...props}>
            {children}
          </td>
        ),
        a: ({ children, href, ...props }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80"
            {...props}
          >
            {children}
          </a>
        ),
        blockquote: ({ children, ...props }) => (
          <blockquote className="border-l-4 border-primary/30 pl-4 italic text-muted-foreground my-3" {...props}>
            {children}
          </blockquote>
        ),
        ul: ({ children, ...props }) => (
          <ul className="list-disc pl-6 my-2 space-y-1" {...props}>{children}</ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="list-decimal pl-6 my-2 space-y-1" {...props}>{children}</ol>
        ),
        li: ({ children, ...props }) => (
          <li className="leading-relaxed" {...props}>{children}</li>
        ),
        p: ({ children, ...props }) => (
          <p className="leading-relaxed my-2" {...props}>{children}</p>
        ),
      }}
    />
  );
}

// Export for TOC extraction
export function extractHeadings(markdown: string): Array<{ id: string; text: string; level: number }> {
  const headings: Array<{ id: string; text: string; level: number }> = [];
  const lines = markdown.split("\n");

  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = slugify(text);
      headings.push({ id, text, level });
    }
  }

  return headings;
}
