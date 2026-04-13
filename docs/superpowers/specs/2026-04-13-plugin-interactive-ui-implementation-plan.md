# Plugin Interactive UI — Implementation Plan

**Date:** 2026-04-13
**Design spec:** `docs/superpowers/specs/2026-04-13-plugin-interactive-ui-design.md`

---

## Phase 1: Shared Types (server + client)

### Step 1.1 — Create `server/src/models/input-request.model.ts`

Define and export:

```ts
export interface InputField {
  id: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multi-select' | 'textarea';
  label: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

export interface InputRequest {
  requestId: string;
  pluginId: string;
  title: string;
  content?: string;       // HTML/markdown
  fields: InputField[];
  skippable: boolean;
  skipLabel?: string;
  submitLabel?: string;
}

export interface InputResponse {
  requestId: string;
  skipped: boolean;
  values: Record<string, unknown>;
}
```

### Step 1.2 — Add `requiresInteraction` to server `PluginMeta`

File: `server/src/models/plugin.model.ts`

Add to `PluginMeta`:
```ts
requiresInteraction?: boolean;
```

### Step 1.3 — Mirror types on the client

File: `client/src/app/core/models/plugin.model.ts`

- Add `requiresInteraction?: boolean` to the existing `PluginMeta` interface
- Add `InputField`, `InputRequest`, `InputResponse` types (copy from server, or create a shared types file — for now keep them duplicated since server and client are separate packages)

---

## Phase 2: Server-Side Pause/Resume

### Step 2.1 — Extend `PipelineContext`

File: `server/src/models/pipeline-context.model.ts`

Add to the `PipelineContext` interface:
```ts
requestInput: (request: Omit<InputRequest, 'requestId' | 'pluginId'>) => Promise<InputResponse>;
```

Import `InputRequest` and `InputResponse` from `input-request.model.ts`.

### Step 2.2 — Implement pending input store and wiring in `pipeline.service.ts`

File: `server/src/services/pipeline.service.ts`

Changes:
1. Add a class-level `pendingInputs` map:
   ```ts
   private pendingInputs = new Map<string, {
     request: InputRequest;
     resolve: (r: InputResponse) => void;
   }>();
   ```

2. Add a public method to resolve pending inputs (called by the route handler):
   ```ts
   resolveInput(requestId: string, response: InputResponse): boolean {
     const pending = this.pendingInputs.get(requestId);
     if (!pending) return false;
     this.pendingInputs.delete(requestId);
     // Broadcast "input received" so client resumes timer
     sseService.broadcast({
       type: 'plugin:input-received',
       data: { requestId, pluginId: pending.request.pluginId },
     });
     pending.resolve(response);
     return true;
   }
   ```

3. Add a method to get any pending input (for re-broadcast on reconnect):
   ```ts
   getPendingInput(): InputRequest | null {
     // Return the first (and should be only) pending request
     const first = this.pendingInputs.values().next().value;
     return first?.request ?? null;
   }
   ```

4. Inside the `run()` method, before calling `plugin.execute(ctx)`, wire up `ctx.requestInput`:
   ```ts
   ctx.requestInput = (partial) => {
     return new Promise<InputResponse>((resolve) => {
       const requestId = uuidv4();
       const pluginId = step.pluginId;
       const fullRequest: InputRequest = { ...partial, requestId, pluginId };

       this.pendingInputs.set(requestId, { request: fullRequest, resolve });

       sseService.broadcast({
         type: 'plugin:input-requested',
         data: { ...fullRequest, waitingForInput: true },
       });
     });
   };
   ```

5. In the pipeline abort/error path, reject any pending inputs:
   ```ts
   // In the catch block or abort handler:
   for (const [id, pending] of this.pendingInputs) {
     pending.resolve({ requestId: id, skipped: true, values: {} });
   }
   this.pendingInputs.clear();
   ```

### Step 2.3 — Add REST endpoint for input submission

File: `server/src/routes/plugin.routes.ts`

Add a new route:
```ts
router.post('/plugins/input/:requestId', (req, res) => {
  const { requestId } = req.params;
  const response: InputResponse = {
    requestId,
    skipped: req.body.skipped ?? false,
    values: req.body.values ?? {},
  };
  const resolved = pipelineService.resolveInput(requestId, response);
  if (!resolved) {
    return res.status(404).json({ error: 'No pending input request with this ID' });
  }
  res.json({ ok: true });
});
```

Import `pipelineService` — it's currently only used in this file indirectly. The import path: `../services/pipeline.service`.

### Step 2.4 — SSE reconnect re-broadcast

File: `server/src/services/sse.service.ts`

When a new SSE client connects, check for pending input requests and re-broadcast:
- Add a callback hook or method that the pipeline service can register
- On new connection, call `pipelineService.getPendingInput()` — if non-null, send `plugin:input-requested` to the new client

Look at current SSE service implementation to determine exact mechanism. The key idea: a new SSE connection should receive the pending `InputRequest` if one exists, so refreshing the browser doesn't lose the form.

---

## Phase 3: Client-Side Form Component

