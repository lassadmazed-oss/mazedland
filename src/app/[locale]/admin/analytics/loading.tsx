import { AdminTableSkeleton } from "@/components/ui/Skeleton";

/** The statistics while their aggregations run: tiles, then a table. */
export default function Loading() {
  return <AdminTableSkeleton rows={6} tiles={8} tabs={6} columns={4} />;
}
