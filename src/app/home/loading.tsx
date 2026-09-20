import { PageSkeleton } from "@/components/ui/route-skeletons";

export default function Loading() {
  return <PageSkeleton header stats={5} cards={4} />;
}
