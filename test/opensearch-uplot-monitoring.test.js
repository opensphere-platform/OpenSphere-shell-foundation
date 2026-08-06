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
  assert.doesNotMatch(`${monitoring}\n${chart}`, /location\.reload|window\.location|router\.navigate/);
});

test('node charts follow both live cluster inventory and Prometheus node labels', () => {
  const monitoring = read('src/app/modules/opensearch/tabs/os-monitoring.tab.ts');
  const metrics = read('src/app/modules/opensearch/os-metrics.service.ts');
  assert.match(monitoring, /trackBy: trackNode/);
  assert.match(metrics, /this\.os\.nodes\(\)/);
  assert.match(metrics, /max by\(node\)/);
  assert.match(metrics, /min by\(node\)/);
  assert.match(metrics, /body\.data\?\.result \?\? \[\]/);
  assert.match(metrics, /new Set\(\[\.\.\.inventory, \.\.\.observed\]\)/);
});

test('background refresh preserves the current chart state and last-known data', () => {
  const metrics = read('src/app/modules/opensearch/os-metrics.service.ts');
  assert.match(metrics, /if \(!this\.series\(\)\.timestamps\.length\) this\.state\.set\('loading'\)/);
  assert.match(metrics, /마지막 정상 시계열 유지/);
});

test('the PFSS deep link hydrates the monitoring tab on initial render', () => {
  const plugin = read('src/app/modules/data-engine/data-engine-plugin.component.ts');
  assert.match(plugin, /ngOnInit\(\):void\{this\.hydrateRouteTab\(\)/);
  assert.match(plugin, /private hydrateRouteTab\(\):void/);
});