### Step 3.1 — Create `PluginInputFormComponent`

File: `client/src/app/features/onboarding/plugin-input-form/plugin-input-form.component.ts`

Standalone component with:
- `input()`: `request` of type `InputRequest`
- `output()`: `submitted` emitting `InputResponse`
- `output()`: `skipped` emitting `InputResponse`

Implementation details:
1. **Reactive form setup** — in an `effect()` or `ngOnInit`, build a `FormGroup` from `request.fields`:
   - `text` / `textarea` → `FormControl<string>` with validators from `validation` (minLength, maxLength, pattern)
   - `number` → `FormControl<number>` with min/max validators
   - `boolean` → `FormControl<boolean>`
   - `select` → `FormControl<string>` 
   - `multi-select` → `FormControl<string[]>`
   - Set `defaultValue` as initial value
   - Set `Validators.required` if `required: true`

2. **Template structure:**
   ```
   <div class="plugin-input-form">
     <h3 class="form-title">{{ request().title }}</h3>
     
     <!-- Content area — sanitized HTML -->
     @if (request().content) {
       <div class="form-content" [innerHTML]="sanitizedContent()"></div>
     }
     
     <!-- Dynamic fields -->
     @if (request().fields.length > 0) {
       <form [formGroup]="form" class="form-fields">
         @for (field of request().fields; track field.id) {
           <div class="field-group">
             <label [for]="field.id">{{ field.label }}</label>
             @if (field.description) {
               <span class="field-desc">{{ field.description }}</span>
             }
             
             @switch (field.type) {
               @case ('text') { <input type="text" [formControlName]="field.id" [id]="field.id" /> }
               @case ('number') { <input type="number" [formControlName]="field.id" [id]="field.id" /> }
               @case ('boolean') { <input type="checkbox" [formControlName]="field.id" [id]="field.id" /> }
               @case ('textarea') { <textarea [formControlName]="field.id" [id]="field.id"></textarea> }
               @case ('select') {
                 <select [formControlName]="field.id" [id]="field.id">
                   @for (opt of field.options ?? []; track opt.value) {
                     <option [value]="opt.value">{{ opt.label }}</option>
                   }
                 </select>
               }
               @case ('multi-select') {
                 <!-- Render as checkboxes or a multi-select list -->
                 @for (opt of field.options ?? []; track opt.value) {
                   <label class="multi-opt">
                     <input type="checkbox"
                       [checked]="isMultiSelected(field.id, opt.value)"
                       (change)="toggleMultiSelect(field.id, opt.value)" />
                     {{ opt.label }}
                   </label>
                 }
               }
             }
             
             <!-- Validation errors -->
             @if (form.get(field.id)?.invalid && form.get(field.id)?.touched) {
               <span class="field-error">{{ getErrorMessage(field) }}</span>
             }
           </div>
         }
       </form>
     }
     
     <!-- Actions -->
     <div class="form-actions">
       @if (request().skippable) {
         <button class="btn-skip" (click)="onSkip()">
           {{ request().skipLabel ?? 'Skip' }}
         </button>
       }
       <button class="btn-submit" (click)="onSubmit()" [disabled]="form.invalid">
         {{ request().submitLabel ?? 'Submit' }}
       </button>
     </div>
   </div>
   ```

3. **Styling** — match the existing processing panel's dark theme aesthetic. Use the same CSS variables (`--color-bg`, `--color-border`, `--color-accent`, etc.).

4. **Methods:**
   - `onSubmit()`: collect `form.value`, emit `submitted` with `{ requestId, skipped: false, values }`
   - `onSkip()`: emit `skipped` with `{ requestId, skipped: true, values: {} }`
   - `sanitizedContent()`: computed signal using `DomSanitizer.bypassSecurityTrustHtml`
   - `isMultiSelected(fieldId, value)`: check if value is in the FormControl's array
   - `toggleMultiSelect(fieldId, value)`: add/remove value from the array
   - `getErrorMessage(field)`: return human-readable error based on which validator failed

### Step 3.2 — Add `submitInput` to `PluginService`

File: `client/src/app/core/services/plugin.service.ts`

Add method:
```ts
submitInput(requestId: string, response: { skipped: boolean; values: Record<string, unknown> }): Observable<{ ok: boolean }> {
  return this.api.post<{ ok: boolean }>(`/plugins/input/${requestId}`, response);
}
```

---

## Phase 4: Processing Panel Integration

### Step 4.1 — Update `ProcessingProgressComponent`

File: `client/src/app/features/onboarding/processing-progress/processing-progress.component.ts`

Changes:

1. **New imports:** `PluginInputFormComponent`, `InputRequest`, `InputResponse`, `PluginService`

2. **New signals:**
   ```ts
   readonly pendingInput = signal<InputRequest | null>(null);
   readonly waitingForInput = signal(false);
   ```

3. **New output:** (so the parent can wire the POST)
   Or inject `PluginService` directly and handle the POST internally.

