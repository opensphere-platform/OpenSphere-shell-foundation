const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('OpenSearch Monitoring uses uPlot and updates an existing chart instance', () => {
  const monitoring = read('src/app/modules/opensearch/tabs/os-monitoring.tab.ts');
  const chart = read('src/app/shared/uplot-line-chart.ts');
  assert.match(monitoring, /UPlotLineChart/);
  assert.match(monitoring, /<os-uplot-line-chart/);
  assert.doesNotMatch(monitoring, /CarbonLineChart|os-carbon-line-chart/);
  assert.match(chart, /from 'uplot'/);
  assert.match(chart, /this\.chart\.setData\(data, true\)/);
  assert.match(chart, /uPlot\.paths\.spline/);
  assert.match(chart, /cap: 'round'/);
  assert.match(chart, /fill: this\.alpha/);
  assert.match(chart, /getFullYear\(\).*getMonth\(\) \+ 1.*getDate\(\)/s);
  assert.doesNotMatch(`${monitoring}\n${chart}`, /location\.reload|window\.location|router\.navigate/);
});

test('node charts follow configured pods, live cluster inventory, and Prometheus node labels', () => {
  const monitoring = read('src/app/modules/opensearch/tabs/os-monitoring.tab.ts');
  const metrics = read('src/app/modules/opensearch/os-metrics.service.ts');
  assert.match(monitoring, /trackBy: trackNode/);
  assert.match(metrics, /this\.os\.nodes\(\)/);
  assert.match(metrics, /runtime\.runtime\('opensearch'\)\.pods/);
  assert.match(metrics, /max by\(node\)/);
  assert.match(metrics, /min by\(node\)/);
  assert.match(metrics, /body\.data\?\.result \?\? \[\]/);
  assert.match(metrics, /new Set\(\[\.\.\.configured, \.\.\.joined, \.\.\.observed\]\)/);
  assert.match(metrics, /configuredNodeCount/);
  assert.match(metrics, /joinedNodeCount/);
  assert.match(metrics, /metricsNodeCount/);
  assert.match(monitoring, /nodeColumns/);
  assert.match(monitoring, /join pending/);
});

test('background refresh preserves the current chart state and last-known data', () => {
  const metrics = read('src/app/modules/opensearch/os-metrics.service.ts');
  assert.match(metrics, /if \(!this\.series\(\)\.timestamps\.length\) this\.state\.set\('loading'\)/);
  assert.match(metrics, /마지막 정상 시계열 유지/);
});

test('Foundation delegates page scrolling to Main Shell and charts can expand in place', () => {
  const app = read('src/app/app.component.ts');
  const plugin = read('src/app/modules/data-engine/data-engine-plugin.component.ts');
  const monitoring = read('src/app/modules/opensearch/tabs/os-monitoring.tab.ts');
  assert.match(app, /\.cm-nav \{ min-height: 100%/);
  assert.match(app, /\.os-content \{ min-width: 0; min-height: 0; overflow: visible/);
  assert.doesNotMatch(app, /\.os-content \{[^}]*overflow: auto/);
  assert.match(plugin, /de-work de-work--flush/);
  assert.match(monitoring, /expandedChart = signal/);
  assert.match(monitoring, /toggleChart\('resources'\)/);
  assert.match(monitoring, /\[height\]="chartHeight/);
  assert.match(monitoring, /grid-column:1\/-1/);
  assert.match(monitoring, /\.osm-chart-card\{padding:9px 10px 4px!important\}/);
  assert.match(monitoring, /\.osm-chart-head\{[^}]*margin-bottom:0/);
});

test('the PFSS deep link hydrates the monitoring tab on initial render', () => {
  const plugin = read('src/app/modules/data-engine/data-engine-plugin.component.ts');
  assert.match(plugin, /ngOnInit\(\):void\{this\.hydrateRouteTab\(\)/);
  assert.match(plugin, /private hydrateRouteTab\(\):void/);
});
