import { NextResponse } from "next/server";
import { migrate } from "@/lib/db";

export async function POST() {
  try {
    migrate();
    return NextResponse.json({ ok: true, message: "DB migrada correctamente" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
