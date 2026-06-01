# OpenClaw 에이전트 설계 매뉴얼

> **대상 시스템:** miniland (Intel N100 / 16GB / Ubuntu Server 24.04)
> **OpenClaw 버전:** 2026.4.14 (323493f)
> **실행 주체:** `openclaw` 서비스 계정 (uid=999, nologin)
> **문서 목적:** 4-에이전트 오케스트레이션 구조의 소개, 설계 근거, 설정 레퍼런스, 운영 가이드를 단일 문서로 제공.

---

## 1. 개요

miniland의 OpenClaw는 단일 만능 에이전트가 아니라, **역할별로 분리된 4개의 에이전트**(manager / reader / worker / auditor)가 협업하는 오케스트레이션 구조다. 분리의 핵심 목적은 두 가지다.

첫째, **권한 최소화(least privilege)**. 각 에이전트는 자기 역할에 필요한 권한만 가진다. 정보를 읽는 에이전트는 코드를 실행하지 못하고, 코드를 실행하는 에이전트는 네트워크에 나가지 못한다.

둘째, **프롬프트 인젝션 전파 차단**. 가장 현실적인 위협은 "신뢰되지 않은 외부 콘텐츠(웹 페이지, 첨부 파일, skill)가 프롬프트 인젝션으로 다른 에이전트를 조작하는" 시나리오다. 외부 콘텐츠를 먼저 만지는 에이전트(reader)와 실제 실행을 담당하는 에이전트(worker)를 구조적으로 분리해, 한쪽이 오염돼도 다른 쪽으로 직접 전파되지 않게 한다.

전체 보안 설계의 상위 원칙은 **"miniland가 침해되더라도 피해가 miniland 안에 봉쇄된다"**이며, 에이전트 분리는 그 봉쇄 구조의 가장 안쪽 계층이다. 바깥 계층(네트워크 경계, 호스트 접근 제어, 서비스 계정 격리, rootless Docker 컨테이너)은 §2에서 정리한다.

---

## 2. 보안 스택 내 위치

에이전트 분리는 독립된 방어가 아니라, miniland 전체 심층 방어(defense-in-depth)의 **가장 안쪽 계층**이다. 외부 위협이 에이전트에 닿으려면 아래 계층을 순서대로 통과해야 하며, 각 계층은 서로 독립적이라 하나가 무너져도 다음 계층이 버틴다.

| 계층 | 구성 요소 | 핵심 효과 |
|------|----------|----------|
| L1 네트워크 경계 | `ip_forward=0` · UFW(deny in/out/routed) · Tailscale ACL · LAN 아웃바운드 DROP | LAN/Tailscale 전파·외부 C&C 차단 |
| L2 호스트 접근 제어 | SSH 키 전용(`restrict,from=`) · sshd 강화 · fail2ban · auditd | 침입 표면을 SSH 하나로 수렴 |
| L3 서비스 계정 격리 | `openclaw` uid=999 · nologin · sudo 없음 · 홈 `/srv/openclaw` 봉쇄 | 침해 시 피해를 `/srv/openclaw`에 봉쇄 |
| L4 컨테이너 격리 | rootless Docker · readOnlyRoot · capDrop ALL · seccomp · net none | 컨테이너 탈출·권한 상승 방어 |
| **L5 에이전트 분리** | **manager / reader / worker / auditor 권한 교차 제한** | **프롬프트 인젝션 전파 차단 (본 문서)** |

구체적인 외부 계층 값(L1~L3)은 운영 환경 기준 다음과 같다. 에이전트 설계의 전제 조건이므로 함께 명시한다.

