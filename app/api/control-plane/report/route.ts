import { NextResponse } from "next/server";
import { getServerSpendLog, isValidSuit, recordServerSpend } from "@/lib/control-plane-server";
import type { SpendEvent } from "@/lib/control-plane";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 200)
      : 50;

  return NextResponse.json({ events: getServerSpendLog(limit) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { lane, amount, meta, at } = (body ?? {}) as Partial<SpendEvent>;

  if (!isValidSuit(lane)) {
    return NextResponse.json(
      { error: "lane must be one of diamonds|spades|hearts|clubs." },
      { status: 400 }
    );
  }

  const event: SpendEvent = {
    lane,
    amount: typeof amount === "number" ? amount : undefined,
    meta: meta && typeof meta === "object" ? meta : undefined,
    at: typeof at === "number" ? at : Date.now(),
  };

  const { count } = recordServerSpend(event);
  return NextResponse.json({ ok: true, event, count });
}
