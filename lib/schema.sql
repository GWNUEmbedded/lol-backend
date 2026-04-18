CREATE DATABASE IF NOT EXISTS lol_analyzer;
USE lol_analyzer;

-- ① 소환사 테이블
CREATE TABLE IF NOT EXISTS summoners (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  puuid         VARCHAR(100)  NOT NULL UNIQUE  COMMENT 'Riot PUUID',
  summoner_id   VARCHAR(100)  COMMENT 'Riot Summoner ID',
  account_id    VARCHAR(100)  COMMENT 'Riot Account ID',
  game_name     VARCHAR(50)   NOT NULL         COMMENT '게임 이름',
  tag_line      VARCHAR(10)   NOT NULL         COMMENT '태그 (#KR1 등)',
  summoner_name VARCHAR(50)   COMMENT '소환사 이름',
  profile_icon_id INT         DEFAULT 0,
  summoner_level  INT         DEFAULT 0,
  region        VARCHAR(10)   NOT NULL DEFAULT 'KR',
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_puuid (puuid),
  INDEX idx_game_name_tag (game_name, tag_line)
);

-- ② 랭크 정보 테이블
CREATE TABLE IF NOT EXISTS ranked_info (
  id            CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  summoner_id   CHAR(36)    NOT NULL,
  queue_type    VARCHAR(30) NOT NULL   COMMENT 'RANKED_SOLO_5x5 | RANKED_FLEX_SR',
  tier          VARCHAR(15)            COMMENT 'IRON~CHALLENGER',
  rank_division VARCHAR(5)             COMMENT 'I II III IV',
  league_points INT         DEFAULT 0,
  wins          INT         DEFAULT 0,
  losses        INT         DEFAULT 0,
  updated_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (summoner_id) REFERENCES summoners(id) ON DELETE CASCADE,
  UNIQUE KEY unique_summoner_queue (summoner_id, queue_type)
);

-- ③ 매치 기록 테이블
CREATE TABLE IF NOT EXISTS matches (
  id            CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  match_id      VARCHAR(20) NOT NULL UNIQUE  COMMENT 'KR_12345678',
  game_mode     VARCHAR(30)              COMMENT 'CLASSIC | ARAM 등',
  game_type     VARCHAR(30)              COMMENT 'MATCHED_GAME 등',
  queue_id      INT         DEFAULT 0    COMMENT '420=솔랭, 430=일반, 450=칼바람',
  game_duration INT         DEFAULT 0    COMMENT '초 단위',
  game_version  VARCHAR(20)              COMMENT '패치 버전',
  game_start_at TIMESTAMP,
  created_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_match_id (match_id)
);

-- ④ 매치 참가자 상세 테이블 (핵심)
CREATE TABLE IF NOT EXISTS match_participants (
  id              CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  match_id        CHAR(36)    NOT NULL,
  summoner_id     CHAR(36),
  puuid           VARCHAR(100) NOT NULL,
  team_id         INT                      COMMENT '100=블루팀, 200=레드팀',
  win             BOOLEAN     DEFAULT FALSE,
  champion_id     INT         DEFAULT 0,
  champion_name   VARCHAR(50),
  champion_level  INT         DEFAULT 0,
  position        VARCHAR(20)              COMMENT 'TOP MID JUNGLE BOT SUPPORT',
  kills           INT         DEFAULT 0,
  deaths          INT         DEFAULT 0,
  assists         INT         DEFAULT 0,
  total_damage    INT         DEFAULT 0    COMMENT '챔피언에게 입힌 피해',
  gold_earned     INT         DEFAULT 0,
  cs_total        INT         DEFAULT 0    COMMENT '미니언+정글 킬 합계',
  vision_score    INT         DEFAULT 0,
  wards_placed    INT         DEFAULT 0,
  control_wards   INT         DEFAULT 0,
  item0           INT         DEFAULT 0,
  item1           INT         DEFAULT 0,
  item2           INT         DEFAULT 0,
  item3           INT         DEFAULT 0,
  item4           INT         DEFAULT 0,
  item5           INT         DEFAULT 0,
  item6           INT         DEFAULT 0,  -- 장신구
  summoner1_id    INT         DEFAULT 0,
  summoner2_id    INT         DEFAULT 0,
  perk_primary    INT         DEFAULT 0    COMMENT '메인 룬',
  perk_sub        INT         DEFAULT 0    COMMENT '서브 룬',
  killing_sprees  INT         DEFAULT 0,
  largest_killing_spree INT  DEFAULT 0,
  double_kills    INT         DEFAULT 0,
  triple_kills    INT         DEFAULT 0,
  quadra_kills    INT         DEFAULT 0,
  penta_kills     INT         DEFAULT 0,
  time_cc_others  INT         DEFAULT 0    COMMENT 'CC 기여 시간(초)',
  FOREIGN KEY (match_id)    REFERENCES matches(id)    ON DELETE CASCADE,
  FOREIGN KEY (summoner_id) REFERENCES summoners(id)  ON DELETE SET NULL,
  INDEX idx_puuid      (puuid),
  INDEX idx_match_id   (match_id),
  INDEX idx_champion   (champion_name)
);

