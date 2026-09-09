import { NextResponse } from "next/server";
import { checkServer, isValidSuit } from "@/lib/control-plane-server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lane = searchParams.get("lane");

  if (!isValidSuit(lane)) {
    return NextResponse.json(
      { error: "lane query param must be one of diamonds|spades|hearts|clubs." },
      { status: 400 }
    );
  }

  return NextResponse.json(checkServer(lane));
}
