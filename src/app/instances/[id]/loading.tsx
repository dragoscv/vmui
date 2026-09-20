import { PageSkeleton } from "@/components/ui/route-skeletons";

export default function Loading() {
  return <PageSkeleton header stats={3} cards={2} />;
}