- **L1 네트워크:** UFW 기본 정책은 incoming/outgoing/routed 모두 `deny`. 인바운드는 `tailscale0`의 22/tcp만, 아웃바운드는 53·80·443·41641(udp)만 허용. `before.rules`에서 `192.168.0.0/16` 아웃바운드를 DROP하되 공유기 DNS(192.168.1.1:53)만 예외. `ip_forward=0`으로 패킷 포워더 악용을 커널 레벨에서 차단하고, Tailscale subnet router/exit node도 비활성. 단 이 호스트 정책은 *목적지 포트*만 좁히고 *목적지 도메인*은 열어두므로, 웹 에이전트의 유출 경로는 §3.2 보완 1의 egress allowlist로 추가로 좁힌다.
- **L2 접근 제어:** `PermitRootLogin no`, `PasswordAuthentication no`, 공개키 전용. authorized_keys 키에 `restrict,pty,port-forwarding,from="192.168.1.0/24,100.64.0.0/10"` 적용. fail2ban이 SSH 브루트포스를 차단(maxretry 3, bantime 24h)하고, auditd가 sudoers·passwd·shadow·SSH키·`/srv/openclaw`·UFW 변경을 감시.
- **L3 계정:** `auspiland`(uid=1000, sudo 풀권한, admin), `ops`(uid=1002, 제한 sudo), `openclaw`(uid=999, nologin, 서비스 전용). 에이전트는 모두 `openclaw` 계정 아래에서 동작하므로, 에이전트가 무엇을 하든 그 권한 상한은 sudo 없는 uid=999다.

> Telegram Bot(KoreaUniClawbot)은 보안 알림 채널로, hourly-health.sh가 이상 탐지 시(디스크 80%·메모리 90%·fail2ban 차단·UFW 비활성·Tailscale 끊김) 알림을 보낸다. 시크릿은 `/etc/openclaw-secrets.env`(600/root)에 보관.

---

## 3. 아키텍처

### 3.1 오케스트레이션 위상

```
manager (depth 0, 오케스트레이터, default 에이전트)
   │  ── 직접 실행(exec) 권한 없음, 조율·기록만 ──
   │
   ├── reader   (depth 1)  정보 수집 — web ✓ / exec ✗
   ├── worker   (depth 1)  실행      — exec ✓ / write ✓ / net ✗   (병렬 spawn 가능)
   └── auditor  (depth 1)  검증      — exec ✓ / write ✗ / net ✗   (read-only)
```

핵심은 **에이전트 간 직접 연결이 없다**는 점이다. reader가 수집한 정보를 worker에게 넘기는 경로는 항상 manager(오케스트레이터)를 경유한다. reader → worker 직통 채널이 없으므로, reader가 오염된 콘텐츠를 읽어도 worker를 직접 조종할 수 없다.

### 3.2 권한 교차 제한 (cross-restriction)

분리 모델의 본질은 "웹 접근"과 "코드 실행"을 **같은 에이전트에 동시에 주지 않는 것**이다.

| 능력 | manager | reader | worker | auditor |
|------|:---:|:---:|:---:|:---:|
| 웹 접근 (web_search/web_fetch) | ✓ | ✓ | ✗ | ✗ |
| 코드 실행 (exec) | ✗ | ✗ | ✓ | ✓ |
| 파일 쓰기 (write/edit/apply_patch) | ✗ | ✗ | ✓ | ✗ |
| 네트워크 | egress-allow | egress-allow | **none** | **none** |

- **웹이 열린 에이전트(manager, reader)** 는 exec가 막혀 있다 → 오염된 콘텐츠를 읽어도 직접 코드를 돌릴 수 없다.
- **실행이 열린 에이전트(worker, auditor)** 는 `network: none`이다 → 악성 코드가 실행돼도 외부 C&C와 통신하거나 LAN을 스캔할 수 없다.

이 교차 구조가 위협 모델의 "에이전트 간 프롬프트 인젝션 전파"와 "외부 C&C 통신"을 동시에 끊는다.

#### 보완 1 — 웹 측의 데이터 유출 경로 차단 (egress allowlist)

교차 제한의 비대칭이 한 군데 남는다: 실행 에이전트는 `network: none`으로 **완전 차단**이지만, 웹 에이전트(manager/reader)는 호스트 방화벽이 443을 통과시키므로 **임의의 HTTPS 엔드포인트로 POST**가 가능하다. 즉 reader가 프롬프트 인젝션에 오염되면 *코드는 못 돌려도* 읽은 데이터·비밀값을 외부로 흘릴 수 있다.

