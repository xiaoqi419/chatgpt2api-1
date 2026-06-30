"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ExternalLink, FileText, Globe2, ImageIcon, LoaderCircle, Paperclip, RotateCcw, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchModels } from "@/lib/api";
import { httpRequest } from "@/lib/request";
import { cn } from "@/lib/utils";

import type { ChatCompletionResponse, ChatMessage, MessageContentPart, SearchResult } from "./types";

type Mode = "chat" | "search";
type AttachedFile = { dataUrl: string; textContent?: string; name: string; type: string; size: number };
type ChatTurn = { mode: "chat"; role: "user" | "assistant"; content: string; files?: AttachedFile[] };
type SearchTurn = { mode: "search"; prompt: string; result?: SearchResult; error?: string; elapsedMs?: number };
type Turn = ChatTurn | SearchTurn;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "json", "csv", "tsv", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "js", "ts", "jsx", "tsx", "py", "rb", "go", "rs", "java", "c", "cpp", "h", "hpp",
  "css", "scss", "less", "html", "htm", "vue", "svelte",
  "sh", "bash", "zsh", "ps1", "bat", "cmd",
  "log", "env", "gitignore", "dockerfile", "makefile",
  "sql", "r", "m", "swift", "kt", "scala", "php",
  "tex", "bib", "rst", "asciidoc", "adoc",
  "plist", "properties", "cfg", "config",
]);

const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/yaml",
  "application/javascript",
  "application/typescript",
  "application/x-sh",
];

