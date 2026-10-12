import { NextRequest, NextResponse } from "next/server";
import { AppleStoreApiError, lookupAppleAppAcrossStorefronts, toAppleStorePublicError } from "@/lib/apple-app-store/client.ts";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_track_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const trackId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).trackId
    : undefined;
  if (!Number.isSafeInteger(trackId) || (trackId as number) <= 0) {
    const failure = toAppleStorePublicError(new AppleStoreApiError("invalid_track_id"));
    return NextResponse.json({ error: failure.error }, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await lookupAppleAppAcrossStorefronts(trackId as number);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = toAppleStorePublicError(error);
    return NextResponse.json({ error: failure.error }, {
      status: failure.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
