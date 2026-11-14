# @abdulcare/contracts

**Owner:** `api` lane, as integration owner (`@omaribrahim6`). See [SPEC §9 and §11](../../docs/SPEC.md#9-data-and-api-contract).

Shared TypeScript types for every lane. There are no runtime dependencies. The only runtime code is constant lists and `canTransition`.

| File | Contents |
|---|---|
| `src/grants.ts` | `Cents`, grant statuses and allowed transitions, payment rails and attempt statuses |
| `src/ai.ts` | Extraction, explanation, classification and program-matching shapes (from the `ai` lane) |
| `src/records.ts` | Records as the API returns them: patient, provider, device, document, grant, receipt, fund summary |
| `src/api.ts` | Request and response bodies for every route, the card-tap result, and the error format |

```ts
import type { Grant, GrantResponse } from "@abdulcare/contracts";
```

**Changing a contract:** open a PR touching this package and post on the board tagging every affected lane. Change shapes only additively unless the affected lanes agree.