4. **Extend the SSE effect** — add cases for new event types:
   ```ts
   // Inside the existing effect watching this.event():
   if (ev.type === 'plugin:input-requested') {
     const request = ev.data as unknown as InputRequest;
     this.pendingInput.set(request);
     this.waitingForInput.set(true);
     this.stopTicker(); // pause timer
   }
   if (ev.type === 'plugin:input-received') {
     this.pendingInput.set(null);
     this.waitingForInput.set(false);
     // Timer resumes on next 'pipeline:progress' event naturally
   }
   ```

5. **Template changes** — inside the `@if (getStepStatus(...) === 'running')` block:
   ```html
   @if (waitingForInput() && pendingInput(); as req) {
     <div class="waiting-badge">Waiting for input</div>
     <app-plugin-input-form
       [request]="req"
       (submitted)="onInputSubmitted($event)"
       (skipped)="onInputSkipped($event)"
     />
   } @else {
     <!-- existing progress bar and message -->
   }
   ```

6. **Handler methods:**
   ```ts
   onInputSubmitted(response: InputResponse): void {
     this.pluginService.submitInput(response.requestId, {
       skipped: false,
       values: response.values,
     }).subscribe();
   }

   onInputSkipped(response: InputResponse): void {
     this.pluginService.submitInput(response.requestId, {
       skipped: true,
       values: {},
     }).subscribe();
   }
   ```

### Step 4.2 — "Interactive" badge in pipeline configurator

File: `client/src/app/features/onboarding/pipeline-configurator/pipeline-configurator.component.ts`

In the template, inside `.node-header` after `.node-name`:
```html
@if (getPlugin(step.pluginId)?.requiresInteraction) {
  <span class="interactive-badge">Interactive</span>
}
```

Add a small CSS style:
```css
.interactive-badge {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  background: rgba(255, 193, 7, 0.15);
  color: #ffc107;
}
```

---

## Phase 5: SSE Reconnect Support

### Step 5.1 — Re-broadcast pending input on reconnect

File: `server/src/services/sse.service.ts`

The SSE service needs to know about pending inputs. Two options:

**Option A (recommended):** Add a `onConnect` callback registration to `SseService`. The pipeline service registers a callback that checks `getPendingInput()` and sends it to the new client.

**Option B:** After each new SSE client connects, call a known method. Since `sseService` and `pipelineService` are singletons, the SSE service can import pipeline service and call `getPendingInput()` directly — but this creates a circular dependency. Avoid this.

Go with Option A:
- `sseService.onClientConnect(callback: (sendToClient: (event) => void) => void)`
- In `pipeline.service.ts`, after startup: register a callback that sends pending input to new clients

---

## Phase 6: Testing

### Step 6.1 — Server unit tests

File: `server/src/services/pipeline.service.test.ts` (new)

Test cases:
- `requestInput` creates a pending entry and broadcasts SSE
- `resolveInput` resolves the pending Promise and broadcasts `plugin:input-received`
- `resolveInput` with unknown requestId returns false
- Pipeline abort clears pending inputs
- Multiple `requestInput` calls in one plugin work sequentially

### Step 6.2 — Client component tests

File: `client/src/app/features/onboarding/plugin-input-form/plugin-input-form.component.spec.ts` (new)

Test cases:
- Renders all field types correctly
- Submit emits correct values
- Skip emits skipped response
- Required field validation blocks submit
- Content is rendered as HTML
- Skip button hidden when `skippable: false`

---

## Implementation Order

```
Phase 1 (types)          → no dependencies, do first
Phase 2 (server)         → depends on Phase 1
Phase 3 (form component) → depends on Phase 1 (types only)
Phase 4 (integration)    → depends on Phase 2 + Phase 3
Phase 5 (reconnect)      → depends on Phase 2
Phase 6 (tests)          → depends on all above
```

Phases 2 and 3 can be done in parallel since they only share the types from Phase 1.

---

## Files Checklist

| Action | File | Phase |
|--------|------|-------|
| CREATE | `server/src/models/input-request.model.ts` | 1.1 |
| MODIFY | `server/src/models/plugin.model.ts` | 1.2 |
| MODIFY | `client/src/app/core/models/plugin.model.ts` | 1.3 |
| MODIFY | `server/src/models/pipeline-context.model.ts` | 2.1 |
| MODIFY | `server/src/services/pipeline.service.ts` | 2.2 |
| MODIFY | `server/src/routes/plugin.routes.ts` | 2.3 |
| MODIFY | `server/src/services/sse.service.ts` | 2.4, 5.1 |
| CREATE | `client/src/app/features/onboarding/plugin-input-form/plugin-input-form.component.ts` | 3.1 |
| MODIFY | `client/src/app/core/services/plugin.service.ts` | 3.2 |
| MODIFY | `client/src/app/features/onboarding/processing-progress/processing-progress.component.ts` | 4.1 |
| MODIFY | `client/src/app/features/onboarding/pipeline-configurator/pipeline-configurator.component.ts` | 4.2 |
| CREATE | `server/src/services/pipeline.service.test.ts` | 6.1 |
| CREATE | `client/src/app/features/onboarding/plugin-input-form/plugin-input-form.component.spec.ts` | 6.2 |
