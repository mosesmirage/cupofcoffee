import { fetchPurchasingPowerSnapshot } from "@/lib/pricing/purchasing-power.ts";

export async function GET() {
  try {
    const snapshot = await fetchPurchasingPowerSnapshot();
    return Response.json(snapshot, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=2592000, stale-while-revalidate=86400" },
    });
  } catch {
    return Response.json({ error: "Comparable purchasing-power data is unavailable." }, { status: 503 });
  }
}
