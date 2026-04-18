import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getRankedInfo } from "@/lib/riot";

// GET /api/ranked?summonerId=xxx&riotSummonerId=xxx&region=KR
// summonerId = DB의 id, riotSummonerId = Riot 서버의 summonerId
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const summonerId     = searchParams.get("summonerId");     // DB id
    const riotSummonerId = searchParams.get("riotSummonerId"); // Riot API id
    const region         = searchParams.get("region") || "KR";

    if (!summonerId) {
      return NextResponse.json({ error: "summonerId가 필요합니다." }, { status: 400 });
    }

    const conn = await pool.getConnection();
    try {
      // Riot API로 최신 랭크 갱신
      if (riotSummonerId) {
        const ranked = await getRankedInfo(riotSummonerId, region);
        for (const r of ranked) {
          await conn.execute(
            `INSERT INTO ranked_info
               (id, summoner_id, queue_type, tier, rank_division, league_points, wins, losses)
             VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               tier = VALUES(tier), rank_division = VALUES(rank_division),
               league_points = VALUES(league_points),
               wins = VALUES(wins), losses = VALUES(losses),
               updated_at = CURRENT_TIMESTAMP`,
            [summonerId, r.queueType, r.tier, r.rank, r.leaguePoints, r.wins, r.losses]
          );
        }
      }

      // DB에서 랭크 정보 조회
      const [rows]: any = await conn.execute(
        `SELECT
           queue_type, tier, rank_division, league_points, wins, losses,
           ROUND(wins / (wins + losses) * 100, 1) AS win_rate,
           updated_at
         FROM ranked_info
         WHERE summoner_id = ?`,
        [summonerId]
      );

      return NextResponse.json({ success: true, ranked: rows });
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error("[ranked] 오류:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
