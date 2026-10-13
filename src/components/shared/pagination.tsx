import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Server-rendered page links that keep the current query string. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q}`;
  };
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span className="tabular">
        {total === 0 ? "No results" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
      </span>
      <div className="flex gap-1">
        <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>
          {page > 1 ? (
            <Link href={href(page - 1)} aria-label="Previous page">
              <ChevronLeft />
            </Link>
          ) : (
            <span aria-hidden>
              <ChevronLeft />
            </span>
          )}
        </Button>
        <Button asChild={page < pages} variant="outline" size="sm" disabled={page >= pages}>
          {page < pages ? (
            <Link href={href(page + 1)} aria-label="Next page">
              <ChevronRight />
            </Link>
          ) : (
            <span aria-hidden>
              <ChevronRight />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
