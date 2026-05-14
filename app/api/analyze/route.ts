import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getMatchIds,
  fetchMatchesWithDelay,
  calcLaneDistribution,
  calcScores,
  determineType,
} from "@/lib/riot";

export const maxDuration = 60;

// POST /api/analyze
export async function POST(req: NextRequest) {
  try {
    const { puuid, region = "KR" } = await req.json();

    if (!puuid) {
      return NextResponse.json(
        { error: "puuid가 필요합니다." },
        { status: 400 }
      );
    }

    const conn = await pool.getConnection();
    try {
      // ── summoner_id 확인 ──
      const [sumRows]: any = await conn.execute(
        "SELECT id FROM summoners WHERE puuid = ?",
        [puuid]
      );
      if (sumRows.length === 0) {
        return NextResponse.json(
          { error: "먼저 /api/summoner 를 호출해 소환사 정보를 등록하세요." },
          { status: 404 }
        );
      }
      const summonerId = sumRows[0].id;

      // ── 1. 매치 수집 ──
      const matchIds = await getMatchIds(puuid, region, { count: 10 });
      const matchDetails = await fetchMatchesWithDelay(matchIds, region, 1200);

      // ── 2. 라인 분포 계산 ──
      const laneDistribution = calcLaneDistribution(matchDetails, puuid);
      console.log("laneDistribution:", JSON.stringify(laneDistribution));

      // ── 3. 기본 점수 계산 (라인 미지정) ──
      const baseScores = matchDetails.length > 0
        ? calcScores(matchDetails, puuid)
        : { strategy: 50, reaction: 50, teamplay: 50, creativity: 50, adaptability: 50 };
      console.log("baseScores:", JSON.stringify(baseScores));

      // ── 4. 유형 결정 ──
      const typeResult = determineType(laneDistribution, baseScores);
      console.log("typeResult:", JSON.stringify(typeResult));

      // ── 5. 주 라인 기준 점수 재계산 ──
      const scores = matchDetails.length > 0
        ? calcScores(matchDetails, puuid, typeResult.primaryLane)
        : baseScores;
      console.log("scores:", JSON.stringify(scores));

      // ── 6. 유형 코드로 DB 조회 ──
      const [typeRows]: any = await conn.execute(
        "SELECT id, name_ko, color_hex, icon, description FROM gamer_types WHERE code = ?",
        [typeResult.code]
      );
      const gamerType = typeRows[0];

      // ── 7. 분석 결과 DB 저장 ──
      const resultId = crypto.randomUUID();
      await conn.execute(
        `INSERT INTO analysis_results
           (id, summoner_id, gamer_type_id,
            strategy_score, reaction_score, teamplay_score,
            creativity_score, adaptability_score, match_count,
            primary_lane, secondary_lane, lane_distribution, type_category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          resultId,
          summonerId,
          gamerType?.id || null,
          scores.strategy,
          scores.reaction,
          scores.teamplay,
          scores.creativity,
          scores.adaptability,
          matchDetails.length,
          typeResult.primaryLane,
          typeResult.secondaryLane,
          JSON.stringify(laneDistribution),
          typeResult.category,
        ]
      );

      // ── 8. 결과 반환 ──
      return NextResponse.json({
        success: true,
        analysis: {
          id: resultId,
          gamerType: {
            code: typeResult.code,
            name: gamerType?.name_ko || typeResult.code,
            description: gamerType?.description,
            color: gamerType?.color_hex || "#00e5ff",
            icon: gamerType?.icon || "🎮",
            category: typeResult.category,
          },
          scores,
          laneDistribution,
          primaryLane: typeResult.primaryLane,
          secondaryLane: typeResult.secondaryLane,
          matchCount: matchDetails.length,
        },
      });

    } finally {
      conn.release();
    }

  } catch (err: any) {
    console.error("[analyze] 오류:", err.message);
    return NextResponse.json(
      { error: err.message || "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// GET /api/analyze?summonerId=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const summonerId = searchParams.get("summonerId");

    if (!summonerId) {
      return NextResponse.json(
        { error: "summonerId가 필요합니다." },
        { status: 400 }
      );
    }

    const conn = await pool.getConnection();
    try {
      const [rows]: any = await conn.execute(
        `SELECT
           ar.id, ar.analyzed_at, ar.match_count,
           ar.strategy_score, ar.reaction_score, ar.teamplay_score,
           ar.creativity_score, ar.adaptability_score,
           ar.primary_lane, ar.secondary_lane,
           ar.lane_distribution, ar.type_category,
           gt.code AS type_code, gt.name_ko AS type_name,
           gt.color_hex, gt.icon, gt.description
         FROM analysis_results ar
         LEFT JOIN gamer_types gt ON ar.gamer_type_id = gt.id
         WHERE ar.summoner_id = ?
         ORDER BY ar.analyzed_at DESC
         LIMIT 5`,
        [summonerId]
      );

      return NextResponse.json({ success: true, results: rows });
    } finally {
      conn.release();
    }

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "서버 오류" },
      { status: 500 }
    );
  }
}