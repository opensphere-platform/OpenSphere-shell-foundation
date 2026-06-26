# opensphere-foundation-ai

OpenSphere-Platform 컴포넌트 — **Plane P2 · kind foundation**

AI substrate operator-per-concern. LiteLLM route, embedding route, vector retrieval capability 를 publish 하고 P4 Intelligence 가 이를 소비한다. MLOps 는 `opensphere-ai-training` 으로 분리한다.

## Implemented API skeleton

- `LLMRouteClaim`
  - LiteLLM 기반 LLM route published capability
  - `tier`: `basic`, `standard`, `regulated`
  - provider allow-list와 domestic-provider 선호 정책 포함
- `VectorRetrievalClaim`
  - vector RAG retrieval published capability
  - foundation-data Index capability 와 embedding route 를 참조

## Boundary

- 포함: LLM route, embedding route, vector retrieval.
- 제외: training job, model promotion, inference lifecycle, evaluation gate.
- 소비자: `opensphere-ai-orchestrator`, OpenSphere service AI assistant, console AI assistant.
