import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getMatchIds, getMatchDetail } from "@/lib/riot";

// GET /api/matches?puuid=xxx&region=KR&count=20&queueId=420
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const puuid   = searchParams.get("puuid");
    const region  = searchParams.get("region")  || "KR";
    const count   = Math.min(Number(searchParams.get("count") || 20), 50);
    const queueId = searchParams.get("queueId") ? Number(searchParams.get("queueId")) : undefined;
    // queueId: 420=솔랭, 430=일반, 450=칼바람, 빈값=전체

    if (!puuid) {
      return NextResponse.json({ error: "puuid가 필요합니다." }, { status: 400 });
    }

    const conn = await pool.getConnection();
    try {
      // summoner_id 조회
      const [sumRows]: any = await conn.execute(
        "SELECT id FROM summoners WHERE puuid = ?",
        [puuid]
      );
      const summonerId = sumRows[0]?.id || null;

      // ── 1. Riot API: 매치 ID 목록 ──
      const matchIds = await getMatchIds(puuid, region, { count, queueId });
      let savedCount = 0;

      // ── 2. 각 매치 상세 조회 후 DB 저장 ──
      for (const matchId of matchIds) {
        // 이미 저장된 매치는 skip
        const [exists]: any = await conn.execute(
          "SELECT id FROM matches WHERE match_id = ?",
          [matchId]
        );
        if (exists.length > 0) continue;

        const detail = await getMatchDetail(matchId, region);
        const info   = detail.info;

        // matches 테이블 저장
        const matchDbId = crypto.randomUUID();
        await conn.execute(
          `INSERT INTO matches
             (id, match_id, game_mode, game_type, queue_id, game_duration, game_version, game_start_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?))`,
          [
            matchDbId,
            matchId,
            info.gameMode,
            info.gameType,
            info.queueId,
            info.gameDuration,
            info.gameVersion,
            Math.floor((info.gameStartTimestamp || 0) / 1000),
          ]
        );

        // match_participants 저장 (10명 전체)
        for (const p of info.participants || []) {
          // 참가자 summoner_id 조회
          const [pRows]: any = await conn.execute(
            "SELECT id FROM summoners WHERE puuid = ?",
            [p.puuid]
          );
          const pSummonerId = pRows[0]?.id || null;

          await conn.execute(
            `INSERT INTO match_participants
               (id, match_id, summoner_id, puuid, team_id, win,
                champion_id, champion_name, champion_level, position,
                kills, deaths, assists, total_damage, gold_earned,
                cs_total, vision_score, wards_placed, control_wards,
                item0, item1, item2, item3, item4, item5, item6,
                summoner1_id, summoner2_id, perk_primary, perk_sub,
                killing_sprees, largest_killing_spree,
                double_kills, triple_kills, quadra_kills, penta_kills,
                time_cc_others)
             VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              matchDbId,
              pSummonerId,
              p.puuid,
              p.teamId,
              p.win,
              p.championId,
              p.championName,
              p.champLevel,
              p.teamPosition || p.individualPosition || "",
              p.kills,
              p.deaths,
              p.assists,
              p.totalDamageDealtToChampions,
              p.goldEarned,
              p.totalMinionsKilled + p.neutralMinionsKilled,
              p.visionScore,
              p.wardsPlaced,
              p.detectorWardsPlaced || 0,
              p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6,
              p.summoner1Id,
              p.summoner2Id,
              p.perks?.styles?.[0]?.style || 0,
              p.perks?.styles?.[1]?.style || 0,
              p.killingSprees,
              p.largestKillingSpree,
              p.doubleKills,
              p.tripleKills,
              p.quadraKills,
              p.pentaKills,
              p.timeCCingOthers || 0,
            ]
          );

          // champion_stats 집계 업데이트
          if (pSummonerId) {
            await conn.execute(
              `INSERT INTO champion_stats
                 (id, summoner_id, champion_name, games, wins, kills_total, deaths_total, assists_total)
               VALUES (UUID(), ?, ?, 1, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 games         = games + 1,
                 wins          = wins + VALUES(wins),
                 kills_total   = kills_total + VALUES(kills_total),
                 deaths_total  = deaths_total + VALUES(deaths_total),
                 assists_total = assists_total + VALUES(assists_total),
                 updated_at    = CURRENT_TIMESTAMP`,
              [
                pSummonerId,
                p.championName,
                p.win ? 1 : 0,
                p.kills,
                p.deaths,
                p.assists,
              ]
            );
          }
        }

        savedCount++;
      }

      // ── 3. DB에서 해당 소환사 최근 매치 조회 ──
      const [matchRows]: any = await conn.execute(
        `SELECT
           m.match_id, m.game_mode, m.queue_id, m.game_duration, m.game_start_at,
           mp.win, mp.champion_name, mp.champion_level, mp.position,
           mp.kills, mp.deaths, mp.assists,
           mp.total_damage, mp.gold_earned, mp.cs_total, mp.vision_score,
           mp.killing_sprees, mp.penta_kills,
           ROUND((mp.kills + mp.assists) / GREATEST(mp.deaths, 1), 2) AS kda
         FROM matches m
         JOIN match_participants mp ON mp.match_id = m.id
         WHERE mp.puuid = ?
         ORDER BY m.game_start_at DESC
         LIMIT ?`,
        [puuid, count]
      );

      return NextResponse.json({
        success:    true,
        newSaved:   savedCount,
        totalFetched: matchIds.length,
        matches:    matchRows,
      });
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error("[matches] 오류:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