따라서 웹 에이전트의 아웃바운드는 **목적지 도메인 allowlist**(Anthropic API + 지정 검색/페치 엔드포인트)로 좁힌다. egress 프록시(또는 sandbox별 DNS/방화벽)로 강제하면, 웹이 열린 쪽도 "허용된 목적지로만" 나가므로 자유로운 유출 채널이 사라진다. 이로써 교차 제한이 대칭이 된다 — **실행 쪽은 네트워크 0, 웹 쪽은 allowlist 0-trust**.

> 이 보완은 §10의 "API 키를 gateway 전역 env로 두는 편이 깔끔"과도 맞물린다. 전역 키를 두더라도 egress allowlist가 있으면, 오염된 reader가 키를 읽더라도 보낼 곳이 없다.

#### 보완 2 — manager 입력은 항상 신뢰하지 않는다

manager는 유일하게 sandbox 밖(main 세션)에서 돌고 웹도 열려 있어, 사실상 가장 가치 있는 인젝션 표적이다. exec 차단만으로 "충분"하다고 보지 않는다. reader가 돌려준 모든 콘텐츠는 **지시가 아니라 데이터로만** 취급하도록 manager 시스템 프롬프트에 명시하고, manager가 worker에게 넘기는 지시는 reader 원문이 아니라 manager가 재작성한 요약만 통과시킨다(원문 passthrough 금지).

---

## 4. 에이전트별 상세

### 4.1 manager — 설계 / 지시 / 기록 (default)

전체 흐름을 조율하는 오케스트레이터. 보고서를 기록하고 subagent를 spawn한다. 사용자와 대화하는 기본(default) 에이전트가 바로 manager다.

- **런타임:** `direct` (main 세션) — 유일하게 sandbox 컨테이너를 쓰지 않는다.
- **차단 툴:** `exec`, `apply_patch` — 조율은 하되 직접 실행/수정은 못 한다.
- **네트워크:** bridge (웹 접근 필요)
- **자원:** 메모리 상한 2g, CPU 1코어
- **워크스페이스:** `/srv/openclaw/workspace/manager` (보고서는 하위 `reports/`)

> manager가 sandbox를 쓰지 않는다는 점은 운영상 중요하다. sandbox(=Docker 세션)를 띄우는 건 reader/worker/auditor 셋뿐이다. 즉 rootless Docker가 필요한 이유는 manager가 아니라 나머지 셋의 sandbox 때문이다.

### 4.2 reader — 정보 수집

웹 검색, 문서 읽기, 첨부 파일 검토 등 **신뢰되지 않은 외부 콘텐츠를 먼저 마주하는** 에이전트. 오염 위험이 가장 높은 입구이므로 실행 권한을 전부 박탈했다.

- **런타임:** sandboxed (mode: all)
- **차단 툴:** `exec`, `write`, `edit`, `apply_patch`, `process`
- **네트워크:** bridge (외부 fetch 필요)
- **자원:** 메모리 상한 2g, CPU 1코어
- **워크스페이스:** `/srv/openclaw/workspace/reader`

### 4.3 worker — 실행

파일 수정, 코드 실행 등 실제 작업을 수행하는 에이전트. 대용량 태스크를 처리할 수 있도록 자원을 넉넉히 줬다.

- **런타임:** sandboxed (mode: all)
- **차단 툴:** `web_search`, `web_fetch` — 외부 통신 차단
- **네트워크:** **none**
- **자원:** 메모리 상한 4g, CPU 3코어 (4개 중 가장 큼)
- **워크스페이스:** `/srv/openclaw/workspace/production`

> **설계 결정:** worker 전용 디렉토리(`workspace/worker`)를 따로 두지 않고 `workspace/production`으로 통일했다. worker가 하는 일 자체가 production에서 skill을 실행하는 것이므로 분리 실익이 없다.

### 4.4 auditor — 검증 (read-only)

