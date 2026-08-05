import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { LegendPositions, LineChart, LineChartOptions, ScaleTypes } from '@carbon/charts';

export interface CarbonLineSeries {
  label: string;
  data: number[];
  color?: string;
}

@Component({
  selector: 'os-carbon-line-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div #chartHost class="osc-chart" role="img" [attr.aria-label]="ariaLabel"></div>
    <p class="osc-chart-alt">{{ accessibleSummary }}</p>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .osc-chart { width: 100%; min-height: 15rem; }
    .osc-chart-alt { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  `],
})
export class CarbonLineChart implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('chartHost', { static: true }) private chartHost?: ElementRef<HTMLDivElement>;
  @Input() labels: string[] = [];
  @Input() series: CarbonLineSeries[] = [];
  @Input() ariaLabel = 'Carbon line chart';
  @Input() valueAxisTitle = '';

  private chart?: LineChart;
  private viewReady = false;

  get accessibleSummary(): string {
    return this.series
      .flatMap((item) => item.data.map((value, index) => `${item.label} ${this.labels[index] ?? index + 1}: ${value}`))
      .join(', ');
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    if (this.viewReady) this.render();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private render(): void {
    const holder = this.chartHost?.nativeElement;
    if (!holder) return;

    const data = this.series.flatMap((item) => this.labels.map((label, index) => ({
      group: item.label,
      label,
      value: Number.isFinite(item.data[index]) ? item.data[index] : 0,
    })));
    const colorScale = Object.fromEntries(this.series.filter((item) => item.color).map((item) => [item.label, item.color]));
    const options: LineChartOptions = {
      accessibility: { svgAriaLabel: this.ariaLabel },
      axes: {
        bottom: { mapsTo: 'label', scaleType: ScaleTypes.LABELS, ticks: { rotateIfSmallerThan: 560 } },
        left: { mapsTo: 'value', scaleType: ScaleTypes.LINEAR, includeZero: true, title: this.valueAxisTitle || undefined },
      },
      color: { scale: colorScale },
      curve: 'curveMonotoneX',
      data: { groupMapsTo: 'group' },
      height: '15rem',
      legend: { enabled: true, position: LegendPositions.BOTTOM },
      points: { enabled: true, radius: 2, filled: true },
      resizable: true,
      toolbar: { enabled: false },
    };

    if (!this.chart) {
      this.chart = new LineChart(holder, { data, options });
      return;
    }
    this.chart.model.setData(data);
    this.chart.model.setOptions(options);
    this.chart.update(false);
  }
}
