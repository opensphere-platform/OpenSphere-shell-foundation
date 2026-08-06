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
  ViewEncapsulation,
} from '@angular/core';
import uPlot from 'uplot';

export interface UPlotLineSeries {
  label: string;
  data: (number | null)[];
  color?: string;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

const dateLabel = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const timeLabel = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

@Component({
  selector: 'os-uplot-line-chart',
  standalone: true,
  imports: [CommonModule],
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    <div #plot class="plot" role="img" [attr.aria-label]="ariaLabel"></div>
    <span class="sr-only">{{summary()}}</span>
  `,
  styles: [`
    :host{display:block;min-width:0}.plot{width:100%;min-width:0;overflow:hidden}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    .uplot,.uplot *,.uplot *::before,.uplot *::after{box-sizing:border-box}.uplot{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;line-height:1.5;width:min-content}.u-title{text-align:center;font-size:18px;font-weight:bold}.u-wrap{position:relative;user-select:none}.u-over,.u-under{position:absolute}.u-under{overflow:hidden}.uplot canvas{display:block;position:relative;width:100%;height:100%}.u-axis{position:absolute}.u-legend{font-size:12px;margin:4px auto 0;text-align:center;color:#525252}.u-inline{display:block}.u-inline *{display:inline-block}.u-inline tr{margin-right:12px}.u-legend th{font-weight:600}.u-legend th>*{vertical-align:middle;display:inline-block}.u-legend .u-marker{width:.75rem;height:.75rem;margin-right:4px;background-clip:padding-box!important}.u-inline.u-live th::after{content:":";vertical-align:middle}.u-inline:not(.u-live) .u-value{display:none}.u-series>*{padding:2px 4px}.u-series th{cursor:pointer}.u-legend .u-off>*{opacity:.3}.u-select{background:rgba(15,98,254,.08);position:absolute;pointer-events:none}.u-cursor-x,.u-cursor-y{position:absolute;left:0;top:0;pointer-events:none;will-change:transform}.u-hz .u-cursor-x,.u-vt .u-cursor-y{height:100%;border-right:1px dashed #697077}.u-hz .u-cursor-y,.u-vt .u-cursor-x{width:100%;border-bottom:1px dashed #697077}.u-cursor-pt{position:absolute;top:0;left:0;border-radius:50%;border:0 solid;pointer-events:none;will-change:transform;background-clip:padding-box!important}.u-axis.u-off,.u-select.u-off,.u-cursor-x.u-off,.u-cursor-y.u-off,.u-cursor-pt.u-off{display:none}
  `],
})
export class UPlotLineChart implements AfterViewInit, OnChanges, OnDestroy {
  @Input() timestamps: number[] = [];
  @Input() series: UPlotLineSeries[] = [];
  @Input() ariaLabel = 'Time-series chart';
  @Input() valueAxisTitle = '';
  @Input() height = 240;
  @ViewChild('plot', { static: true }) private plotRef!: ElementRef<HTMLDivElement>;

  private chart?: uPlot;
  private resizeObserver?: ResizeObserver;
  private signature = '';
  private updateCount = 0;

  ngAfterViewInit(): void {
    this.render();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.plotRef.nativeElement);
  }

  ngOnChanges(_changes: SimpleChanges): void {
    if (this.plotRef) this.render();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.destroy();
  }

  summary(): string {
    const latest = this.series.map((item) => {
      const value = [...item.data].reverse().find((entry) => entry !== null);
      return `${item.label} ${value ?? '데이터 없음'}`;
    });
    return `${this.ariaLabel}. ${latest.join(', ')}`;
  }

  private render(): void {
    const host = this.plotRef.nativeElement;
    const nextSignature = JSON.stringify({
      height: this.height,
      axis: this.valueAxisTitle,
      series: this.series.map((item) => [item.label, item.color]),
    });
    const data: uPlot.AlignedData = [this.timestamps, ...this.series.map((item) => item.data)];

    if (!this.chart || this.signature !== nextSignature) {
      this.chart?.destroy();
      host.replaceChildren();
      this.signature = nextSignature;
      const splinePath = uPlot.paths.spline?.({ alignGaps: 0 });
      this.chart = new uPlot({
        width: this.width(),
        height: this.height,
        cursor: { drag: { x: true, y: false } },
        legend: { show: true, live: true },
        axes: [{
          stroke: '#697077',
          grid: { stroke: '#e0e0e0', width: 1 },
          size: 54,
          values: (_self: uPlot, splits: number[]) => splits.map((timestamp, index) => {
            const showDate = index === 0 || dateLabel(timestamp) !== dateLabel(splits[index - 1]);
            return showDate ? `${timeLabel(timestamp)}\n${dateLabel(timestamp)}` : timeLabel(timestamp);
          }),
        }, { label: this.valueAxisTitle, stroke: '#697077', grid: { stroke: '#e0e0e0', width: 1 } }],
        series: [
          {},
          ...this.series.map((item) => ({
            label: item.label,
            stroke: item.color ?? '#0f62fe',
            fill: this.alpha(item.color ?? '#0f62fe', 0.07),
            width: 1.5,
            cap: 'round' as CanvasLineCap,
            paths: splinePath,
            spanGaps: false,
            points: { show: false },
          })),
        ],
      }, data, host);
      host.dataset['renderId'] = host.dataset['renderId'] || crypto.randomUUID();
    } else {
      this.chart.setData(data, true);
    }

    this.updateCount++;
    host.dataset['chartEngine'] = 'uplot';
    host.dataset['seriesCount'] = String(this.series.length);
    host.dataset['updateCount'] = String(this.updateCount);
  }

  private resize(): void {
    if (!this.chart) return;
    const width = this.width();
    if (width !== this.chart.width || this.height !== this.chart.height) this.chart.setSize({ width, height: this.height });
  }

  private width(): number {
    return Math.max(320, Math.floor(this.plotRef.nativeElement.clientWidth || 640));
  }

  private alpha(color: string, opacity: number): string {
    const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1];
    if (!hex) return color;
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
  }
}
