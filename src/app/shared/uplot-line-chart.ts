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
    <div class="time-controls" role="group" [attr.aria-label]="ariaLabel + ' 시간 범위 조절'">
      <button type="button" (click)="zoomIn()" title="현재 시간 범위를 절반으로 확대">시간 확대</button>
      <button type="button" (click)="zoomOut()" title="현재 시간 범위를 두 배로 축소">시간 축소</button>
      <button type="button" (click)="resetZoom()" title="수집된 전체 시간 범위 보기">전체 보기</button>
    </div>
    <span class="sr-only">{{summary()}}</span>
  `,
  styles: [`
    :host{display:block;min-width:0}.plot{width:100%;min-width:0;overflow:hidden}.time-controls{display:flex;justify-content:flex-end;gap:3px;margin-top:1px}.time-controls button{min-height:24px;border:0;background:transparent;padding:2px 6px;color:#006b75;font:600 11px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer}.time-controls button:hover,.time-controls button:focus-visible{background:#e8f4f5;outline:1px solid #008392;outline-offset:-1px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
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
  private zoomRange?: { min: number; max: number };
  private settingScale = false;

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
        hooks: {
          setScale: [(plot, key) => {
            if (key !== 'x' || this.settingScale) return;
            const min = Number(plot.scales.x.min);
            const max = Number(plot.scales.x.max);
            if (!Number.isFinite(min) || !Number.isFinite(max)) return;
            this.zoomRange = this.isFullRange(min, max) ? undefined : { min, max };
          }],
        },
      }, data, host);
      host.dataset['renderId'] = host.dataset['renderId'] || crypto.randomUUID();
    } else {
      const retainedRange = this.zoomRange;
      this.chart.setData(data, !retainedRange);
      if (retainedRange) this.setTimeRange(retainedRange.min, retainedRange.max);
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

  zoomIn(): void {
    const range = this.currentRange();
    if (!range) return;
    const minimum = this.minimumSpan();
    const nextSpan = Math.max(minimum, (range.max - range.min) / 2);
    if (nextSpan >= range.max - range.min) return;
    const center = (range.min + range.max) / 2;
    this.setTimeRange(center - nextSpan / 2, center + nextSpan / 2);
  }

  zoomOut(): void {
    const range = this.currentRange();
    const extent = this.fullExtent();
    if (!range || !extent) return;
    const fullSpan = extent.max - extent.min;
    const nextSpan = Math.min(fullSpan, (range.max - range.min) * 2);
    if (nextSpan >= fullSpan * 0.999) {
      this.resetZoom();
      return;
    }
    const center = (range.min + range.max) / 2;
    let min = center - nextSpan / 2;
    let max = center + nextSpan / 2;
    if (min < extent.min) { max += extent.min - min; min = extent.min; }
    if (max > extent.max) { min -= max - extent.max; max = extent.max; }
    this.setTimeRange(min, max);
  }

  resetZoom(): void {
    const extent = this.fullExtent();
    if (!extent) return;
    this.zoomRange = undefined;
    this.setTimeRange(extent.min, extent.max, false);
  }

  private currentRange(): { min: number; max: number } | undefined {
    const min = Number(this.chart?.scales.x.min);
    const max = Number(this.chart?.scales.x.max);
    return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : this.fullExtent();
  }

  private fullExtent(): { min: number; max: number } | undefined {
    if (this.timestamps.length < 2) return undefined;
    return { min: this.timestamps[0], max: this.timestamps[this.timestamps.length - 1] };
  }

  private minimumSpan(): number {
    const extent = this.fullExtent();
    if (!extent) return 1;
    return Math.max(1, (extent.max - extent.min) / Math.max(this.timestamps.length - 1, 1) * 2);
  }

  private setTimeRange(min: number, max: number, remember = true): void {
    const extent = this.fullExtent();
    if (!this.chart || !extent) return;
    const span = Math.min(max - min, extent.max - extent.min);
    let boundedMin = Math.max(extent.min, min);
    let boundedMax = Math.min(extent.max, max);
    if (boundedMax - boundedMin < span) {
      if (boundedMin === extent.min) boundedMax = Math.min(extent.max, boundedMin + span);
      else boundedMin = Math.max(extent.min, boundedMax - span);
    }
    this.zoomRange = remember && !this.isFullRange(boundedMin, boundedMax) ? { min: boundedMin, max: boundedMax } : undefined;
    this.settingScale = true;
    try { this.chart.setScale('x', { min: boundedMin, max: boundedMax }); }
    finally { this.settingScale = false; }
  }

  private isFullRange(min: number, max: number): boolean {
    const extent = this.fullExtent();
    if (!extent) return true;
    const tolerance = Math.max(0.001, (extent.max - extent.min) * 0.001);
    return Math.abs(min - extent.min) <= tolerance && Math.abs(max - extent.max) <= tolerance;
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
