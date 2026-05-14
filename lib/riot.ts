const KEY = process.env.RIOT_API_KEY!;

const PLATFORM: Record<string, string> = {
  KR:   "https://kr.api.riotgames.com",
  NA:   "https://na1.api.riotgames.com",
  EUW:  "https://euw1.api.riotgames.com",
  EUNE: "https://eun1.api.riotgames.com",
  JP:   "https://jp1.api.riotgames.com",
};
const REGIONAL: Record<string, string> = {
  KR:   "https://asia.api.riotgames.com",
  JP:   "https://asia.api.riotgames.com",
  NA:   "https://americas.api.riotgames.com",
  EUW:  "https://europe.api.riotgames.com",
  EUNE: "https://europe.api.riotgames.com",
};

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function riotFetch(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${separator}api_key=${KEY}`;
  const res = await fetch(fullUrl);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Riot API 오류 [${res.status}]: ${err?.status?.message || res.statusText}`);
  }
  return res.json();
}

// ── API 함수들 ──
export async function getAccountByRiotId(gameName: string, tagLine: string, region = "KR") {
  const host = REGIONAL[region] || REGIONAL.KR;
  const url = `${host}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  console.log("호출 URL:", url);
  return riotFetch(url);
}

export async function getSummonerByPuuid(puuid: string, region = "KR") {
  const host = PLATFORM[region] || PLATFORM.KR;
  const data = await riotFetch(`${host}/lol/summoner/v4/summoners/by-puuid/${puuid}`);
  console.log("소환사 응답 전체:", JSON.stringify(data));
  return data;
}

export async function getRankedInfo(puuid: string, region = "KR") {
  const host = PLATFORM[region] || PLATFORM.KR;
  return riotFetch(`${host}/lol/league/v4/entries/by-puuid/${puuid}`);
}

export async function getMatchIds(
  puuid: string, region = "KR",
  options: { count?: number; queueId?: number; start?: number } = {}
) {
  const { count = 10, queueId, start = 0 } = options;
  const host = REGIONAL[region] || REGIONAL.KR;
  let url = `${host}/lol/match/v5/matches/by-puuid/${puuid}/ids?count=${count}&start=${start}`;
  if (queueId) url += `&queue=${queueId}`;
  return riotFetch(url) as Promise<string[]>;
}

export async function getMatchDetail(matchId: string, region = "KR") {
  const host = REGIONAL[region] || REGIONAL.KR;
  return riotFetch(`${host}/lol/match/v5/matches/${matchId}`);
}

export async function fetchMatchesWithDelay(
  matchIds: string[], region = "KR", delayMs = 1200
): Promise<any[]> {
  const results: any[] = [];
  for (const matchId of matchIds) {
    const detail = await getMatchDetail(matchId, region);
    results.push(detail);
    await delay(delayMs);
  }
  return results;
}

// ══════════════════════════════════════════════
// 라인 분포 계산
// ══════════════════════════════════════════════
export interface LaneDistribution {
  TOP: number; JG: number; MID: number; BOT: number; SUP: number;
}

export function calcLaneDistribution(matches: any[], puuid: string): LaneDistribution {
  const counts = { TOP: 0, JG: 0, MID: 0, BOT: 0, SUP: 0 };
  let total = 0;

  for (const match of matches) {
    const p = match.info?.participants?.find((x: any) => x.puuid === puuid);
    if (!p) continue;
    total++;
    const pos = (p.teamPosition || p.individualPosition || "").toUpperCase();
    if      (pos === "TOP")     counts.TOP++;
    else if (pos === "JUNGLE")  counts.JG++;
    else if (pos === "MIDDLE")  counts.MID++;
    else if (pos === "BOTTOM")  counts.BOT++;
    else if (pos === "UTILITY") counts.SUP++;
  }

  if (total === 0) return { TOP: 0, JG: 0, MID: 0, BOT: 0, SUP: 0 };

  return {
    TOP: Math.round((counts.TOP / total) * 100),
    JG:  Math.round((counts.JG  / total) * 100),
    MID: Math.round((counts.MID / total) * 100),
    BOT: Math.round((counts.BOT / total) * 100),
    SUP: Math.round((counts.SUP / total) * 100),
  };
}

// ══════════════════════════════════════════════
// 라인별 특화 점수 계산 시스템
// ══════════════════════════════════════════════
// 각 라인마다 다른 지표를 중점적으로 측정

export interface Scores {
  strategy:     number; // 전략 (비전, 어시스트, 오브젝트)
  reaction:     number; // 반응 (킬, CC, 교전)
  teamplay:     number; // 팀플 (어시스트, 힐, 보호)
  creativity:   number; // 창의 (펜타킬, 킬링스프리, 예측불가)
  adaptability: number; // 적응 (CS, 골드효율, 상황대응)
}

export function calcScores(matches: any[], puuid: string, lane?: string): Scores {
  const laneMap: Record<string, string> = {
    TOP: "TOP", JG: "JUNGLE", MID: "MIDDLE", BOT: "BOTTOM", SUP: "UTILITY"
  };

  const filtered = lane
    ? matches.filter(m => {
        const p = m.info?.participants?.find((x: any) => x.puuid === puuid);
        const pos = (p?.teamPosition || p?.individualPosition || "").toUpperCase();
        return pos === laneMap[lane];
      })
    : matches;

  if (filtered.length === 0) {
    return { strategy: 50, reaction: 50, teamplay: 50, creativity: 50, adaptability: 50 };
  }

  let strategy = 0, reaction = 0, teamplay = 0, creativity = 0, adaptability = 0;
  let count = 0;

  for (const match of filtered) {
    const p = match.info?.participants?.find((x: any) => x.puuid === puuid);
    if (!p) continue;
    count++;

    const duration  = Math.max((match.info?.gameDuration || 1) / 60, 1);
    const kda       = (p.kills + p.assists) / Math.max(p.deaths, 1);
    const csPerMin  = (p.totalMinionsKilled + (p.neutralMinionsKilled || 0)) / duration;
    const vision    = p.visionScore || 0;
    const dmgToChamp = p.totalDamageDealtToChampions || 0;
    const dmgTaken  = p.totalDamageTaken || 0;
    const heals     = p.totalHealsOnTeammates || 0;
    const shields   = p.totalDamageShieldedOnTeammates || 0;
    const ccTime    = p.timeCCingOthers || 0;
    const wards     = p.wardsPlaced || 0;
    const ctrlWards = p.detectorWardsPlaced || 0;
    const winBonus  = p.win ? 10 : 0;

    // ── 라인별 특화 계산 ──
    switch (lane) {

      // ─ TOP: 탱킹 vs 결투 vs 스플릿 ─
      case "TOP":
        strategy     += Math.min(100, ccTime * 2 + p.assists * 2 + dmgTaken / 3000 + winBonus);
        reaction     += Math.min(100, p.kills * 7 + kda * 4 + dmgToChamp / 2000);
        teamplay     += Math.min(100, p.assists * 4 + dmgTaken / 2500 + (heals + shields) / 500);
        creativity   += Math.min(100, p.pentaKills * 25 + p.quadraKills * 12 + p.killingSprees * 5 + kda * 3);
        adaptability += Math.min(100, csPerMin * 6 + p.kills * 3 + winBonus);
        break;

      // ─ JG: 갱킹 vs 오브젝트 vs 파밍 ─
      case "JG":
        strategy     += Math.min(100, vision * 1.5 + p.assists * 3 + ctrlWards * 6 + winBonus);
        reaction     += Math.min(100, p.kills * 8 + ccTime * 1.5 + kda * 3);
        teamplay     += Math.min(100, p.assists * 5 + vision * 0.8 + winBonus);
        creativity   += Math.min(100, p.pentaKills * 30 + p.killingSprees * 6 + kda * 5);
        adaptability += Math.min(100, csPerMin * 8 + (p.goldEarned / 1000) * 2 + winBonus);
        break;

      // ─ MID: 로밍 vs 암살 vs 포킹 ─
      case "MID":
        strategy     += Math.min(100, p.assists * 4 + vision * 1.2 + wards * 2 + winBonus);
        reaction     += Math.min(100, p.kills * 7 + kda * 5 + dmgToChamp / 1800);
        teamplay     += Math.min(100, p.assists * 3 + vision * 1.5 + winBonus);
        creativity   += Math.min(100, p.pentaKills * 25 + p.quadraKills * 10 + p.killingSprees * 5 + kda * 4);
        adaptability += Math.min(100, csPerMin * 5 + (p.goldEarned / 1000) * 3 + kda * 3 + winBonus);
        break;

      // ─ BOT: 안전형 vs 후반형 vs 교전형 ─
      case "BOT":
        strategy     += Math.min(100, vision * 1.0 + p.assists * 2 + winBonus);
        reaction     += Math.min(100, p.kills * 6 + kda * 4 + dmgToChamp / 1500);
        teamplay     += Math.min(100, p.assists * 3 + (heals + shields) / 300 + winBonus);
        creativity   += Math.min(100, p.pentaKills * 30 + p.quadraKills * 15 + p.killingSprees * 6 + kda * 5);
        adaptability += Math.min(100, csPerMin * 7 + (p.goldEarned / 1000) * 3 + winBonus);
        break;

      // ─ SUP: 보호형 vs 이니시형 vs 시야형 ─
      case "SUP":
        strategy     += Math.min(100, vision * 2.0 + wards * 2.5 + ctrlWards * 8 + winBonus);
        reaction     += Math.min(100, ccTime * 3 + p.kills * 5 + p.assists * 2 + kda * 3);
        teamplay     += Math.min(100, p.assists * 5 + (heals + shields) / 200 + vision * 1.0 + winBonus);
        creativity   += Math.min(100, p.pentaKills * 20 + p.killingSprees * 4 + kda * 6);
        adaptability += Math.min(100, vision * 1.5 + p.assists * 3 + ctrlWards * 5 + winBonus);
        break;

      // ─ 라인 미지정 (공통) ─
      default:
        strategy     += Math.min(100, vision * 1.2 + p.assists * 2.5 + winBonus);
        reaction     += Math.min(100, p.kills * 6 + ccTime * 0.5 + kda * 3);
        teamplay     += Math.min(100, p.assists * 3 + vision * 0.8 + ctrlWards * 5);
        creativity   += Math.min(100, p.pentaKills * 25 + p.quadraKills * 12 + p.killingSprees * 4 + kda * 4);
        adaptability += Math.min(100, csPerMin * 5 + (p.goldEarned / 1000) * 2 + winBonus + kda * 2);
    }
  }

  return {
    strategy:     Math.min(100, Math.round(strategy     / count)),
    reaction:     Math.min(100, Math.round(reaction     / count)),
    teamplay:     Math.min(100, Math.round(teamplay     / count)),
    creativity:   Math.min(100, Math.round(creativity   / count)),
    adaptability: Math.min(100, Math.round(adaptability / count)),
  };
}

// ══════════════════════════════════════════════
// 유형 결정 알고리즘 (23가지)
// ══════════════════════════════════════════════
export interface TypeResult {
  code:          string;
  category:      "single" | "dual" | "multi";
  primaryLane:   string;
  secondaryLane: string;
}

export function determineType(lane: LaneDistribution, scores: Scores): TypeResult {
  const sorted = (Object.entries(lane) as [string, number][]).sort((a, b) => b[1] - a[1]);
  const [topLane,   topPct]   = sorted[0];
  const [secLane,   secPct]   = sorted[1];
  const [, thirdPct]          = sorted[2];

  // 단일: 1개 라인 70% 이상
  if (topPct >= 70) {
    return { code: getSingleType(topLane, scores), category: "single", primaryLane: topLane, secondaryLane: secLane };
  }
  // 멀티: 3개 라인 각 20% 이상
  if (thirdPct >= 20) {
    return { code: getMultiType(scores), category: "multi", primaryLane: topLane, secondaryLane: secLane };
  }
  // 듀얼: 상위 2개 합 70% 이상
  if (topPct + secPct >= 70) {
    return { code: getDualType(topLane, secLane), category: "dual", primaryLane: topLane, secondaryLane: secLane };
  }
  // 기본값
  return { code: getSingleType(topLane, scores), category: "single", primaryLane: topLane, secondaryLane: secLane };
}

// ── 단일 유형 세부 결정 ──
function getSingleType(lane: string, s: Scores): string {
  const max = Math.max(s.strategy, s.reaction, s.teamplay, s.creativity, s.adaptability);

  switch (lane) {
    case "TOP":
      if (max === s.teamplay)              return "TOP_TANK";     // 철벽 수호자
      if (max === s.reaction)              return "TOP_DUELIST";  // 고독한 싸움꾼
      return "TOP_SPLIT";                                         // 분열자(애매함)

    case "JG":
      if (max === s.reaction)              return "JG_GANKER";    // 갱킹 사냥꾼
      if (max === s.strategy)              return "JG_OBJ";       // 마에스트로
      return "JG_FARMER";                                         // 농부

    case "MID":
      if (max === s.strategy)              return "MID_ROAMER";   // 유랑자
      if (max === s.reaction ||
          max === s.creativity)            return "MID_ASSASSIN"; // 암살자 본능
      return "MID_MAGE";                                          // 포킹 전문가

    case "BOT":
      if (max === s.adaptability)          return "BOT_SNIPER";   // 안전 주의자
      if (max === s.creativity)            return "BOT_HYPER";    // 하이퍼 캐리
      return "BOT_FIGHTER";                                       // 파이터

    case "SUP":
      if (max === s.teamplay)              return "SUP_HEALER";   // 수호천사
      if (max === s.reaction)              return "SUP_ENGAGE";   // 파괴공작원
      return "SUP_VISION";                                        // 시아 수집가

    default:
      return "MULTI_FLEX";
  }
}

// ── 듀얼 유형 결정 ──
function getDualType(lane1: string, lane2: string): string {
  const combo = [lane1, lane2].sort().join("_");
  const map: Record<string, string> = {
    "JG_TOP":  "DUAL_TOP_JG",
    "JG_MID":  "DUAL_MID_JG",
    "BOT_SUP": "DUAL_BOT_SUP",
    "MID_TOP": "DUAL_TOP_MID",
    "MID_SUP": "DUAL_MID_SUP",
  };
  return map[combo] || "MULTI_FLEX";
}

// ── 멀티 유형 결정 ──
function getMultiType(s: Scores): string {
  if (s.reaction > s.teamplay + 10) return "MULTI_CARRY_FLEX";
  if (s.teamplay > s.reaction + 10) return "MULTI_SUPPORT_FLEX";
  return "MULTI_FLEX";
}