-- ⑤ 챔피언 통계 (소환사별 집계)
CREATE TABLE IF NOT EXISTS champion_stats (
  id              CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  summoner_id     CHAR(36)    NOT NULL,
  champion_name   VARCHAR(50) NOT NULL,
  games           INT         DEFAULT 0,
  wins            INT         DEFAULT 0,
  kills_total     INT         DEFAULT 0,
  deaths_total    INT         DEFAULT 0,
  assists_total   INT         DEFAULT 0,
  updated_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (summoner_id) REFERENCES summoners(id) ON DELETE CASCADE,
  UNIQUE KEY unique_summoner_champion (summoner_id, champion_name)
);

-- ⑥ 게이머 유형 테이블
CREATE TABLE IF NOT EXISTS gamer_types (
  id              CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  code            VARCHAR(30) NOT NULL UNIQUE,
  name_ko         VARCHAR(50) NOT NULL,
  description     TEXT,
  color_hex       VARCHAR(7),
  icon            VARCHAR(10)
);

INSERT INTO gamer_types (code, name_ko, description, color_hex, icon) VALUES
('attacker',  '공격형 돌격수',   '빠른 판단과 과감한 플레이. 팀의 선봉장.', '#ff4066', '⚔️'),
('commander', '전략적 지휘관',   '냉철한 분석으로 팀을 이끄는 리더.',       '#00e5ff', '🛡️'),
('sniper',    '정밀 저격수',     '극한의 집중력과 정확성의 소유자.',         '#ffd91a', '🎯'),
('supporter', '협력형 서포터',   '팀원을 살리고 승리를 설계한다.',           '#1aff99', '🌿'),
('creative',  '창의적 플레이어', '예측불가 창의력으로 판을 바꾼다.',         '#8c33ff', '🔮'),
('adapter',   '반응형 어댑터',   '상황 변화에 가장 빠르게 적응한다.',        '#ff8c1a', '⚡')
ON DUPLICATE KEY UPDATE code=code;

-- ⑦ 분석 결과 테이블
CREATE TABLE IF NOT EXISTS analysis_results (
  id                  CHAR(36)  PRIMARY KEY DEFAULT (UUID()),
  summoner_id         CHAR(36)  NOT NULL,
  gamer_type_id       CHAR(36),
  strategy_score      INT       DEFAULT 0,
  reaction_score      INT       DEFAULT 0,
  teamplay_score      INT       DEFAULT 0,
  creativity_score    INT       DEFAULT 0,
  adaptability_score  INT       DEFAULT 0,
  match_count         INT       DEFAULT 0  COMMENT '분석에 사용된 매치 수',
  analyzed_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (summoner_id)   REFERENCES summoners(id)    ON DELETE CASCADE,
  FOREIGN KEY (gamer_type_id) REFERENCES gamer_types(id)  ON DELETE SET NULL
);
