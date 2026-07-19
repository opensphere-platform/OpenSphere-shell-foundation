# OpenSphere Keycloak 플러그인 설치 및 운영 안내서

## 1. 역할
workforce IAM과 OIDC SSO capability입니다. Console용 Kanidm과 분리되며 workspace 사용자와 서비스 인증을 담당합니다.

## 2. 설치 순서
Foundation Control Plane을 확인하고 서명 BOM의 Keycloak 버전, replica, 리소스와 접근 정책을 선택합니다. 현재 development profile은 embedded H2 단일 replica만 지원합니다.

## 3. 운영 확인
Deployment/Pod/Service Ready, issuer, JWKS, realm, 이벤트와 소비 client를 확인합니다. 기본 flow는 Authorization Code + PKCE S256입니다.

## 4. 운영 경계
Production은 외부 PostgreSQL, realm export/restore, 다중 replica와 백업이 구현되기 전 허용하지 않습니다. 사용자 프로비저닝 권위는 Apache Syncope로 계획합니다.

## 5. 보안
self registration과 direct access grant는 기본 비활성입니다. Secret 값은 화면에 저장하지 않고 외부 공개는 TLS/OIDC 정책을 사용합니다.

## 6. 참고
- https://www.keycloak.org/documentation