worker 결과물을 검증하는 에이전트. **검사는 하되 직접 고치지 않는다** — 테스트·정적분석 등 실행 권한은 갖되 파일 쓰기(`write/edit/apply_patch`)는 박탈했다. 이는 **직무 분리(separation of duties)**다: 결과를 검증하는 주체가 동시에 그 결과를 수정하면 "auditor의 수정은 누가 검증하나"라는 사각이 생긴다. auditor는 문제를 **발견·보고**만 하고, 실제 수정은 manager가 다시 worker에게 위임한다.

- **런타임:** sandboxed (mode: all)
- **차단 툴:** `web_search`, `web_fetch`, `write`, `edit`, `apply_patch`
- **네트워크:** **none**
- **자원:** 메모리 상한 1g, CPU 1코어
- **워크스페이스:** `/srv/openclaw/workspace/audit` (읽기 검증 대상은 production을 ro 마운트)

> **검증 → 수정 루프:** auditor가 결함을 찾으면 manager에게 보고하고, manager가 worker를 다시 spawn해 수정한다. "검증하는 손"과 "고치는 손"을 분리해, 자기 수정을 자기가 통과시키는 사각을 없앴다.

---

## 5. 격리 모델

에이전트 격리는 두 축으로 동작한다 — **샌드박스(컨테이너 격리)** 와 **권한 정책(툴 deny)**.

### 5.1 sandbox (rootless Docker 컨테이너)

reader/worker/auditor는 sandboxed 세션에서 동작하며, Gateway가 rootless Docker로 컨테이너를 띄운다. 컨테이너 기본 정책(`agents.defaults.sandbox.docker`)은 다음과 같다.

| 항목 | 값 | 효과 |
|------|----|----|
| `image` | `openclaw-sandbox-miniland:bookworm-slim` | 전용 최소 이미지 |
| `user` | `10001:10001` | 비루트 sandbox 사용자 (호스트 uid 999와 무충돌) |
| `readOnlyRoot` | `true` | 루트 파일시스템 읽기전용 |
| `tmpfs` | `/tmp`, `/var/tmp`, `/run` | 쓰기 가능 임시 영역만 별도 |
| `capDrop` | `ALL` | 모든 리눅스 capability 제거 |
| `pidsLimit` | `128` | 프로세스 폭주(fork bomb)·리소스 탈취 방어 |

> **`workspaceAccess: rw` + `readOnlyRoot: true` 조합:** `/workspace`만 별도 볼륨으로 rw 마운트되고 나머지 컨테이너 파일시스템은 읽기전용이다. 단, tmpfs로 workspace를 마운트할 때는 `uid=10001,gid=10001,mode=750` 옵션이 **필수**다. 없으면 root 소유로 생성되어 sandbox 사용자가 쓰지 못한다.

### 5.2 독립적인 다층 격리 (중요)

sandbox 격리는 서로 **독립적인 여러 레이어**로 구성되며, 한 레이어를 풀어도 전체가 무너지지 않는다. 이는 운영 중 실제로 검증된 사실이다.

Ubuntu 24.04 기본값인 `kernel.apparmor_restrict_unprivileged_userns=1`이 rootless Docker(rootlesskit)의 user namespace 생성을 막아 Gateway가 sandbox를 못 띄우는 문제가 있었다. 이를 해결하기 위해 sysctl을 0으로 해제(Option A)했는데, 핵심은 **이 해제가 sandbox를 끄는 게 아니라는 점**이다.

검증 방법: sandbox 컨테이너 안에서 `--cap-drop=ALL` 상태로 `unshare -U`를 실행하면 `Operation not permitted`가 반환된다. 즉 **Docker 기본 seccomp 프로파일이 컨테이너 내부의 userns 생성을 독립적으로 차단**한다. 호스트 sysctl 값과 무관하게 seccomp 계층이 별도의 봉쇄 경계를 제공하므로, sysctl 해제로 열리는 건 "호스트에서의 userns 커널 공격 경로 하나"뿐이고 readOnlyRoot·capDrop·pidsLimit 등 나머지 sandbox 보호는 그대로 동작한다.

