import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getMatchIds, getMatchDetail, calcScores, determineType } from "@/lib/riot";
// 분석유형및 분석데이터를 들고오는 페이지
// POST /api/analyze
// body: { puuid, region }
export async function POST(req: NextRequest) {
  try {
    const { puuid, region = "KR" } = await req.json();

    if (!puuid) {
      return NextResponse.json({ error: "puuid가 필요합니다." }, { status: 400 });
    }

    const conn = await pool.getConnection();
    try {
      // summoner_id 확인
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

      // ── 1. 최근 20경기 매치 데이터 수집 ──
      const matchIds = await getMatchIds(puuid, region, { count: 20, queueId: 420 }); // 솔랭 기준
      const matchDetails: any[] = [];

      for (const matchId of matchIds) {
        const detail = await getMatchDetail(matchId, region);
        matchDetails.push(detail);
      }

      // ── 2. 점수 계산 ──
      const scores   = calcScores(matchDetails, puuid);
      const typeCode = determineType(scores);

      // ── 3. 유형 ID 조회 ──
      const [typeRows]: any = await conn.execute(
        "SELECT id, name_ko, color_hex, icon, description FROM gamer_types WHERE code = ?",
        [typeCode]
      );
      const gamerType = typeRows[0];

      // ── 4. 분석 결과 저장 ──
      const resultId = crypto.randomUUID();
      await conn.execute(
        `INSERT INTO analysis_results
           (id, summoner_id, gamer_type_id,
            strategy_score, reaction_score, teamplay_score,
            creativity_score, adaptability_score, match_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ]
      );

      return NextResponse.json({
        success: true,
        analysis: {
          id: resultId,
          gamerType: {
            code:        typeCode,
            name:        gamerType?.name_ko,
            description: gamerType?.description,
            color:       gamerType?.color_hex,
            icon:        gamerType?.icon,
          },
          scores,
          matchCount: matchDetails.length,
        },
      });
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error("[analyze] 오류:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/analyze?summonerId=xxx  (이전 분석 결과 조회)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const summonerId = searchParams.get("summonerId");

    if (!summonerId) {
      return NextResponse.json({ error: "summonerId가 필요합니다." }, { status: 400 });
    }

    const conn = await pool.getConnection();
    try {
      const [rows]: any = await conn.execute(
        `SELECT
           ar.id, ar.analyzed_at, ar.match_count,
           ar.strategy_score, ar.reaction_score, ar.teamplay_score,
           ar.creativity_score, ar.adaptability_score,
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
