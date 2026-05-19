"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TocEntry {
  id: string;
  text: string;
  level: number;
}

interface ReportTocProps {
  headings: TocEntry[];
}

export function ReportToc({ headings }: ReportTocProps) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px" }
    );

    for (const heading of headings) {
      const el = document.getElementById(heading.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <ScrollArea className="h-[calc(100vh-160px)]">
      <nav className="space-y-1 text-sm">
        <h4 className="font-medium mb-3 text-muted-foreground uppercase text-xs tracking-wider">
          目录
        </h4>
        {headings.map((heading) => (
          <a
            key={heading.id}
            href={`#${heading.id}`}
            className={cn(
              "block py-1 transition-colors hover:text-foreground truncate",
              heading.level === 1 && "font-medium",
              heading.level === 2 && "pl-3",
              heading.level === 3 && "pl-6 text-xs",
              heading.level === 4 && "pl-9 text-xs",
              activeId === heading.id
                ? "text-primary font-medium border-l-2 border-primary -ml-px pl-3"
                : "text-muted-foreground"
            )}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(heading.id)?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            {heading.text}
          </a>
        ))}
      </nav>
    </ScrollArea>
  );
}
