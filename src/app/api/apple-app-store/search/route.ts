import { NextRequest, NextResponse } from "next/server";
import { searchAppleApps, toAppleStorePublicError } from "@/lib/apple-app-store/client.ts";

export async function GET(request: NextRequest) {
  try {
    const result = await searchAppleApps(request.nextUrl.searchParams.get("q") ?? "");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = toAppleStorePublicError(error);
    return NextResponse.json({ error: failure.error }, {
      status: failure.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
