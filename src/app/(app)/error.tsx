"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={<AlertTriangle />}
        title="This page couldn't load"
        description={`Nothing was changed. ${error.digest ? `Reference: ${error.digest}` : "Please try again."}`}
        action={<Button onClick={reset}>Try again</Button>}
      />
    </Card>
  );
}
