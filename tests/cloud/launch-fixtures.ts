export const launchPlan = {
  title: "퇴출 전날 주인공이 내 집 앞에서 죽었다",
  genre: "아카데미 빙의 · 미스터리 코미디",
  logline:
    "내일 퇴출될 공병 출신 빙의자가 주인공의 죽음으로 뒤집어쓴 누명을, 폐기장의 잡동사니와 뻔뻔한 협상으로 되돌린다.",
  readerPromise:
    "남들이 버린 도구와 허술한 규칙을 비틀어 고지식한 권력을 엿 먹이는 기지와, 죽은 주인공의 비밀을 푸는 역전을 준다.",
  protagonistId: "person_main",
  characters: [
    {
      id: "person_main",
      name: "카일 베르너",
      role: "퇴출 위기의 빙의자",
      desire: "누명을 벗기 전에 우선 오늘 밤 살아남고 자기 거처를 지키고 싶다.",
      contradiction:
        "냉정한 계산을 자처하면서도 눈앞의 사람을 버리지 못하고 허세를 부린다.",
      voice: "궁지일수록 상대의 말꼬리를 잡는 짧고 뻔뻔한 농담을 던진다.",
      background: "공병 출신 한도윤이 하급 귀족의 서자 카일에게 빙의했다.",
    },
  ],
  style:
    "현재 벌어진 사건을 먼저 보여 주고, 능력은 행동으로 증명한다. 독백은 건조한 계산 대신 뻔뻔한 자기변명과 욕망을 드러내며, 긴 설명을 대사와 반격으로 끊는다.",
  opening:
    "피 묻은 주인공이 문 앞에 쓰러지자 카일은 순찰의 호각 소리를 듣고 도망 대신 범인을 잡는 함정을 즉석에서 판다. 누명 속에서도 상대의 약점을 찌르는 첫 반격을 보여 준다.",
  storyEngine:
    "누명을 벗기 위한 임기응변이 더 큰 비밀을 드러내고, 작은 승리마다 새로운 상대와 위험한 거래가 따라온다.",
  worldRules: [
    "아카데미의 출입 기록은 경비의 서명과 통행증의 인장으로 함께 검증한다.",
  ],
  sourceConflicts: [],
};
export const seedPlan = {
  id: "seed-seal",
  title: "뒤집힌 통행 인장",
  plantEpisode: 9,
  payoffEpisode: 17,
  plantMethod:
    "9화에서 통행증의 인장이 뒤집혀 찍혔음을 대수롭지 않은 실수처럼 보여 준다.",
  payoffMethod:
    "17화에서 뒤집힌 인장이 경비 기록을 조작한 사람만 남길 수 있는 흔적임을 밝혀 범인의 알리바이를 무너뜨린다.",
};
export function storyBatch(start: number): any {
  const episodes = Array.from({ length: 10 }, (_, i) => ({
    number: start + i,
    title: `${start + i}화 · 함정에 걸린 약속`,
    synopsis:
      "누명을 쓴 주인공은 상대의 허술한 주장을 빈정거리며 받아치고, 버려진 도구와 기록의 빈틈을 이용해 작은 증거를 손에 넣는다. 상대의 예상 밖 반응이 더 큰 비밀을 열어 다음 사건으로 연결된다.",
    characterChange:
      "동료가 주인공의 허세 뒤에 숨은 선택을 보고 처음으로 신뢰를 보낸다.",
    endingHook:
      "되찾은 증거의 마지막 줄에서 자신을 고발한 사람의 흔적이 드러난다.",
    openingHook:
      "상대가 거짓 증거를 내미는 순간 주인공이 도망 대신 돈부터 요구한다.",
    readerPayoff:
      "잡동사니로 상대의 허점을 드러내고 누명을 씌운 경비를 자기 함정에 빠뜨린다.",
    seedPlants: [],
    seedPayoffs: [],
  }));
  const result: any = {
    summary:
      "누명과 기지의 첫 승리를 반복하며 뒤집힌 인장의 비밀을 이어가는 열 회차입니다.",
    episodes,
    seeds: [],
    worldFacts: [],
  };
  if (start === 1) {
    result.seeds = [structuredClone(seedPlan)];
    result.episodes[8].seedPlants = [
      { seedId: seedPlan.id, action: seedPlan.plantMethod },
    ];
    result.worldFacts = [
      {
        id: "fact-pass",
        statement:
          "통행증의 인장은 경비 기록과 같은 방향으로만 찍히는 장치로 검증한다.",
        introducedEpisode: 2,
      },
    ];
  }
  if (start === 11)
    result.episodes[6].seedPayoffs = [
      { seedId: seedPlan.id, action: seedPlan.payoffMethod },
    ];
  return result;
}
