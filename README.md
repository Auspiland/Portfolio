# auspiland — Portfolio

HTML 페이지로 운영하는 포트폴리오. 배포: https://auspiland.github.io/Portfolio/

홈에서 "반복해서 만난 문제 3개"를 세우고, 세 갈래(Work / Casebook / AI Operations)의 카드가 그것을 증명하는 구조다.

---

## 파일 구조

```
/
├── index.html         # 홈 — 가치 한 줄 · 문제 3개 · 세 갈래 분기 · 최소 프로필
├── projects.html      # Work — 지구다(연구) · 미디어 AI(운영) · 데이터 설계(구조) · 설비 상태 트윈(검증)
├── engineering.html   # Casebook — 스키마 계약 · 재처리 · 지표 함정 · 어댑터와 자원 회수
├── ai_ability.html    # AI Operations — OpenClaw · Paper-Trading Supervisor
├── images/            # 카드 이미지, og-home.png
├── references/        # 본문 근거 자료(설계 매뉴얼은 마스킹 공개본)
├── _reports/          # placeholder 정의서(해결됨, 기록용)
├── _old/              # 이전 버전 스냅샷 (파일명 prefix + vX.Y.Z)
├── .gitignore         # 허용 목록 방식 — 루트 전체 무시 후 위 파일만 허용
└── README.md
```

각 페이지는 CSS·JS를 인라인으로 담은 독립 HTML. 홈이 허브이고, 서브 페이지는 상단 `← Home`으로 복귀. 홈의 문제 카드는 각 페이지의 앵커(`#p-jiguda` `#p-data` `#p-twin` `#case-schema` `#case-reprocess` `#case-metric` `#openclaw` `#trading`)로 이어진다.

---

## 규칙

**HTML 수정 전** 해당 파일을 `_old/{이름}_vX.Y.Z.html`로 복사한 뒤 작업하고, 편집 후 main에 커밋·푸시한다.

**내용 규칙**
- 카드마다 내 몫·팀·AI 수행을 분리하고, 설계·프로토타입·운영 단계를 명시하고, 한계 한 줄을 둔다.
- 숫자는 카드당 최대 1개(쌍이면 1쌍). 과정 수치(배치 크기·초·테스트 개수·행 수)는 쓰지 않는다.
- 고객사·내부 도메인·테이블명·IP·비용은 쓰지 않는다. 고객은 "언론·미디어 기관", "공공 연구기관"처럼 도메인으로.

**저장소 규칙**
- `.gitignore`가 허용 목록 방식이라, 새 파일을 커밋하려면 목록에 추가해야 한다. 이미지는 확장자로 허용된다.
- `_old/`에는 HTML만 커밋된다.

## 스냅샷 현황

index v0.0.1~8 · projects v0.0.1~7 · engineering v0.0.1~9 · ai_ability v0.0.1~6
