import { Fragment, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

interface Props {
  content: string;
  conceptMap?: Record<string, string>;
}

export function MarkdownContent({ content, conceptMap = {} }: Props) {
  if (!content) return null;

  // Prepare concept regex
  const conceptNames = Object.keys(conceptMap).sort((a, b) => b.length - a.length);
  const conceptRegex =
    conceptNames.length > 0
      ? new RegExp(
          `\\b(${conceptNames.map((n) => n.replace(/[.*+?^${}()|[\]\\']/g, "\\$&")).join("|")})\\b`,
          "gi",
        )
      : null;

  const linkConceptsInText = (text: string): ReactNode => {
    if (!conceptRegex) return text;

    const parts = text.split(conceptRegex);
    return parts.map((part, idx) => {
      // Find case-insensitive match in conceptMap
      const matchedKey = Object.keys(conceptMap).find(
        (k) => k.toLowerCase() === part.toLowerCase(),
      );
      if (matchedKey) {
        const conceptId = conceptMap[matchedKey];
        return (
          <Link
            key={idx}
            to="/student/graph"
            search={{ focus: conceptId }}
            className="underline decoration-dotted underline-offset-4 hover:decoration-solid font-medium text-foreground"
            title={`Show ${part} on your graph`}
          >
            {part}
          </Link>
        );
      }
      return <Fragment key={idx}>{part}</Fragment>;
    });
  };

  const renderInline = (text: string): ReactNode => {
    // 1. Inline code: `code`
    const codeParts = text.split(/(`[^`]+`)/g);
    return codeParts.map((part, i) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={i}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground"
          >
            {part.slice(1, -1)}
          </code>
        );
      }

      // 2. Bold: **text**
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      return boldParts.map((bPart, j) => {
        if (bPart.startsWith("**") && bPart.endsWith("**")) {
          return (
            <strong key={j} className="font-semibold text-foreground">
              {linkConceptsInText(bPart.slice(2, -2))}
            </strong>
          );
        }

        // 3. Italics: *text*
        const italicParts = bPart.split(/(\*[^*]+\*)/g);
        return italicParts.map((iPart, k) => {
          if (iPart.startsWith("*") && iPart.endsWith("*")) {
            return <em key={k}>{linkConceptsInText(iPart.slice(1, -1))}</em>;
          }
          return <Fragment key={k}>{linkConceptsInText(iPart)}</Fragment>;
        });
      });
    });
  };

  // Block level splitting by double newlines or code fences
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let currentList: { type: "ul" | "ol"; items: string[] } | null = null;
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];
  let currentParagraphLines: string[] = [];

  const flushParagraph = () => {
    if (currentParagraphLines.length > 0) {
      const pText = currentParagraphLines.join(" ").trim();
      if (pText) {
        blocks.push(
          <p key={`p-${blocks.length}`} className="leading-8 text-foreground/90">
            {renderInline(pText)}
          </p>,
        );
      }
      currentParagraphLines = [];
    }
  };

  const flushList = () => {
    if (currentList) {
      const items = currentList.items;
      const key = `list-${blocks.length}`;
      if (currentList.type === "ul") {
        blocks.push(
          <ul key={key} className="my-3 ml-6 list-disc space-y-1.5 text-foreground/90">
            {items.map((it, idx) => (
              <li key={idx} className="leading-7">
                {renderInline(it)}
              </li>
            ))}
          </ul>,
        );
      } else {
        blocks.push(
          <ol key={key} className="my-3 ml-6 list-decimal space-y-1.5 text-foreground/90">
            {items.map((it, idx) => (
              <li key={idx} className="leading-7">
                {renderInline(it)}
              </li>
            ))}
          </ol>,
        );
      }
      currentList = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced Code block toggle
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        blocks.push(
          <pre
            key={`code-${blocks.length}`}
            className="my-4 overflow-x-auto rounded-md bg-muted p-4 font-mono text-sm leading-6 text-foreground"
          >
            <code>{codeBlockLines.join("\n")}</code>
          </pre>,
        );
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = "";
      } else {
        flushParagraph();
        flushList();
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Blank line
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    // Headings
    if (line.startsWith("#### ")) {
      flushParagraph();
      flushList();
      blocks.push(
        <h4 key={`h4-${blocks.length}`} className="mt-6 mb-2 text-lg font-semibold tracking-tight">
          {renderInline(line.slice(5))}
        </h4>,
      );
      continue;
    }
    if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push(
        <h3 key={`h3-${blocks.length}`} className="mt-8 mb-2 text-xl font-medium tracking-tight">
          {renderInline(line.slice(4))}
        </h3>,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(
        <h2 key={`h2-${blocks.length}`} className="mt-10 mb-3 text-2xl font-medium tracking-tight">
          {renderInline(line.slice(3))}
        </h2>,
      );
      continue;
    }
    if (line.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push(
        <h1 key={`h1-${blocks.length}`} className="mt-8 mb-4 text-3xl font-medium tracking-tight">
          {renderInline(line.slice(2))}
        </h1>,
      );
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      blocks.push(
        <blockquote
          key={`quote-${blocks.length}`}
          className="my-3 border-l-2 border-primary/40 pl-4 italic text-muted-foreground"
        >
          {renderInline(line.slice(2))}
        </blockquote>,
      );
      continue;
    }

    // Bullet List (- or *)
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(bulletMatch[2]);
      continue;
    }

    // Numbered List (1. or 2.)
    const numberMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (numberMatch) {
      flushParagraph();
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(numberMatch[2]);
      continue;
    }

    // Regular line in paragraph
    currentParagraphLines.push(line.trim());
  }

  flushParagraph();
  flushList();

  return <div className="space-y-4">{blocks}</div>;
}
