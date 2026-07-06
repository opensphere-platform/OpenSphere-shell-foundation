# Foundation Plugin Hosting Update - 2026-07-06

## Decision

`/p/foundation/*` plugin routes are no longer represented by local dummy pages. Foundation now acts as a host shell:

- Foundation engine pages prepare or install the backing capability.
- Independent plugins are installed as `UIPluginPackage` + `UIPluginRegistration`.
- When a plugin is enabled, Foundation mounts the plugin custom element through `PluginOutletComponent`.

## Active Hosted Plugins

| Route | Package | Element | Install source |
| --- | --- | --- | --- |
| `/p/foundation/samba` | `samba-ad` | `osp-samba-ad` | `OpenSphere-plugin-samba-ad` |
| `/p/foundation/opensearch` | `opensearch` | `osp-opensearch` | `OpenSphere-plugin-opensearch` |

## OpenSearch 0-Stage Flow

1. Admin opens Foundation FSS engine catalog.
2. Admin selects OpenSearch.
3. Foundation control-plane sets `FoundationModel/data.spec.engines.opensearch=enabled`.
4. Control-plane reconciles OpenSearch StatefulSet and Service in `opensphere-foundation`.
5. Admin opens the OpenSearch plugin from the installed engine page.
6. Foundation mounts the verified `osp-opensearch` element at `/p/foundation/opensearch`.

## Verification

- `UIPluginRegistration/foundation`: `Enabled`
- `UIPluginRegistration/opensearch`: `Enabled`
- `UIPluginRegistration/samba-ad`: `Enabled`
- `Deployment/foundation`: `1/1`
- `Deployment/opensearch`: `1/1`
- `Deployment/samba-ad`: `1/1`
- Registry publishes `opensearch` and `samba-ad` with `keyId=opensphere-plugins-v2`.
- OpenSearch plugin `/healthz`: `200 ok`
- Samba-AD plugin `/healthz`: `200 ok`