이 결정의 트레이드오프 분석:

```
sysctl 해제로 추가되는 위험은 다음 조건이 모두 겹쳐야 현실화된다:
  1. skill/tool에 악성코드 존재
  2. sandbox 탈출 (or Gateway RCE)        ← 높은 허들
  3. 호스트에서 userns 생성
  4. 해당 시점의 커널 CVE 존재
  5. miniland 루트 탈취
       ↓
  그래도 네트워크 방어선(UFW + ip_forward=0 + Tailscale ACL)이 버티므로
  메인PC/LAN으로의 전파는 차단됨
```

결론: **sysctl 해제 + sandbox 유지**가 합리적 균형점. 정밀 AppArmor 프로파일(Option B)은 node 바이너리 경로 기준 적용의 까다로움과 OpenClaw 업데이트 시 재검토 부담 때문에 이득 대비 비용이 높아 기각했다.

### 5.3 에이전트별 제어의 한계 (운영자 필독)

OpenClaw 설정에서 **에이전트별로 제어할 수 있는 것과 없는 것**을 명확히 구분해야 한다.

```
✅ sandbox 안에서 뭘 할 수 있나   (network, exec, write 등 — 툴 정책)
✅ sandbox를 쓸지 말지            (mode: on/off)
❌ 누가 sandbox(=Docker 세션)를 띄울 수 있나
```

세 번째 제어는 존재하지 않는다. Docker API를 호출하는 주체는 특정 에이전트가 아니라 **Gateway(node) 프로세스 자체**다. manager가 "worker를 spawn해줘"라고 지시하면 Gateway가 내부적으로 Docker를 호출하는 구조이지, manager가 Docker에 직접 붙는 게 아니다. 따라서 "manager만 Docker 세션을 열게 한다" 같은 설정은 불가능하다. 에이전트 단위로 제어 가능한 건 sandbox 내부 권한과 sandbox 사용 여부뿐이다.

### 5.4 권한 정책 레이어 (tools.deny)

툴 차단은 두 레이어로 나뉜다.

- `agents.list[].tools.deny`: 전체 차단 (sandbox 여부 무관)
- `agents.list[].tools.sandbox.tools.deny`: sandbox 안에서만 추가 차단

> `sandbox explain` 출력에서 sandbox tool policy가 별도로 표시되지 않더라도(`deny (agent)`로만 보임), 실제 sandboxed 세션에서는 적용된다. (공식 문서 확인됨)

---

## 6. subagent spawn 구조 및 스키마 제약

### 6.1 spawn 제한 (defaults에서만 설정)

subagent 동시성·깊이 제한은 `agents.defaults.subagents`에만 둔다.

| 키 | 값 | 의미 |
|----|----|----|
| `maxSpawnDepth` | 2 | spawn 최대 깊이 |
| `maxChildrenPerAgent` | 5 | 에이전트당 자식 수 상한 |
| `maxConcurrent` | 8 | 동시 실행 상한 |
| `runTimeoutSeconds` | 900 | 단일 run 타임아웃 |

### 6.2 OpenClaw 2026.4.14 스키마 제약 (반드시 숙지)

이 버전에서 설계 중 부딪힌 호환성 이슈들이다. 설정 수정 시 동일한 실수를 반복하지 않도록 명시한다.

- `agents.list[].subagents`의 **per-agent에서 지원되는 키는 `model`, `thinking`뿐**이다. `maxSpawnDepth`, `maxChildrenPerAgent`, `maxConcurrent`, `runTimeoutSeconds`를 per-agent에 두면 `Unrecognized key` 에러로 config reload가 거부된다. 이들은 모두 `agents.defaults.subagents`로 옮겨야 한다.
- `agents.defaults.sandbox.docker.prune`는 2026.4.14 스키마에서 미지원 → 제거.

---

## 7. openclaw.json 설정 레퍼런스

### 7.1 핵심 구조 (발췌)

