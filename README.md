# auspiland — Portfolio

단일 HTML 파일로 운영하는 AI 엔지니어링 포트폴리오.

---

## 파일 구조

```
/
├── index.html        # 메인 페이지 (CSS·JS 모두 인라인)
├── _old/             # 이전 버전 스냅샷
│   └── index_v0.0.1.html
└── README.md
```

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
