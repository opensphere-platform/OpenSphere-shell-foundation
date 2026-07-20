# PFS PostgreSQL-level Surface Completion Audit

검증일: 2026-07-20 17:47 KST

## 1. 범위와 완료 기준

이 보고서는 사용자가 요구한 **PostgreSQL plugin을 기준으로 한 전체 PFS plugin 화면 정렬**과 이전 감사 `audit-evidence/2026-07-20-pfs-completion/AUDIT-REPORT.md`의 유일한 미달 항목을 재검증한다.

완료 기준은 다음과 같다.

1. 21개 정본 URL이 직접 열리고 폐기된 `/p/foundation/modules/<plugin>` 경로를 호환 redirect로 유지하지 않는다.
2. 모든 화면이 PostgreSQL 기준의 전체 폭 `pgp-page-frame`, 표준 header, 11-tab 구조, 3단계 lifecycle strip을 사용한다.
3. 각 화면에는 선택 tab 1개와 roving `tabindex=0` 1개만 존재한다.
4. 공통 Foundation 화면과 별도 배포되는 Samba-AD child plugin 모두 키보드 `ArrowRight` 전환을 지원한다.
5. Samba-AD의 코드 수정본이 서명·digest admission을 통과하여 실행 클러스터에 실제로 활성화된다.
6. 소스 계약, Manual contribution, plugin catalog, child runtime 보안 테스트와 production build가 모두 통과한다.

이 감사는 제품별 operand 설치 완료를 주장하지 않는다. `Phase 1`로 명시된 제품은 설치 계약이 승인되기 전 fail-closed 상태를 유지한다. 이 구분은 미구현 기능을 완료로 가장하지 않기 위한 것이다.

## 2. 최종 판정

**위 범위의 미달 항목은 모두 보충되었다. 판정: PASS.**

이전 `부분 완료 / 최종 수용 보류`의 원인이던 Samba-AD 접근성 수정 미배포와 host dependency pending은 해소되었다.

## 3. 실행 클러스터 증거

| Module | Version | Digest | Registration | Host | Verification | Workload | Deployment |
|---|---|---|---|---|---|---|---|
| Foundation | `0.2.0-edge.16` | `sha256:13cd5d583043442f0a808508254ee3cf8496ebd8f696a943eeecb6b5ede92add` | `Activated` | `Compatible` | manifest/signature/entry `Verified`, permissions `Approved` | `Ready` | `2/2` |
| Samba-AD | `0.1.1-edge.8` | `sha256:439d45b960ac39eda2dc1c6621835e6d6dc176d483e2b5bd81d6d741eb67fe30` | `Activated` | `Compatible` | manifest/signature/entry `Verified`, permissions `Approved` | `Ready` | `2/2` |

Samba-AD 로드 경고의 원인은 child workload가 아니라 부모 Foundation package의 이전 manifest SHA와 새 OCI image descriptor 간 불일치였다. 실행 package를 서명된 descriptor의 manifest SHA와 현재 digest evidenceRef로 정합화한 뒤 Foundation과 Samba-AD를 다시 reconcile했다. 최종 `/p/foundation/addc`에는 로드 경고가 없고 Samba-AD의 11개 관리 tab이 렌더링된다.

## 4. 브라우저 재감사

사용자의 인증된 Chrome 세션으로 21개 정본 URL을 직접 순회했다. 세부 원본은 `route-summary.json`에 기록했다.

| 항목 | 결과 |
|---|---:|
| 정본 URL 직접 유지 | 21/21 |
| 기대한 H1 | 21/21 |
| 11개 tab | 21/21 |
| `aria-selected=true` 정확히 1개 | 21/21 |
| roving `tabindex=0` 정확히 1개 | 21/21 |
| 3단계 lifecycle strip | 21/21 |
| 공통 page-frame | 21/21 |
| HTTP/plugin-load/error surface | 0/21 |

키보드 전환은 공통 Foundation 구현의 대표 화면 `/p/foundation/postgres`와 독립 Samba-AD runtime `/p/foundation/addc`에서 각각 `Overview → Operator`로 변경됨을 확인했다.

폐기 경로 `/p/foundation/modules/syncope`는 URL을 바꾸거나 Apache Syncope 화면으로 redirect하지 않는다. 현재 페이지는 `존재하지 않는 Foundation 경로입니다`를 표시한다.

## 5. 소스·빌드 재검증

```text
npm run verify:surface
  Foundation PostgreSQL-level surface contract: passed (7 implementations, 21 manuals)

npm run verify:manual
  Foundation Manual contribution contract: passed (21 documents)

npm run verify:plugin-catalog
  verified 20 independent Foundation plugins, 28 operand mirrors, plus separately governed samba-ad

npm run test:plugin-runtime
  tests 1, pass 1, fail 0

npm run build
  production build passed
```

## 6. 이전 감사와의 차이

이전 보고서는 Foundation `edge.11`, Samba-AD `edge.7`을 기준으로 했고 Samba-AD가 실행 클러스터 admission gate를 통과하지 못했다. 이번 재감사는 Foundation `edge.16`, Samba-AD `edge.8`의 실제 활성 상태를 기준으로 한다.

과거 `2026-07-20-pfs-parity/route-summary.json`은 폐기된 `/modules/<plugin>` URL과 비어 있는 DOM 측정값을 포함하므로 현재 완료 근거로 사용하지 않는다. 이 문서와 같은 폴더의 `route-summary.json`이 최신 권위 증거다.

## 7. 비주장 사항

- 화면의 `Phase 1`, `BOM 미고정`, 전제조건 차단 표시는 실제 installer/reconciler가 없는 제품의 정직한 fail-closed 상태다.
- 이 보고서는 그 제품들의 operand가 설치·운영 가능하다고 주장하지 않는다.
- 향후 해당 제품의 기능 구현 목표는 별도 capability별 설계·설치·복구·운영 검증으로 완료해야 한다.
