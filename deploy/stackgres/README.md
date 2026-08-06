# StackGres PFSS control plane

This package installs the shared StackGres 1.19.0 operator control plane.
StackGres is the sole PFSS PostgreSQL execution engine. Every
`PostgresClaim/v1beta1` renders an isolated `SGCluster` in the claim namespace.

Supply-chain constraints:

- official chart URL is version-pinned and verified with SHA-256
  `355CAA7BCED88B52A57B44B3945C0F9F44F19C3A952F181D0BA5622558A0BDEB`;
- operator/install-job images are OpenSphere GHCR mirrors and are replaced
  with exact linux/amd64 digests after Helm rendering;
- StackGres `SG_IMAGE_*` templates are fixed to curated GHCR operand digests,
  so generated StatefulSets and Jobs cannot fall back to mutable tags;
- upstream StackGres REST API/Admin UI are disabled because PFSS supplies the
  authenticated fleet and database-object UI;
- StackGres is AGPL-3.0-only. Production adoption requires the platform license
  review gate recorded in the AddOnOffering.

Run from the module repository root:

```powershell
./deploy/stackgres/Install-StackGresEdge.ps1
```
