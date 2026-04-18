import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/champions?summonerId=xxx&limit=10
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const summonerId = searchParams.get("summonerId");
    const limit      = Math.min(Number(searchParams.get("limit") || 10), 30);

    if (!summonerId) {
      return NextResponse.json({ error: "summonerId가 필요합니다." }, { status: 400 });
    }

    const conn = await pool.getConnection();
    try {
      const [rows]: any = await conn.execute(
        `SELECT
           champion_name,
           games,
           wins,
           ROUND(wins / games * 100, 1)                                      AS win_rate,
           ROUND(kills_total   / games, 1)                                   AS avg_kills,
           ROUND(deaths_total  / games, 1)                                   AS avg_deaths,
           ROUND(assists_total / games, 1)                                   AS avg_assists,
           ROUND((kills_total + assists_total) / GREATEST(deaths_total, 1) / games, 2) AS avg_kda
         FROM champion_stats
         WHERE summoner_id = ?
         ORDER BY games DESC
         LIMIT ?`,
        [summonerId, limit]
      );

      return NextResponse.json({ success: true, champions: rows });
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error("[champions] 오류:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
