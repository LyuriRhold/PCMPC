import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · PCMPC MIS" };

async function LoginFormWithNext({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} />;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">PCMPC MIS</CardTitle>
          <CardDescription>Pipindan Community Multi-Purpose Cooperative. Sign in with your staff account.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* The fallback must not be a working form: input typed into it would be lost when the real form streams in. */}
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <LoginFormWithNext searchParams={props.searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