```json
{
  "agents": {
    "defaults": {
      "subagents": {
        "maxSpawnDepth": 2,
        "maxChildrenPerAgent": 5,
        "maxConcurrent": 8,
        "runTimeoutSeconds": 900
      },
      "sandbox": {
        "mode": "non-main",
        "scope": "agent",
        "docker": {
          "image": "openclaw-sandbox-miniland:bookworm-slim",
          "readOnlyRoot": true,
          "tmpfs": ["/tmp", "/var/tmp", "/run"],
          "user": "10001:10001",
          "capDrop": ["ALL"],
          "pidsLimit": 128,
          "env": { "LANG": "C.UTF-8" }
        }
      }
    },
    "list": [
      { "id": "manager", "default": true },
      { "id": "reader" },
      { "id": "worker" },
      { "id": "auditor" }
    ]
  }
}
```

### 7.2 sandbox explain 기대값

설정이 올바르면 `oc openclaw sandbox explain` 결과는 다음과 같아야 한다.

| 에이전트 | runtime | mode | 차단 툴 |
|---------|---------|------|--------|
| manager | direct (main 세션) | non-main | exec, apply_patch |
| reader | sandboxed | all | exec, write, edit, apply_patch, process |
| worker | sandboxed | all | web_search, web_fetch |
| auditor | sandboxed | all | web_search, web_fetch, write, edit, apply_patch |

> `sandbox explain`의 `workspaceRoot`가 기본값(`~/.openclaw/sandboxes`)으로 표시되는 것은 main 세션 기준 표시이며, 실제 sandboxed 세션에서는 각 에이전트 workspace가 컨테이너 `/workspace`에 마운트된다. 표시값과 실제 마운트가 다른 것은 정상이다.

---

## 8. 운영 가이드

### 8.1 명령은 `oc` 래퍼로

`openclaw` 계정은 nologin·sudo 없음이라 auspiland에서 `oc` 래퍼를 통해 명령을 실행한다.

```bash
oc openclaw doctor              # 전체 진단
oc openclaw sandbox explain     # 에이전트별 sandbox/권한 확인
oc openclaw agents              # 등록된 에이전트 목록
oc bash                         # openclaw 셸 진입
```

### 8.2 설정 변경 후 검증 루프

```bash
# 1) 설정 검증 (CLI writer는 스키마 검증 후 커밋, 실패 시 .rejected.* 로 보존)
oc openclaw config validate

# 2) Gateway 재기동
oc systemctl --user restart openclaw-gateway

# 3) 동작 확인
oc openclaw doctor
oc openclaw sandbox explain
```

### 8.3 sandbox 동작이 안 될 때 진단 순서

worker spawn 시 Docker 소켓 `permission denied`가 나는 경우, 대표 원인 두 가지를 순서대로 확인한다.

```bash
# (1) linger 확인 — 부팅 시 rootless Docker 소켓 자동 기동 여부
sudo loginctl show-user openclaw | grep Linger
# Linger=no 이면:  sudo loginctl enable-linger openclaw

# (2) Docker 소켓 존재 확인
ls -la /run/user/999/docker.sock

# (3) Gateway가 보는 환경변수 확인 (DOCKER_HOST / XDG_RUNTIME_DIR)
sudo cat /proc/$(pgrep -u openclaw node)/environ | tr '\0' '\n' | grep -E 'DOCKER|XDG'

# (4) sysctl 값 확인 (sandbox userns)
sysctl kernel.apparmor_restrict_unprivileged_userns   # → 0 이어야 정상
```

### 8.4 위험 이벤트 로깅

이미 기록되는 항목 외에, sysctl 해제로 열린 userns 생성 시도를 추적하려면 auditd 규칙을 추가한다.

```bash
# /etc/audit/rules.d/openclaw.rules 에 추가
-a always,exit -F arch=b64 -S unshare -F a0&=0x10000000 -k userns_create
```

