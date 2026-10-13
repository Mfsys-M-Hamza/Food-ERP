import Link from "next/link";
import type { Metadata } from "next";
import { KeyRound, Plus, Search } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listStaff } from "@/server/modules/users/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const ctx = await requireStaffPage("/admin/users");
  if (!can(ctx, "users.manage")) return <AccessDenied />;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const users = await listStaff(ctx, { q });

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts and the roles that decide what each person can do."
        actions={
          <Button asChild>
            <Link href="/admin/users/new">
              <Plus /> Add staff member
            </Link>
          </Button>
        }
      />
      <Card className="gap-0 py-0">
        <form className="flex items-center gap-2 border-b p-3" role="search">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="Search name or e-mail" className="pl-8" aria-label="Search users" />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead className="hidden md:table-cell">Status</TableHead>
              <TableHead className="hidden lg:table-cell">POS PIN</TableHead>
              <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No users match your search.
                </TableCell>
              </TableRow>
            )}
            {users.map((u) => (
              <TableRow key={u.id} className={u.status === "DISABLED" ? "opacity-60" : undefined}>
                <TableCell>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r.key} variant={r.key === "owner" ? "default" : "secondary"}>
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {u.status === "ACTIVE" ? (
                    <Badge variant="outline" className="border-success/40 text-success">Active</Badge>
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {u.hasPin ? <KeyRound className="size-4 text-muted-foreground" aria-label="PIN set" /> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{timeAgo(u.lastLoginAt)}</TableCell>
                <TableCell>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/admin/users/${u.id}`}>Edit</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
