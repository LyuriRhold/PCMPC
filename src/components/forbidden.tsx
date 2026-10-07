export function Forbidden({ permission }: { permission: string }) {
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <h1 className="text-2xl font-semibold">Not allowed</h1>
      <p className="text-muted-foreground">
        Your role does not have the <code className="rounded bg-muted px-1">{permission}</code> permission needed for
        this page.
      </p>
    </div>
  );
}
