# auspiland — Portfolio

HTML 페이지로 운영하는 포트폴리오. 프로필 홈에서 두 갈래(AI 활용 / 엔지니어링 사례)로 분기.

---

## 파일 구조

```
/
├── index.html         # 홈 — 프로필 랜딩 (여기서 아래 두 페이지로 링크)
├── ai_ability.html    # AI 활용 포트폴리오 (멀티에이전트·RAG·자동화) — 뒤로가기로 홈 복귀
├── engineering.html   # 엔지니어링 사례집 — KPF 미디어 AI 인프라 — 뒤로가기로 홈 복귀
├── images/            # info.png(프로필 원본) 등 이미지
├── references/        # 설계 매뉴얼 등 본문 근거 자료
│   ├── openclaw-agent-design-manual.md
│   ├── star_method_guide.md
│   └── engineering-rework-notes.md   # 사례집 재정리 작업 메모
├── _reports/          # 본문 placeholder(임시 더미값)의 실제 정의서
│   └── engineering-placeholders.md
├── _old/              # 이전 버전 스냅샷 (파일명 prefix + vX.Y.Z)
│   ├── index_v0.0.1.html
│   ├── ai_ability_v0.0.1~3.html
│   └── engineering_v0.0.1~2.html
└── README.md
```

각 페이지는 CSS·JS를 인라인으로 담은 독립 HTML. 홈(`index.html`)이 허브이고, 서브 페이지는 상단 `← Home` 버튼으로 복귀.

---

## 규칙

**HTML 수정 전**
`index.html`을 `_old/index_vX.Y.Z.html`로 복사한 뒤 작업.

**페이지 추가 시** (버튼 클릭으로 다른 페이지 연결)
```
/
├── index.html
├── projects.html
├── _old/
│   ├── index_v0.0.1.html
│   └── projects_v0.0.1.html
└── README.md
```
각 페이지마다 동일하게 CSS·JS 인라인, `_old/`에 파일명 prefix로 버전 보관.
