import { NextResponse } from "next/server";
import {
  getServerModes,
  isValidMode,
  isValidSuit,
  setServerMode,
} from "@/lib/control-plane-server";

export async function GET() {
  return NextResponse.json({ modes: getServerModes() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { lane, mode } = (body ?? {}) as { lane?: unknown; mode?: unknown };

  if (!isValidSuit(lane)) {
    return NextResponse.json(
      { error: "lane must be one of diamonds|spades|hearts|clubs." },
      { status: 400 }
    );
  }
  if (!isValidMode(mode)) {
    return NextResponse.json(
      { error: "mode must be one of full|slow|pause." },
      { status: 400 }
    );
  }

  setServerMode(lane, mode);
  return NextResponse.json({ ok: true, lane, mode, modes: getServerModes() });
}
