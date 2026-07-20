# PostgreSQL 기준 ADDC 통합 화면 감사 보고서

검증일: 2026-07-20

기준: `/p/foundation/postgres`

대상: `/p/foundation/addc`

## 결론

이전 ADDC 화면의 좁은 콘텐츠 영역, 9개 탭, 별도 카드 구성은 제거했다. 현재 ADDC는 PostgreSQL과 동일한 전체 폭 page-frame, 헤더, 4열 메타데이터, 11개 탭, 3단계 수명주기, 3열 Overview를 사용한다. 제품 차이는 `Directory & Roles` 및 AD DC 고유 상태·정책 데이터에만 남겼다.

판정: **passed**

## 구현·릴리스

- Foundation shell: `0.2.0-edge.10`
- Foundation digest: `sha256:feedf7866ea3b9731fcfa1f6691df0df575948925db4ecbd28266887e9d9c1bc`
- Foundation source revision: `4ae9248c82ed284752de466e81b8067df21e68e3`
- Samba-AD plugin: `0.1.1-edge.6`
- Samba-AD digest: `sha256:c04f8728f31159317ee311d8f48715471a55da8bd92be77d5d4f5b0e4773e4af`
- Samba-AD source revision: `056dfd977f2d7e326d83a08a68e43deaefbf3106`
- GitHub Actions: <https://github.com/opensphere-platform/OpenSphere-shell-foundation/actions/runs/29712025995>

Foundation 이미지는 `linux/amd64`, `linux/arm64`로 발행됐으며 digest, OCI descriptor, Sigstore signature, provenance, SBOM 검증을 통과한 뒤 `os extensions install`과 `os extensions activate foundation`으로 설치·활성화했다.

## 실행 환경 시정

최초 설치 시 Dupa controller의 read-only root filesystem 때문에 Sigstore/GitHub attestation verifier가 임시 trust-root cache를 만들지 못해 `ImageProvenanceInvalid`가 발생했다. 검증을 우회하지 않고 controller에 writable `/tmp` emptyDir와 `HOME`, `GH_CONFIG_DIR`, `XDG_CACHE_HOME` 경로를 연결했다. 이후 동일 digest의 attestation 검증과 공식 extension 설치가 통과했다.

## 브라우저 대조

사용자의 로그인된 Chrome을 사용해 두 화면을 1728 × 859 동일 뷰포트에서 비교했다.

1. **Overview** — 헤더, 메타데이터, 11개 탭, 단계 스트립, 3열 패널이 동일하다.
   - 비교본: `03-postgres-addc-comparison.png`
2. **Cluster plan** — ADDC에서 탭 클릭 시 `/p/foundation/addc/cluster`로 정상 전환한다.
3. **Operator** — `/p/foundation/addc/operator`에서 `Foundation installer`와 실제 선행조건 차단 사유를 표시한다.
   - 증거: `07-addc-operator.png`
4. **Documentation** — 두 제품 모두 같은 page-frame 안에서 Console Manual Registry 문서를 제공한다.
   - 비교본: `06-postgres-addc-documentation-comparison.png`
5. **오류 점검** — 최종 Overview 복귀 후 Chrome warning/error 로그 0건이다.

## PostgreSQL과의 의도된 차이

| 영역 | PostgreSQL | ADDC |
|---|---|---|
| 제품 로고 | PostgreSQL | Samba 공식 계열 로고 |
| 도메인 탭 | Databases & Roles | Directory & Roles |
| Health | Primary/instance/storage | Active DC/realm/storage |
| 정책 | TLS, backup, pooler | Directory access, backup, credentials, LDAP security |

이 차이는 정보 구조의 불일치가 아니라 제품 고유 관리 항목이다.

## 제한 사항

ADDC operand는 아직 설치되지 않아 health는 `0%`, Operator는 선행조건 부족으로 `Blocked`를 표시한다. 이는 UI 결함이 아니라 실제 day-0 상태다. 키보드 전 경로 및 스크린리더 조합별 적합성은 별도 접근성 감사가 필요하다.

## 최종 판정

ADDC 화면은 PostgreSQL 기준 레이아웃과 탭 계약을 정확히 반영했으며, 실제 탭 전환과 문서 진입도 정상 동작한다.
