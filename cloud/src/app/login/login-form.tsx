"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";
import { login, type LoginState } from "./actions";

export function LoginForm({ next, configError }: { next: string; configError: string | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: configError });

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-2">
        <Label htmlFor="password">Studio password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus disabled={!!configError} />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription className="col-start-1 col-span-2">{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending || !!configError}>
        {pending ? <LoaderCircle className="animate-spin" /> : null}
        Sign in
      </Button>
    </form>
  );
}
