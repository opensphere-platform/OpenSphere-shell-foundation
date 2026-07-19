# OpenSphere Mattermost 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. workspace 협업, bot과 ChatOps 채널 capability입니다.

## 2. 전제조건
PostgreSQL, S3, OIDC와 Ingress 정책이 필요합니다.

## 3. 설치·운영 계약
server, WebSocket endpoint, plugin runtime과 object-storage binding의 버전·digest·리소스를 확정합니다. team, channel, bot, webhook, 파일 저장과 이벤트를 실제 API 상태로 표시합니다.

## 4. 보호
메시지 보존, 파일 백업, 외부 공개 TLS/OIDC, bot token 회전과 감사 정책이 필요합니다.

## 5. 현재 제한
WorkspaceClaim과 storage/identity binding이 준비되기 전 설치는 잠깁니다.

## 6. 참고
- https://docs.mattermost.com/

