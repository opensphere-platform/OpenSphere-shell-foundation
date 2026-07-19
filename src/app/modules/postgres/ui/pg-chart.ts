import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import Chart from 'chart.js/auto';
import type { ChartConfiguration, ChartDataset, ChartType } from 'chart.js';

export type PgChartKind = 'horizontalBar' | 'doughnut' | 'line';

export interface PgChartSeries {
  label: string;
  data: number[];
  color: string;
  colors?: string[];
}

@Component({
  selector: 'pg-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pg-chart-frame" [class.pg-chart-frame--doughnut]="kind === 'doughnut'">
      <canvas #canvas role="img" [attr.aria-label]="ariaLabel"></canvas>
      <div class="pg-chart-center" *ngIf="kind === 'doughnut' && centerValue" aria-hidden="true">
        <strong>{{ centerValue }}</strong><span>{{ centerLabel }}</span>
      </div>
    </div>
    <div class="pg-chart-legend" *ngIf="showLegend && series.length">
      <span *ngFor="let item of series"><i [style.background]="item.color"></i>{{ item.label }}</span>
    </div>
    <p class="pg-chart-alt">{{ accessibleSummary }}</p>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .pg-chart-frame { position: relative; width: 100%; height: 12rem; min-height: 10rem; }
    .pg-chart-frame--doughnut { height: 13rem; }
    canvas { width: 100% !important; height: 100% !important; }
    .pg-chart-center { position: absolute; inset: 50% auto auto 50%; transform: translate(-50%, -50%); display: grid; justify-items: center; pointer-events: none; color: #1b2a32; }
    .pg-chart-center strong { font-size: 1.55rem; line-height: 1; font-weight: 600; }
    .pg-chart-center span { margin-top: .3rem; color: #5b6971; font-size: .65rem; }
    .pg-chart-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: .4rem .8rem; margin-top: .35rem; color: #5b6971; font-size: .62rem; }
    .pg-chart-legend span { display: inline-flex; align-items: center; gap: .3rem; }
    .pg-chart-legend i { width: .7rem; height: .22rem; border-radius: 1px; }
    .pg-chart-alt { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  `],
})
export class PgChart implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas') canvas?: ElementRef<HTMLCanvasElement>;
  @Input() kind: PgChartKind = 'line';
  @Input() labels: string[] = [];
  @Input() series: PgChartSeries[] = [];
  @Input() ariaLabel = 'PostgreSQL monitoring chart';
  @Input() centerValue = '';
  @Input() centerLabel = '';
  @Input() showLegend = true;

  private chart?: Chart;
  private ready = false;

  get accessibleSummary(): string {
    const values = this.series.flatMap((item) => item.data.map((value, index) => `${item.label} ${this.labels[index] ?? index + 1}: ${value}`));
    return values.length ? values.join(', ') : '표시할 모니터링 데이터가 없습니다.';
  }

  ngAfterViewInit(): void {
    this.ready = true;
    this.render();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    if (this.ready) queueMicrotask(() => this.render());
  }

  ngOnDestroy(): void { this.chart?.destroy(); }

  private render(): void {
    const canvas = this.canvas?.nativeElement;
    if (!canvas) return;
    this.chart?.destroy();
    this.chart = new Chart(canvas, this.configuration());
  }

  private configuration(): ChartConfiguration {
    const type: ChartType = this.kind === 'horizontalBar' ? 'bar' : this.kind;
    const datasets: ChartDataset[] = this.series.map((item) => ({
      label: item.label,
      data: item.data,
      borderColor: item.color,
      backgroundColor: this.kind === 'line' ? `${item.color}24` : (item.colors ?? item.color),
      pointBackgroundColor: item.color,
      pointRadius: this.kind === 'line' ? 0 : undefined,
      pointHoverRadius: this.kind === 'line' ? 3 : undefined,
      borderWidth: this.kind === 'doughnut' ? 0 : 2,
      tension: this.kind === 'line' ? .28 : undefined,
      fill: this.kind === 'line',
      barThickness: this.kind === 'horizontalBar' ? 14 : undefined,
    }));
    return {
      type,
      data: { labels: this.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 260 },
        indexAxis: this.kind === 'horizontalBar' ? 'y' : 'x',
        cutout: this.kind === 'doughnut' ? '76%' : undefined,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1b2a32',
            titleFont: { size: 11 },
            bodyFont: { size: 11 },
            padding: 8,
          },
        },
        scales: this.kind === 'doughnut' ? undefined : {
          x: {
            beginAtZero: true,
            suggestedMax: this.kind === 'horizontalBar' ? 100 : undefined,
            max: this.kind === 'horizontalBar' ? 100 : undefined,
            grid: { color: '#e6e8ec' },
            border: { color: '#c9d0d4' },
            ticks: { color: '#5b6971', font: { size: 10 }, maxTicksLimit: 6 },
          },
          y: {
            beginAtZero: true,
            grid: { color: this.kind === 'horizontalBar' ? '#e6e8ec' : '#eef0f2' },
            border: { color: '#c9d0d4' },
            ticks: { color: '#5b6971', font: { size: 10 }, maxTicksLimit: 5 },
          },
        },
      },
    } as ChartConfiguration;
  }
}
