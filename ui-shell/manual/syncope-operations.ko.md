# OpenSphere Apache Syncope 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1 계획 표면입니다. workforce IGA와 SCIM 2.0 프로비저닝의 단일권위로 정의합니다.

## 2. 구현 전제조건
PostgreSQL, Keycloak OIDC, Samba/LDAP, 승인 workflow와 영구 감사가 필요합니다.

## 3. 설치 계약
Syncope core, console/API, LDAP connector와 SCIM endpoint의 서명 BOM, 리소스, SecretRef와 NetworkPolicy를 확정해야 설치 버튼을 활성화합니다.

## 4. 운영 표면
Topology, connector 상태, provisioning task, consumers, 이벤트, 보호·업그레이드와 rollback을 실제 API/클러스터 상태로 표시해야 합니다.

## 5. 현재 제한
reconciler와 E2E rollback 증거가 없으므로 설치 실행은 의도적으로 잠겨 있습니다.

## 6. 참고
- https://syncope.apache.org/docs/

