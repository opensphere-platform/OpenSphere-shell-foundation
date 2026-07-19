# OpenSphere Samba AD DC 플러그인 설치 및 운영 안내서

## 1. 역할
workforce 디렉터리의 AD/LDAP capability입니다. package ID는 `samba-ad`, 사용자 경로는 `/p/foundation/addc`입니다.

## 2. 설치 순서
Kubernetes DNS·시간 동기화·영구 스토리지와 Foundation Control Plane을 확인하고 realm, domain, DNS forwarder, StorageClass와 자격 Secret을 설정합니다.

## 3. 운영 확인
AD DC Pod/Service, LDAP 389, DNS 53, Kerberos 88과 SYSVOL 상태를 확인합니다. Keycloak LDAP federation은 이 endpoint를 소비합니다.

## 4. 보호와 복구
system state와 SYSVOL 백업, 복구 절차, 시간 동기화와 단일권위 경계를 검증합니다. realm/domain 변경은 새 디렉터리 마이그레이션으로 취급합니다.

## 5. 보안
관리자 비밀번호는 SecretRef로만 전달하고 화면·ConfigMap·감사 로그에 값을 남기지 않습니다.

## 6. 참고
- https://wiki.samba.org/index.php/Setting_up_Samba_as_an_Active_Directory_Domain_Controller

