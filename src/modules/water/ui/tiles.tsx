import { businessToday } from "@/lib/dates";
import { format } from "@/lib/money";
import { waterTiles } from "../reports";

/** Water dashboard tiles: billed, collected, efficiency, disconnection list, NRW (this month). */
export async function Tiles() {
  const t = await waterTiles(businessToday().slice(0, 7));
  const tiles = [
    { label: "Billed this month", value: format(t.billed) },
    { label: "Collected this month", value: format(t.collected) },
    { label: "Collection efficiency (bills due this month)", value: t.efficiency === null ? "—" : `${t.efficiency}%` },
    { label: "Accounts for disconnection", value: String(t.forDisconnection) },
    { label: "Non-revenue water", value: t.nrwPercent === null ? "—" : `${t.nrwPercent}%` },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-5 print:hidden">
      {tiles.map((x) => (
        <div key={x.label} className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{x.label}</p>
          <p className="text-lg font-semibold tabular-nums">{x.value}</p>
        </div>
      ))}
    </div>
  );
}
