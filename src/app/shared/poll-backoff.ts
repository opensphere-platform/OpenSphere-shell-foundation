// 15초 단일 폴러 공통 백오프 — 조회 실패(nocrd/noperm/error, 예: 대상 미설치·권한없음·프록시 502)가
// 반복되면 매 tick 재조회하지 않고 지수 백오프로 빈도만 낮춘다(최대 20틱=5분). state 정확성은 그대로,
// 콘솔 네트워크 로그 홍수만 줄인다. 성공(ok/empty)하는 즉시 streak 리셋 — 정상 15초 주기로 바로 복귀.
export class PollBackoff {
  private streak = new Map<string, number>();
  private tick = 0;

  /** 매 refresh() 진입 시 1회 호출 — 모든 key가 공유하는 tick 카운터 증가. */
  nextTick(): void { this.tick++; }

  /** 이번 tick에 key를 실제로 조회할지. 스킵되면 마지막 state를 그대로 유지(재요청 없음). */
  due(key: string): boolean {
    const n = this.streak.get(key) ?? 0;
    if (n === 0) { return true; }
    const period = Math.min(2 ** n, 20);
    return this.tick % period === 0;
  }

  /** 조회 결과 반영 — nocrd/noperm/error(=조회 자체 실패)면 streak 증가, ok/empty(=응답 성공)면 0으로 리셋. */
  report(key: string, state: string): void {
    const skippable = state === 'nocrd' || state === 'noperm' || state === 'error';
    this.streak.set(key, skippable ? (this.streak.get(key) ?? 0) + 1 : 0);
  }
}