function isTextFile(name: string, mime: string): boolean {
  if (TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return TEXT_EXTENSIONS.has(ext);
}

function isImageFile(mime: string): boolean {
  return mime.startsWith("image/");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const normalizeMarkdown = (text: string) =>
  text
    .replace(/\ue200url\ue202([^\ue202\ue201]*)\ue202([^\ue201]*)\ue201/g, "[$1]($2)")
    .replace(/\ue200cite\ue202[^\ue201]*\ue201/g, "")
    .replace(/\ue200[^\ue201]*\ue201/g, "")
    .replace(/\ue200[^\ue201]*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const cleanUrl = (url: string) => url.replace(/[\ue200-\ue202].*$/g, "").trim();
const sourceKind = (url: string) => {
  try {
    return new URL(url).hostname.includes("github.com") ? "github" : "web";
  } catch {
    return "web";
  }
};

function MarkdownResult({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ className, ...props }) => <a className={cn("font-medium text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-900 dark:text-blue-300 dark:decoration-blue-700", className)} target="_blank" rel="noreferrer" {...props} />,
        h1: ({ className, ...props }) => <h1 className={cn("mt-8 mb-4 text-2xl font-semibold tracking-tight text-stone-950 first:mt-0 dark:text-stone-50", className)} {...props} />,
        h2: ({ className, ...props }) => <h2 className={cn("mt-8 mb-4 border-b border-stone-200 pb-2 text-xl font-semibold tracking-tight text-stone-950 first:mt-0 dark:border-white/10 dark:text-stone-50", className)} {...props} />,
        h3: ({ className, ...props }) => <h3 className={cn("mt-6 mb-3 text-lg font-semibold text-stone-900 dark:text-stone-100", className)} {...props} />,
        p: ({ className, ...props }) => <p className={cn("my-4 leading-8 text-stone-800 dark:text-stone-200", className)} {...props} />,
        ul: ({ className, ...props }) => <ul className={cn("my-4 list-disc space-y-2 pl-6 leading-7 text-stone-800 dark:text-stone-200", className)} {...props} />,
        ol: ({ className, ...props }) => <ol className={cn("my-4 list-decimal space-y-2 pl-6 leading-7 text-stone-800 dark:text-stone-200", className)} {...props} />,
        blockquote: ({ className, ...props }) => <blockquote className={cn("my-5 border-l-4 border-stone-300 bg-white/70 py-3 pr-4 pl-5 text-stone-700 dark:border-white/20 dark:bg-white/[0.04] dark:text-stone-300", className)} {...props} />,
        code: ({ className, ...props }) => <code className={cn("rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.9em] text-stone-800 dark:bg-white/10 dark:text-stone-100", className)} {...props} />,
        pre: ({ className, ...props }) => <pre className={cn("my-5 overflow-x-auto rounded-xl border border-stone-200 bg-stone-950 p-4 text-sm text-stone-50 dark:border-white/10", className)} {...props} />,
        img: ({ className, ...props }) => <img className={cn("max-h-96 w-auto rounded-xl object-contain", className)} {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function SearchResultView({ turn }: { turn: SearchTurn }) {
  const result = turn.result;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-3xl bg-stone-950 px-5 py-3 text-[15px] leading-7 whitespace-pre-wrap text-white dark:bg-white dark:text-stone-950">{turn.prompt}</div>
      </div>
      {turn.error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/25 dark:text-rose-300">{turn.error}</div> : null}
      {result ? (
        <article className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
              <span className="rounded-full border border-stone-200 bg-white px-3 py-1 dark:border-white/10 dark:bg-white/[0.03]">{result.status || "done"}</span>
              <span className="rounded-full border border-stone-200 bg-white px-3 py-1 dark:border-white/10 dark:bg-white/[0.03]">{((turn.elapsedMs || 0) / 1000).toFixed(2)}s</span>
              <span className="rounded-full border border-stone-200 bg-white px-3 py-1 dark:border-white/10 dark:bg-white/[0.03]">{result.sources?.length || 0} sources</span>
            </div>
            <div className="text-[15px]">
              <MarkdownResult content={normalizeMarkdown(result.answer || "")} />
            </div>
          </div>
          {result.sources?.length ? (
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-100">来源</div>
              <div className="divide-y divide-stone-200 dark:divide-white/10">
                {result.sources.map((source, index) => {
                  const url = cleanUrl(source.url || "");
                  return (
                    <a key={`${url || index}`} href={url} target="_blank" rel="noreferrer" className="flex gap-3 py-3 text-xs transition hover:text-stone-950 dark:hover:text-stone-50">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-stone-600 dark:text-stone-300">
                        {sourceKind(url) === "github" ? <img src="/github.svg" alt="" aria-hidden="true" className="size-3.5 dark:invert" /> : <Globe2 className="size-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 font-medium leading-5 text-stone-800 dark:text-stone-200">{source.title || url || "source"}</span>
                        <span className="mt-1 flex items-center gap-1 truncate text-stone-500 dark:text-stone-400">
                          <ExternalLink className="size-3 shrink-0" />
                          {url}
                        </span>
                      </span>
                    </a>
                  );
                })}
              </div>
            </aside>
          ) : null}
        </article>
      ) : null}
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
    reader.readAsText(file);
  });
}

export function ChatPanel() {
  const [mode, setMode] = useState<Mode>("chat");
  const [model, setModel] = useState("auto");
  const [models, setModels] = useState<string[]>(["auto"]);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [error, setError] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const chatMessages = useMemo<ChatMessage[]>(() => turns.flatMap((turn) => turn.mode === "chat" ? [{ role: turn.role, content: turn.content }] : []), [turns]);

  useEffect(() => {
    let active = true;
    void fetchModels().then((data) => {
      const ids = Array.from(new Set(["auto", ...(data.data || []).map((item) => item.id).filter(Boolean)]));
      if (active) {
        setModels(ids);
        setModel((current) => ids.includes(current) ? current : ids[0] || "auto");
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [turns, loading]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const newFiles: AttachedFile[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 50 * 1024 * 1024) continue; // skip files > 50MB
      const fileRec: AttachedFile = { name: file.name, type: file.type, size: file.size, dataUrl: "" };
      if (isImageFile(file.type)) {
        fileRec.dataUrl = await readFileAsDataUrl(file);
      } else if (isTextFile(file.name, file.type)) {
        fileRec.textContent = await readFileAsText(file);
        // Also store a dataUrl for the preview badge
        fileRec.dataUrl = await readFileAsDataUrl(file);
      } else {
        // Binary files — just read as dataUrl for later upload, no text extraction
        fileRec.dataUrl = await readFileAsDataUrl(file);
      }
      newFiles.push(fileRec);
    }
    setAttachedFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const buildMessageContent = (text: string, files: AttachedFile[]): string | MessageContentPart[] => {
    if (files.length === 0) return text;
    const parts: MessageContentPart[] = [];

    // Build text preamble from attached non-image files
    const textParts: string[] = [];
    for (const file of files) {
      if (isImageFile(file.type)) continue; // images go as image_url
      if (file.textContent) {
        textParts.push(`以下为附件「${file.name}」的内容（${formatFileSize(file.size)}）：\n\`\`\`\n${file.textContent}\n\`\`\``);
      } else {
        textParts.push(`[附件: ${file.name} (${formatFileSize(file.size)})]`);
      }
    }
    if (text || textParts.length > 0) {
      parts.push({ type: "text", text: [text, ...textParts].filter(Boolean).join("\n\n") });
    }

    // Add images as image_url parts
    for (const file of files) {
      if (isImageFile(file.type) && file.dataUrl) {
        parts.push({ type: "image_url", image_url: { url: file.dataUrl } });
      }
    }

    return parts;
  };

  const submit = async () => {
    const content = input.trim();
    if ((!content && attachedFiles.length === 0) || loading) return;
    const currentFiles = [...attachedFiles];
    setAttachedFiles([]);
    setInput("");
    setLoading(true);
    setError("");

    if (mode === "search") {
      if (!content) {
        setError("搜索模式下请输入文字");
        setLoading(false);
        return;
      }
      const start = Date.now();
      setLoadingText("搜索中...");
      const index = turns.length;
      setTurns((current) => [...current, { mode: "search", prompt: content }]);
      try {
        const result = await httpRequest<SearchResult>("/v1/search", { method: "POST", body: { prompt: content } });
        setTurns((current) => current.map((turn, itemIndex) => itemIndex === index ? { mode: "search", prompt: content, result, elapsedMs: Date.now() - start } : turn));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setTurns((current) => current.map((turn, itemIndex) => itemIndex === index ? { mode: "search", prompt: content, error: message, elapsedMs: Date.now() - start } : turn));
      } finally {
        setLoading(false);
        setLoadingText("");
      }
      return;
    }

    const userContent = buildMessageContent(content, currentFiles);
    const nextMessages: ChatMessage[] = [...chatMessages, { role: "user", content: userContent }];

    setTurns((current) => [...current, { mode: "chat", role: "user", content, files: currentFiles }]);

    setLoadingText("正在回复...");
    try {
      const result = await httpRequest<ChatCompletionResponse>("/v1/chat/completions", {
        method: "POST",
        body: { model, messages: nextMessages },
      });
      setTurns((current) => [...current, { mode: "chat", role: "assistant", content: String(result.choices?.[0]?.message?.content || "") }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  };

  return (
    <section className="mx-auto flex h-[calc(100dvh-6.5rem)] min-h-0 w-full max-w-6xl flex-col overflow-hidden px-1 pb-3 sm:h-[calc(100dvh-5.25rem)] sm:px-4 sm:pb-5">
      <div ref={viewportRef} className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-1 py-6 sm:px-5">
        {turns.length ? (
          <div className="space-y-8">
            {turns.map((turn, index) => turn.mode === "search" ? (
              <SearchResultView key={`search-${index}`} turn={turn} />
            ) : (
              <div key={`chat-${index}`} className={cn("mx-auto flex max-w-3xl", turn.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[86%] space-y-3 text-[15px] leading-7",
                  turn.role === "user"
                    ? "rounded-3xl bg-stone-950 px-5 py-3 text-white dark:bg-white dark:text-stone-950"
                    : "text-stone-800 dark:text-stone-100",
                )}>
                  {/* Attached files display */}
                  {turn.files && turn.files.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {turn.files.map((file, fileIndex) =>
                        isImageFile(file.type) ? (
                          <img
                            key={fileIndex}
                            src={file.dataUrl}
                            alt={file.name}
                            className="h-32 w-auto max-w-full rounded-lg object-cover"
                          />
                        ) : (
                          <div key={fileIndex} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white dark:bg-stone-900 dark:text-stone-200">
                            <FileText className="size-3.5 shrink-0" />
                            <span className="truncate max-w-[120px]">{file.name}</span>
                            <span className="shrink-0 opacity-60">{formatFileSize(file.size)}</span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                  {turn.content && (
                    <div className="whitespace-pre-wrap">{turn.content}</div>
                  )}
                </div>
              </div>
            ))}
            {loading ? (
              <div className="mx-auto flex max-w-3xl items-center gap-2 text-sm text-stone-500">
                <LoaderCircle className="size-4 animate-spin" />
                {loadingText}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
            {mode === "search" ? "想搜索什么？" : "有什么可以帮忙的？"}
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl">
        {error ? <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/25 dark:text-rose-300">{error}</div> : null}
        <div className="overflow-hidden rounded-[28px] border border-stone-200 bg-white shadow-[0_18px_70px_-45px_rgba(15,23,42,0.55)] dark:border-white/10 dark:bg-stone-950/90">
          {/* File preview strip */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-stone-100 px-5 pt-3 dark:border-white/10">
              {attachedFiles.map((file, index) => (
                <div key={index} className="group relative">
                  {isImageFile(file.type) ? (
                    <img
                      src={file.dataUrl}
                      alt={file.name}
                      className="h-16 w-16 rounded-lg object-cover ring-1 ring-stone-200 dark:ring-white/10"
                    />
                  ) : (
                    <div className="flex h-16 w-28 items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                      <FileText className="size-4 shrink-0 text-stone-500 dark:text-stone-400" />
                      <span className="min-w-0 truncate leading-tight text-stone-700 dark:text-stone-300">{file.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(index)}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-stone-800 text-white shadow-sm opacity-0 transition group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={mode === "search" ? "输入要搜索的问题" : "给 ChatGPT2API 发送消息"}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            className="min-h-[88px] resize-none border-0 bg-transparent px-5 pt-5 text-[15px] leading-7 shadow-none focus-visible:ring-0 dark:text-stone-100"
          />
          {/* Hidden file input — accept all types */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => { void handleFileSelect(event); }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-4 py-3 dark:border-white/10">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="h-9 w-40 rounded-full border-stone-200 bg-stone-50 px-4 font-mono text-xs shadow-none dark:border-white/10 dark:bg-white/[0.04] sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex rounded-full bg-stone-100 p-1 dark:bg-white/10">
                {(["chat", "search"] as const).map((item) => (
                  <button key={item} type="button" onClick={() => setMode(item)} className={cn("h-8 rounded-full px-3 text-sm font-medium transition", mode === item ? "bg-white text-stone-950 shadow-sm dark:bg-stone-900 dark:text-stone-50" : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100")}>
                    {item === "chat" ? "对话" : "搜索"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9 rounded-full border-stone-200 bg-white"
                onClick={() => fileInputRef.current?.click()}
                title="上传文件（图片、文档、文本等）"
              >
                <Paperclip className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9 rounded-full border-stone-200 bg-white"
                onClick={() => { setTurns([]); setError(""); setAttachedFiles([]); }}
                title="清空对话"
              >
                <RotateCcw className="size-4" />
              </Button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={loading || (!input.trim() && attachedFiles.length === 0)}
                className="inline-flex size-9 items-center justify-center rounded-full bg-stone-950 text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
              >
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
