import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ClaimsListComponent } from '../../claims-list.component';
import { NewClaimFormComponent } from '../../new-claim-form.component';

// Claims 탭 — 기존 new-claim-form + claims-list 래핑(우리 고유 provisioning 모델).
@Component({
  selector: 'pg-claims',
  standalone: true,
  imports: [CommonModule, ClaimsListComponent, NewClaimFormComponent],
  template: `
    <p class="os-sub">PostgresClaim — 선언만 하면 전용 StackGres SGCluster·DB·role·연결 Secret을 발급합니다 (provisioning.opensphere.io/v1beta1).</p>
    <div class="os-sech">New Claim</div>
    <app-new-claim-form kind="pg" (created)="pgList.load()"></app-new-claim-form>
    <div class="os-sech">PostgresClaims</div>
    <app-claims-list #pgList kind="pg" plural="postgresclaims" primaryLabel="DB / owner"></app-claims-list>
  `,
})
export class PgClaimsTab {}
