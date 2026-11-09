import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <Card>
      <EmptyState
        title="Not found"
        description="That record doesn't exist or belongs to another account."
        action={
          <Button asChild>
            <Link href="/">Back to overview</Link>
          </Button>
        }
      />
    </Card>
  );
}
