import { useCallback, useEffect, useRef, useState } from "react";
import { Folder, ChevronRight, X, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useProjectStore } from "../../stores/project-store";
import { daemonApiClient } from "../../daemon/api/client";
import type { DirectoryEntry } from "../../daemon/contracts";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddProjectDialog({ open, onOpenChange }: AddProjectDialogProps) {
  const [query, setQuery] = useState("~");
  const [resolvedPath, setResolvedPath] = useState("");
  const [dirs, setDirs] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const addProject = useProjectStore((s) => s.addProject);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchDirs = useCallback(async (path: string) => {
    setLoading(true);
    const result = await daemonApiClient.listDirectories(path);
    if (result.ok) {
      setResolvedPath(result.data.path);
      setDirs(result.data.dirs);
    } else {
      setDirs([]);
    }
    setLoading(false);
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("~");
    setDirs([]);
    setResolvedPath("");
    setActiveIndex(0);
    fetchDirs("~");
    // Input focus is handled by DialogContent's onOpenAutoFocus.
  }, [open, fetchDirs]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (query.trim()) fetchDirs(query.trim());
    }, 150);
    return () => clearTimeout(timer);
  }, [query, open, fetchDirs]);

  const handleSelect = useCallback(
    async (path: string) => {
      setAdding(true);
      const result = await addProject(path);
      setAdding(false);
      if (result) {
        onOpenChange(false);
      }
    },
    [addProject, onOpenChange],
  );

  const handleNavigate = useCallback(
    (path: string) => {
      setQuery(path);
      fetchDirs(path);
    },
    [fetchDirs],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown" && dirs.length > 0) {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % dirs.length);
      } else if (e.key === "ArrowUp" && dirs.length > 0) {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + dirs.length) % dirs.length);
      } else if (e.key === "Tab" && !e.shiftKey && dirs.length > 0) {
        e.preventDefault();
        const target = activeIndex >= 0 && activeIndex < dirs.length ? dirs[activeIndex] : dirs[0];
        handleNavigate(target.path);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < dirs.length) {
          handleSelect(dirs[activeIndex].path);
        } else if (resolvedPath) {
          handleSelect(resolvedPath);
        }
      }
      // Escape is handled by Radix Dialog (onEscapeKeyDown → onOpenChange(false)).
    },
    [activeIndex, dirs, resolvedPath, handleNavigate, handleSelect],
  );

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[15vh] max-w-lg translate-y-0"
        hideClose
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Add a project</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a directory to add as a project
        </DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="~/work/project or search…"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-[13px]"
          />
          {adding && <span className="text-[11px] text-muted-foreground">Adding…</span>}
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div ref={listRef} className="max-h-72 overflow-y-auto">
          <div className="px-2 py-2">
            {dirs.map((dir, i) => (
              <DirectoryRow
                key={dir.path}
                dir={dir}
                active={activeIndex === i}
                index={i}
                onSelect={() => handleSelect(dir.path)}
                onNavigate={() => handleNavigate(dir.path)}
                onHover={() => setActiveIndex(i)}
              />
            ))}
            {!loading && dirs.length === 0 && (
              <div className="px-2 py-4 text-center text-[12px] text-muted-foreground">
                No directories found
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-3" /> select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 text-[10px]">Tab</kbd> navigate into
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 text-[10px]">Esc</kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DirectoryRow({
  dir,
  active,
  index,
  onSelect,
  onNavigate,
  onHover,
}: {
  dir: DirectoryEntry;
  active: boolean;
  index: number;
  onSelect: () => void;
  onNavigate: () => void;
  onHover: () => void;
}) {
  return (
    <div
      data-index={index}
      onMouseEnter={onHover}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px]",
        active ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-surface-1",
      )}
    >
      <button type="button" onClick={onSelect} className="flex flex-1 items-center gap-2 text-left">
        <Folder className="size-3.5 shrink-0" />
        <span className="font-medium">{dir.name}</span>
      </button>
      <button
        type="button"
        aria-label={`Navigate into ${dir.name}`}
        onClick={onNavigate}
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronRight className="size-3" />
      </button>
    </div>
  );
}
