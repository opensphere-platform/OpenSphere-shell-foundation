# OpenSphere Stalwart 플러그인 계획 및 운영 안내서

## 1. 상태와 역할
현재 Phase 1입니다. SMTP/JMAP 기반 메일과 relay capability입니다.

## 2. 전제조건
DNS/MX 운영권, TLS certificate, S3 또는 영구 스토리지와 Identity federation이 필요합니다.

## 3. 설치·운영 계약
mail server, JMAP, SMTP ingress/relay, DKIM/DMARC의 버전, endpoint, 자격 Secret과 공개 정책을 확정합니다.

## 4. 운영 표면
queue, delivery failure, mailbox storage, 인증, DNS 검사와 이벤트를 실제 backend 상태로 표시해야 합니다.

## 5. 보호
메일 데이터 암호화, DKIM 키 회전, 보존·eDiscovery와 backup/restore 정책이 필요합니다.

## 6. 참고
- https://stalw.art/docs/

