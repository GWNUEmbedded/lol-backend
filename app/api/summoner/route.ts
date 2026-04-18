import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAccountByRiotId, getSummonerByPuuid, getRankedInfo } from "@/lib/riot";

// GET /api/summoner?gameName=Hide on bush&tagLine=KR1&region=KR
export async function GET(req: NextRequest) {
  console.log("API KEY:", process.env.RIOT_API_KEY);
  try {
    const { searchParams } = new URL(req.url);
    const gameName = searchParams.get("gameName");
    const tagLine  = searchParams.get("tagLine");
    const region   = searchParams.get("region") || "KR";

    if (!gameName || !tagLine) {
      return NextResponse.json(
        { error: "gameName과 tagLine은 필수입니다." },
        { status: 400 }
      );
    }

    // ── 1. Riot API: 계정 조회 ──
    const account = await getAccountByRiotId(gameName, tagLine, region);
    const summoner = await getSummonerByPuuid(account.puuid, region);
    const ranked = await getRankedInfo(account.puuid, region);

    // ── 2. DB 저장 또는 업데이트 ──
    const conn = await pool.getConnection();
    try {
      // summoners 테이블 upsert
      await conn.execute(
        `INSERT INTO summoners
     (id, puuid, summoner_id, account_id, game_name, tag_line,
      summoner_name, profile_icon_id, summoner_level, region)
   VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE
     summoner_id     = VALUES(summoner_id),
     summoner_name   = VALUES(summoner_name),
     profile_icon_id = VALUES(profile_icon_id),
     summoner_level  = VALUES(summoner_level),
     updated_at      = CURRENT_TIMESTAMP`,
        [
          account.puuid,
          "",              // ← summoner.id 대신 빈값
          "",              // ← summoner.accountId 대신 빈값
          gameName,
          tagLine,
          gameName,        // ← summoner.name 대신 gameName
          summoner.profileIconId,
          summoner.summonerLevel,
          region,
        ]
      );

      // DB에 저장된 summoner id 조회
      const [rows]: any = await conn.execute(
        "SELECT id FROM summoners WHERE puuid = ?",
        [account.puuid]
      );
      const summonerId = rows[0].id;

      // ranked_info upsert
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

      // ── 3. 응답 ──
      return NextResponse.json({
        success: true,
        summoner: {
          id:           summonerId,
          puuid:        account.puuid,
          gameName:     account.gameName,
          tagLine:      account.tagLine,
          summonerName: summoner.name,
          profileIconId:summoner.profileIconId,
          summonerLevel:summoner.summonerLevel,
          region,
          ranked: ranked.map((r: any) => ({
            queueType:    r.queueType,
            tier:         r.tier,
            rank:         r.rank,
            leaguePoints: r.leaguePoints,
            wins:         r.wins,
            losses:       r.losses,
            winRate:      Math.round((r.wins / (r.wins + r.losses)) * 100),
          })),
        },
      });
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error("[summoner] 오류:", err);
    return NextResponse.json(
      { error: err.message || "서버 오류" },
      { status: 500 }
    );
  }
}
