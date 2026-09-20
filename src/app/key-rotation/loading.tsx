import { PageSkeleton } from "@/components/ui/route-skeletons";

export default function Loading() {
  return <PageSkeleton header table={{ rows: 8, cols: 5 }} />;
}
