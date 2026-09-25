import { Link } from "@tanstack/react-router";
import { useTests } from "@/services/synapse";
import { Button } from "@/components/ui/button";

export function PracticeButton({ conceptId }: { conceptId: string }) {
  const tests = useTests().filter((t) => t.status === "published" && t.conceptIds.includes(conceptId));
  if (!tests[0]) return <Button disabled>No practice set yet</Button>;
  return <Button asChild><Link to="/student/tests/$id" params={{ id: tests[0].id }}>Practice concept</Link></Button>;
}