이미 동작 중인 로깅: SSH 시도(fail2ban+journald), sudo·sudoers·passwd·SSH키·/srv/openclaw 변경(auditd), UFW 차단 패킷, Gateway stdout/stderr(journald), 시간별 헬스체크(hourly-health.sh + Telegram).

---

## 9. 설계 결정 요약 (rationale)

| 결정 | 채택 | 근거 |
|------|------|------|
| 에이전트 분리(4종) | ✅ | 권한 최소화 + 프롬프트 인젝션 전파 차단 |
| 웹/실행 교차 제한 | ✅ | reader 오염 시 exec 불가, worker 침해 시 외부통신 불가 |
| 웹 측 egress allowlist | ✅ | 실행 쪽 net=none과 대칭 — 오염된 웹 에이전트도 임의 유출 불가(보완 1) |
| auditor read-only(직무 분리) | ✅ | 검증 주체가 곧 수정 주체이면 사각 발생 → 검증/수정의 손을 분리 |
| worker = production 통일 | ✅ | worker의 일이 곧 production skill 실행, 분리 실익 없음 |
| manager는 sandbox 미사용 | ✅ | OpenClaw 구조상 main 세션 — exec 차단 + 입력 무신뢰 취급으로 보완(보완 2) |
| sysctl 해제 + sandbox 유지 | ✅ | seccomp가 독립 계층으로 userns 봉쇄, 나머지 sandbox 보호 유지 |
| 정밀 AppArmor 프로파일 | ❌ | node 경로 기준 적용 난이도 + 업데이트 시 재검토 부담 |
| 에이전트별 Docker 세션 제어 | ❌(불가) | Docker 호출은 Gateway 레벨, 스키마에 해당 제어 없음 |
| 자원 상한선(ceiling) 방식 | ✅ | 제거가 아닌 상한으로 리소스 탈취(크립토마이닝) 방어 |

---

## 10. 알려진 제약 / 주의사항

- **에이전트별 인증 비상속:** Anthropic 인증은 에이전트별이라 새 에이전트는 default(manager)의 키를 상속하지 않는다. 키를 에이전트마다 넣기 번거로우면 `~/.openclaw/.env`의 `ANTHROPIC_API_KEY`(gateway 전역 env)로 두는 편이 깔끔하다. 단 전역 키는 웹이 열린 reader도 읽을 수 있으므로, §3.2 보완 1의 egress allowlist를 함께 둬서 "키를 읽어도 보낼 곳이 없게" 만드는 것을 전제로 한다.
- **`openclaw onboard --install-daemon`은 wizard 전체를 실행한다** — 기존 config가 있는 환경에서 실행하면 onboarding 플로우가 트리거되어 config가 덮어쓰일 위험이 있다. 사용 금지.
- **`openclaw daemon *`는 systemctl을 sudo로 호출한다** — sudoers에 없는 openclaw 서비스 계정에서는 항상 실패한다. Gateway는 수동 작성한 systemd user unit으로 운영한다.
- **per-agent에 spawn 제한 키 금지** — `maxSpawnDepth` 등을 per-agent에 두면 config reload가 거부된다(§6.2).
- **SQLite 백업 시 Gateway 정지 필수** — 메모리/태스크/플로우 상태가 SQLite(WAL)라 정합성 보장을 위해 정지 후 백업.

---

## 부록. 빠른 참조

```bash
# 진단·확인
oc openclaw doctor
oc openclaw sandbox explain
oc openclaw agents
oc openclaw models status --probe

# 설정
oc openclaw config validate
oc openclaw config get agents.defaults.subagents

# Gateway 제어 (openclaw 셸 안에서)
systemctl --user status openclaw-gateway
systemctl --user restart openclaw-gateway
journalctl --user -u openclaw-gateway -f

# sandbox 이미지 빌드
sudo -u openclaw \
  XDG_RUNTIME_DIR=/run/user/999 \
  DOCKER_HOST=unix:///run/user/999/docker.sock \
  docker build \
  -t openclaw-sandbox-miniland:bookworm-slim \
  -f /srv/openclaw/docker/Dockerfile.sandbox \
  /srv/openclaw/docker/
```
