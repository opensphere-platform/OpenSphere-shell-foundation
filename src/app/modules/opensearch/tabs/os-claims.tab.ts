import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ClaimsListComponent } from '../../claims-list.component';

// OpenSearchIndexClaim — 목록 + Accept-stub 안내(write-path는 operator 승격까지 연기).
@Component({
  selector: 'os-claims',
  standalone: true,
  imports: [CommonModule, ClaimsListComponent],
  template: `
    <div class="claim-deny">ⓘ OpenSearch write-path는 <b>operator 승격 후 활성</b>됩니다. 현 plain single-node엔 선언형 인덱스 CRD가 없어(ADR-005), MVP는 CRD·목록·Accept-stub만. 인덱스는 앱이 클라이언트로 lazy-create(auto-create-index ON).</div>
    <div class="sec-h">OpenSearchIndexClaims</div>
    <app-claims-list kind="os" plural="opensearchindexclaims" primaryLabel="인덱스" detailLabel="endpoint"></app-claims-list>
  `,
})
export class OsClaimsTab {}
