const KEY = process.env.RIOT_API_KEY!;

// 지역별 호스트
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

async function riotFetch(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${separator}api_key=${KEY}`;

  console.log("최종 요청 URL:", fullUrl); // 디버깅용

  const res = await fetch(fullUrl);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Riot API 오류 [${res.status}]: ${err?.status?.message || res.statusText}`
    );
  }
  return res.json();
}

// ── 계정 관련 ──────────────────────────────────

// gameName + tagLine → puuid, gameName, tagLine
export async function getAccountByRiotId(gameName: string, tagLine: string, region = "KR") {
  const host = REGIONAL[region] || REGIONAL.KR;
  const url = `${host}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  
  console.log("호출 URL:", url);   // ← return 앞에
  console.log("API KEY:", KEY);    // ← return 앞에
  
  return riotFetch(url);           // ← 맨 마지막에
}

// puuid → 소환사 정보 (summonerId, accountId, profileIconId, summonerLevel)
export async function getSummonerByPuuid(puuid: string, region = "KR") {
  const host = PLATFORM[region] || PLATFORM.KR;
  const data = await riotFetch(`${host}/lol/summoner/v4/summoners/by-puuid/${puuid}`);
  console.log("소환사 응답 전체:", JSON.stringify(data)); // ← 추가
  return data;
}

// ── 랭크 관련 ──────────────────────────────────

// summonerId → 솔랭/자유랭 정보 배열
export async function getRankedInfo(puuid: string, region = "KR") {
  const host = PLATFORM[region] || PLATFORM.KR;
  return riotFetch(`${host}/lol/league/v4/entries/by-puuid/${puuid}`);
}

// ── 매치 관련 ──────────────────────────────────

// puuid → 최근 매치 ID 목록
export async function getMatchIds(
  puuid: string,
  region = "KR",
  options: { count?: number; queueId?: number; start?: number } = {}
) {
  const { count = 20, queueId, start = 0 } = options;
  const host = REGIONAL[region] || REGIONAL.KR;
  let url = `${host}/lol/match/v5/matches/by-puuid/${puuid}/ids?count=${count}&start=${start}`;
  if (queueId) url += `&queue=${queueId}`;
  return riotFetch(url) as Promise<string[]>;
}

// matchId → 매치 상세 정보
export async function getMatchDetail(matchId: string, region = "KR") {
  const host = REGIONAL[region] || REGIONAL.KR;
  return riotFetch(`${host}/lol/match/v5/matches/${matchId}`);
}

// ── 분석 유틸 ──────────────────────────────────

// 매치 목록 + puuid → 5가지 점수 계산
export function calcScores(matches: any[], puuid: string) {
  if (matches.length === 0) {
    return { strategy: 50, reaction: 50, teamplay: 50, creativity: 50, adaptability: 50 };
  }

  let strategy = 0, reaction = 0, teamplay = 0, creativity = 0, adaptability = 0;
  let count = 0;

  for (const match of matches) {
    const p = match.info?.participants?.find((x: any) => x.puuid === puuid);
    if (!p) continue;
    count++;

    const duration  = (match.info?.gameDuration || 1) / 60; // 분 단위
    const kda       = (p.kills + p.assists) / Math.max(p.deaths, 1);
    const csPerMin  = (p.totalMinionsKilled + p.neutralMinionsKilled) / duration;
    const vision    = p.visionScore || 0;

    // 전략 = 비전 스코어 + 어시스트 기반
    strategy += Math.min(100,
      vision * 1.2 + p.assists * 2.5 + (p.win ? 8 : 0)
    );
    // 반응 = 킬 + CC 기여
    reaction += Math.min(100,
      p.kills * 6 + (p.timeCCingOthers || 0) * 0.5 + kda * 3
    );
    // 팀플 = 어시스트 + 비전 + 제어와드
    teamplay += Math.min(100,
      p.assists * 3 + vision * 0.8 + (p.detectorWardsPlaced || 0) * 5
    );
    // 창의 = 펜타킬 + 킬링스프리 + 특이한 플레이
    creativity += Math.min(100,
      p.pentaKills * 25 + p.quadraKills * 12 + p.tripleKills * 6 +
      p.killingSprees * 4 + kda * 4
    );
    // 적응 = CS + 골드 효율 + 위치별 다양성
    adaptability += Math.min(100,
      csPerMin * 5 + (p.goldEarned / 1000) * 2 + (p.win ? 10 : 0) + kda * 2
    );
  }

  return {
    strategy:     Math.min(100, Math.round(strategy     / count)),
    reaction:     Math.min(100, Math.round(reaction     / count)),
    teamplay:     Math.min(100, Math.round(teamplay     / count)),
    creativity:   Math.min(100, Math.round(creativity   / count)),
    adaptability: Math.min(100, Math.round(adaptability / count)),
  };
}

// 점수 → 게이머 유형 코드
export function determineType(scores: ReturnType<typeof calcScores>): string {
  const entries = Object.entries(scores) as [string, number][];
  const max = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const map: Record<string, string> = {
    strategy:     "commander",
    reaction:     "attacker",
    teamplay:     "supporter",
    creativity:   "creative",
    adaptability: "adapter",
  };
  return map[max[0]] || "sniper";
}
